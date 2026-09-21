"use server";
// iam Server Actions. `loginAction` is the ONE pre-authentication action in the codebase and therefore the only
// one that does not go through defineAction's permission gate; it still parses with a `.strict()` schema, is
// throttled through iam.login_attempt, always runs exactly one argon2 verify and returns one generic error.
import { redirect } from "next/navigation";
import { defineAction, definePublicAction, fail, ok, type Result } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { validation } from "@/lib/errors";
import { normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";
import { getClientIp, getUserAgent } from "@/lib/request";
import { ChangePasswordInput, EmptyInput, LoginInput } from "./dto";
import { CURRENT_PASSWORD_REQUIRED_MESSAGE, CURRENT_PASSWORD_WRONG_MESSAGE, LOGIN_GENERIC_MESSAGE, NO_MEMBERSHIP_MESSAGE } from "./messages";
import { safeNextPath } from "./next-path";
import { DUMMY_HASH, PASSWORD_POLICY_MESSAGES, hashPassword, validateNewPassword, verifyPassword } from "./password";
import {
  findAccountById,
  findAccountByIdentifier,
  findPasswordHash,
  listActiveMembershipsForAccount,
  recordLoginFailure,
  recordLoginSuccess,
  setPassword,
} from "./repo";
import { clearSessionCookie, createSession, revokeAllForUser, revokeSession, setSessionCookie } from "./session";
import { THROTTLE, countRecentFailures, recordAttempt, slowDown, throttleDecision, type LoginOutcomeCode } from "./throttle";

/** One field «موبایل یا نام‌کاربری»: phone-looking input → E.164, otherwise a lower-cased username. */
function normalizeIdentifier(raw: string): string {
  const ascii = toAsciiDigits(raw.trim());
  if (/^[+\d][\d\s\-().]*$/.test(ascii)) return normalizePhoneIR(ascii) ?? ascii.replace(/[\s\-().]/g, "");
  return ascii.toLowerCase();
}

type LoginOutcome = { kind: "failed" } | { kind: "no_membership" } | { kind: "ok"; destination: string };

/**
 * The login core: throttle counts + account lookup in one global transaction, exactly ONE argon2 verify
 * (real hash or DUMMY_HASH), then the attempt record / lock escalation / session creation in a second one.
 * Every failure path returns the same `{ kind: "failed" }`; the caller turns it into the one generic message.
 *
 * An attempt refused WITHOUT a verdict on the password — throttled identifier or IP, `locked_until` in the future,
 * `status = 'locked'` — is recorded as `locked` for the audit trail but is neither counted by the throttle nor
 * added to `failed_login_count`, and never escalates a lock: retrying during a soft lock (even with the right
 * password) must not turn 15 minutes into an hour (QA round 1, B2).
 */
const loginCore = definePublicAction({ schema: LoginInput }, async (input, { globalTx, bindAccount }): Promise<LoginOutcome> => {
  const identifier = normalizeIdentifier(input.identifier);
  const ip = await getClientIp();
  const userAgent = await getUserAgent();
  const now = new Date();

  const probe = await globalTx(async (tx) => {
    const counts = await countRecentFailures(tx, identifier, ip);
    const account = await findAccountByIdentifier(tx, identifier);
    const hash = account ? await findPasswordHash(tx, account.id) : null;
    return { decision: throttleDecision(counts), account, hash };
  });

  const verified = await verifyPassword(probe.hash ?? DUMMY_HASH, input.password);
  // A busy IP (a school NAT with many failures) is slowed, not refused: one fixed delay on every path.
  if (probe.decision.slow) await slowDown();

  const account = probe.account;
  const accountLocked = account !== null && (account.status === "locked" || (account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime()));
  const refused = probe.decision.blocked || accountLocked;
  const eligible = account !== null && probe.hash !== null && account.status === "active" && !accountLocked;
  const success = !refused && eligible && verified;
  // Human-readable reason for iam.login_attempt.outcome (audit); the response stays identical for every failure.
  const outcome: LoginOutcomeCode = success
    ? "success"
    : refused
      ? "locked"
      : account === null || probe.hash === null
        ? "unknown"
        : account.status === "disabled"
          ? "disabled"
          : "bad_password";

  return globalTx(async (tx): Promise<LoginOutcome> => {
    await recordAttempt(tx, { identifier, ip, succeeded: success, outcome, userAgent });
    if (!success || account === null) {
      // Only a COUNTED failure (the password was evaluated and was wrong) touches the account's lock state.
      if (account && outcome !== "locked") {
        await recordLoginFailure(tx, account.id, {
          until: probe.decision.lockForHour ? new Date(now.getTime() + THROTTLE.hardLockMs) : undefined,
          permanent: probe.decision.lockPermanently,
        });
      }
      return { kind: "failed" };
    }
    await recordLoginSuccess(tx, account.id);
    await bindAccount(tx, account.id); // verified account row -> account_memberships policy for this tx only
    const memberships = await listActiveMembershipsForAccount(tx, account.id);
    if (memberships.length === 0) return { kind: "no_membership" };
    const { token, session } = await createSession(
      tx,
      { userAccountId: account.id, currentOrgId: memberships[0].organizationId, isPublicDevice: input.publicDevice, ip, userAgent },
      now,
    );
    await setSessionCookie(token, { isPublicDevice: input.publicDevice, expiresAt: session.expiresAt });
    // The deep link (`/login?next=/inbox/<id>`) is honoured only as a same-origin relative path (`safeNextPath`).
    return { kind: "ok", destination: account.mustChangePassword ? "/change-password" : (safeNextPath(input.next) ?? "/home") };
  });
});

/**
 * Login. Returns a Result only on failure — on success it sets the session cookie and redirects
 * (`/change-password` when the account must change its password, else the validated `next` path or `/home`).
 * Unknown identifier, wrong password, inactive/locked account and throttling all yield a byte-identical Result.
 */
export async function loginAction(raw: FormData | unknown): Promise<Result<never>> {
  const result = await loginCore(raw);
  if (!result.ok) return result;
  switch (result.data.kind) {
    case "failed":
      return fail("UNAUTHENTICATED", LOGIN_GENERIC_MESSAGE);
    case "no_membership":
      return fail("FORBIDDEN", NO_MEMBERSHIP_MESSAGE);
    case "ok":
      redirect(result.data.destination);
  }
}

/** `useActionState` adapter for the login form. */
export async function loginFormAction(_prev: Result<never> | null, formData: FormData): Promise<Result<never>> {
  return loginAction(formData);
}

type ChangePasswordOutcome = { kind: "changed"; revokedSessions: number } | { kind: "current_rejected" };

/**
 * Password change, forced (`must_change_password`) or voluntary. Both paths: the new-password policy, `confirm`,
 * and «رمز جدید نباید با رمز قبلی یکی باشد» (the new password is verified against the CURRENT hash — the forced
 * change used to accept the temporary password itself, QA round 1 M1). The voluntary path additionally requires
 * «رمز فعلی», verified with argon2 under the LOGIN throttle of the account's identifier: a wrong guess is recorded
 * and counted like a wrong login password (so an unlocked device cannot brute-force the current password), and a
 * throttled account is refused with the same message. That refusal is RETURNED, not thrown, so the transaction
 * commits the failure record. Revokes every OTHER session of the account (the current one stays).
 */
const changePasswordCore = defineAction(
  { schema: ChangePasswordInput, permission: "iam.account.self", allowPasswordChangePending: true },
  async (tx, input, ctx): Promise<ChangePasswordOutcome> => {
    const account = await findAccountById(tx, ctx.userId);
    if (!account) throw validation();
    const forced = account.mustChangePassword;
    const currentPassword = input.currentPassword ?? "";

    const fieldErrors: Record<string, string[]> = {};
    const policy = validateNewPassword(input.newPassword, { identifier: account.loginIdentifier, phoneE164: account.phoneE164 });
    if (!policy.ok) fieldErrors.newPassword = [policy.message];
    if (input.newPassword !== input.confirm) fieldErrors.confirm = [PASSWORD_POLICY_MESSAGES.mismatch];
    if (!forced && currentPassword === "") fieldErrors.currentPassword = [CURRENT_PASSWORD_REQUIRED_MESSAGE];
    if (Object.keys(fieldErrors).length > 0) throw validation({ fieldErrors });

    const hash = await findPasswordHash(tx, ctx.userId);
    if (!forced) {
      const decision = throttleDecision(await countRecentFailures(tx, account.loginIdentifier, ctx.ip));
      // Exactly one verify whether or not the account is throttled (no timing hint about the lock state).
      const currentOk = await verifyPassword(hash ?? DUMMY_HASH, currentPassword);
      if (decision.blocked || !currentOk) {
        const outcome: LoginOutcomeCode = decision.blocked ? "locked" : "bad_password";
        await recordAttempt(tx, { identifier: account.loginIdentifier, ip: ctx.ip, succeeded: false, outcome, userAgent: ctx.userAgent });
        if (outcome === "bad_password") {
          await recordLoginFailure(tx, ctx.userId, {
            until: decision.lockForHour ? new Date(Date.now() + THROTTLE.hardLockMs) : undefined,
            permanent: decision.lockPermanently,
          });
        }
        await audit(
          ctx,
          "iam.account.password_change_rejected",
          { schema: "iam", table: "user_account", id: ctx.userId },
          null,
          { reason: outcome === "locked" ? "throttled" : "wrong_current" },
          tx,
        );
        return { kind: "current_rejected" };
      }
    }
    if (hash !== null && (await verifyPassword(hash, input.newPassword))) {
      throw validation({ fieldErrors: { newPassword: [PASSWORD_POLICY_MESSAGES.sameAsCurrent] } });
    }

    const secretHash = await hashPassword(input.newPassword);
    await setPassword(tx, ctx.userId, secretHash);
    const revoked = await revokeAllForUser(tx, ctx.userId, ctx.sessionId);
    await audit(ctx, "iam.account.password_changed", { schema: "iam", table: "user_account", id: ctx.userId }, null, { revokedSessions: revoked, forced }, tx);
    return { kind: "changed", revokedSessions: revoked };
  },
);

/** Public shape: field errors for the form, `{ revokedSessions }` on success. */
export async function changePasswordAction(raw: FormData | unknown): Promise<Result<{ revokedSessions: number }>> {
  const result = await changePasswordCore(raw);
  if (!result.ok) return result;
  if (result.data.kind === "current_rejected") {
    return fail("VALIDATION", CURRENT_PASSWORD_WRONG_MESSAGE, { currentPassword: [CURRENT_PASSWORD_WRONG_MESSAGE] });
  }
  return ok({ revokedSessions: result.data.revokedSessions });
}

/** `useActionState` adapter: redirects to /home once the password is changed. */
export async function changePasswordFormAction(
  _prev: Result<{ revokedSessions: number }> | null,
  formData: FormData,
): Promise<Result<{ revokedSessions: number }>> {
  const result = await changePasswordAction(formData);
  if (result.ok) redirect("/home");
  return result;
}

const revokeCurrentSession = defineAction(
  { schema: EmptyInput, permission: "iam.account.self", allowPasswordChangePending: true },
  async (tx, _input, ctx) => {
    await revokeSession(tx, ctx.sessionId);
    return null;
  },
);

const revokeEverySession = defineAction(
  { schema: EmptyInput, permission: "iam.account.self", allowPasswordChangePending: true },
  async (tx, _input, ctx) => {
    const revoked = await revokeAllForUser(tx, ctx.userId);
    await audit(ctx, "iam.account.sessions_revoked_all", { schema: "iam", table: "user_account", id: ctx.userId }, null, { revokedSessions: revoked }, tx);
    return revoked;
  },
);

/**
 * Logout: revokes the current session row, clears the cookie and redirects to /login?out=1 — src/proxy.ts adds
 * `Clear-Site-Data: "cache", "storage"` to that response. Works even when the session is already dead.
 */
export async function logoutAction(): Promise<never> {
  await revokeCurrentSession({});
  await clearSessionCookie();
  redirect("/login?out=1");
}

/** «خروج از همهٴ دستگاه‌ها». */
export async function logoutAllAction(): Promise<never> {
  await revokeEverySession({});
  await clearSessionCookie();
  redirect("/login?out=1");
}
