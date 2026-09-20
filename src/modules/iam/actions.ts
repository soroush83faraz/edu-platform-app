"use server";
// iam Server Actions. `loginAction` is the ONE pre-authentication action in the codebase and therefore the only
// one that does not go through defineAction's permission gate; it still parses with a `.strict()` schema, is
// throttled through iam.login_attempt, always runs exactly one argon2 verify and returns one generic error.
import { redirect } from "next/navigation";
import { defineAction, definePublicAction, fail, type Result } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { validation } from "@/lib/errors";
import { normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";
import { getClientIp, getUserAgent } from "@/lib/request";
import { ChangePasswordInput, EmptyInput, LoginInput } from "./dto";
import { LOGIN_GENERIC_MESSAGE, NO_MEMBERSHIP_MESSAGE } from "./messages";
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
import { THROTTLE, countRecentFailures, recordAttempt, throttleDecision } from "./throttle";

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
  const account = probe.account;
  const eligible =
    account !== null &&
    probe.hash !== null &&
    account.status === "active" &&
    (account.lockedUntil === null || account.lockedUntil.getTime() <= now.getTime());
  const success = !probe.decision.blocked && eligible && verified;

  return globalTx(async (tx): Promise<LoginOutcome> => {
    await recordAttempt(tx, identifier, ip, success);
    if (!success || account === null) {
      if (account) {
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
    return { kind: "ok", destination: account.mustChangePassword ? "/change-password" : "/home" };
  });
});

/**
 * Login. Returns a Result only on failure — on success it sets the session cookie and redirects
 * (`/change-password` when the account must change its password, `/home` otherwise).
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

/**
 * Forced (or voluntary) password change. Allowed while must_change_password is set. Revokes every OTHER session
 * of the account so a stolen initial password stops working everywhere else.
 */
export const changePasswordAction = defineAction(
  { schema: ChangePasswordInput, permission: "iam.account.self", allowPasswordChangePending: true },
  async (tx, input, ctx) => {
    const account = await findAccountById(tx, ctx.userId);
    if (!account) throw validation();
    const fieldErrors: Record<string, string[]> = {};
    const policy = validateNewPassword(input.newPassword, { identifier: account.loginIdentifier, phoneE164: account.phoneE164 });
    if (!policy.ok) fieldErrors.newPassword = [policy.message];
    if (input.newPassword !== input.confirm) fieldErrors.confirm = [PASSWORD_POLICY_MESSAGES.mismatch];
    if (Object.keys(fieldErrors).length > 0) throw validation({ fieldErrors });

    const secretHash = await hashPassword(input.newPassword);
    await setPassword(tx, ctx.userId, secretHash);
    const revoked = await revokeAllForUser(tx, ctx.userId, ctx.sessionId);
    // TODO(audit): becomes a real row in DB step 2.
    await audit(ctx, "iam.account.password_changed", { type: "user_account", id: ctx.userId }, null, { revokedSessions: revoked }, tx);
    return { revokedSessions: revoked };
  },
);

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
  async (tx, _input, ctx) => revokeAllForUser(tx, ctx.userId),
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
