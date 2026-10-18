"use server";
// «ورود آزمایشی» — sign in as a chosen demo account WITHOUT a password (docs/decisions.md 2026-10-18). The second and
// last pre-authentication action besides login; it goes through `defineDemoAction` (src/lib/actions), so before
// anything else it needs DEMO_LOGIN=1 and this browser's valid unlock cookie — or the pilot's open mode
// (DEMO_LOGIN_OPEN=1, every visitor) — otherwise NOT_FOUND, exactly what a feature that does not exist answers. The
// input is ONE user_account id (`.strict()`); the organization and the person come from the database. No password is
// read, compared or set anywhere on this path. Open mode changes only the per-IP cap (`demoRateCaps`) and adds
// `open: true` to the audit row and the log lines.
//
//   1. global transaction: the demo rate limit (sessions created with DEMO_SESSION_LABEL in 10 minutes, per IP and
//      in all), the account row, then — bound to THAT row — every membership it has in any organization; the pure
//      rule `demoTarget` (./eligibility) says yes, or which reason it refuses (one answer for all of them).
//   2. `demoOrgTx(target organization)` — opens only for an allow-listed organization: the person row FOR SHARE (a
//      removal in flight finishes first — ../removal «Concurrency»), the whole rule again on fresh rows, the person
//      still live; then this browser's previous session (if any) is revoked, the new session is created the way
//      login creates it (opaque token, sha256 in the database) as a PUBLIC-DEVICE session (8 hours, a browser-session
//      cookie, never extended) marked DEMO_SESSION_LABEL, and `iam.demo_login` is audited in the target
//      organization — the target account, its person, the session and the operator's IP — in the same transaction.
//   3. the session cookie (same name and flags as login), then /home.
import { redirect } from "next/navigation";
import { z } from "zod";
import { defineDemoAction, fail, type Result } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { rateLimited } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getClientIp, getUserAgent } from "@/lib/request";
import { lockPersonForShare } from "../repo";
import { createSession, readSessionToken, revokeSessionByToken, setSessionCookie } from "../session";
import { demoTarget, type DemoRefusal } from "./eligibility";
import { DEMO_ACCOUNT_REQUIRED_MESSAGE, DEMO_LOGIN_REFUSED_MESSAGE } from "./messages";
import { DEMO_SESSION_LABEL, countRecentDemoSessions, demoRateCaps, findDemoAccount, isLiveDemoMember, listDemoMemberships } from "./repo";

const DemoLoginInput = z.object({ accountId: z.uuid(DEMO_ACCOUNT_REQUIRED_MESSAGE) }).strict();

type DemoLoginOutcome = { kind: "ok" } | { kind: "refused"; reason: DemoRefusal | "changed" };

const demoLoginCore = defineDemoAction({ schema: DemoLoginInput }, async (input, tools): Promise<DemoLoginOutcome> => {
  const ip = await getClientIp();
  const userAgent = await getUserAgent();
  const now = new Date();
  const caps = demoRateCaps(tools.open);
  /** Open mode is marked on every log line and on the audit row; keyed rows stay as before (no `open` key). */
  const mode = tools.open ? { open: true as const } : {};

  const probe = await tools.globalTx(async (tx) => {
    const recent = await countRecentDemoSessions(tx, ip);
    if (recent.ip >= caps.perIp10m || recent.all >= caps.all10m) return { limited: true as const };
    const account = await findDemoAccount(tx, input.accountId);
    if (!account) return { limited: false as const, accountId: null, target: demoTarget(null, [], tools.allowedOrgSlugs, now) };
    await tools.bindAccount(tx, account.id);
    const memberships = await listDemoMemberships(tx, account.id);
    return { limited: false as const, accountId: account.id, target: demoTarget(account, memberships, tools.allowedOrgSlugs, now) };
  });
  if (probe.limited) {
    logger.warn({ requestId: tools.requestId, ip, ...mode }, "demo login: rate limited");
    throw rateLimited();
  }
  if (!probe.target.ok || probe.accountId === null) {
    const reason = probe.target.ok ? "no_account" : probe.target.reason;
    logger.warn({ requestId: tools.requestId, ip, accountId: input.accountId, reason, ...mode }, "demo login: refused");
    return { kind: "refused", reason };
  }
  const accountId = probe.accountId;
  const { organizationId, personId } = probe.target;

  const created = await tools.demoOrgTx(organizationId, async (tx) => {
    await lockPersonForShare(tx, personId);
    const account = await findDemoAccount(tx, accountId);
    if (!account) return null;
    await tools.bindAccount(tx, account.id);
    const again = demoTarget(account, await listDemoMemberships(tx, account.id), tools.allowedOrgSlugs, now);
    if (!again.ok || again.organizationId !== organizationId || again.personId !== personId) return null;
    if (!(await isLiveDemoMember(tx, account.id, personId))) return null;

    const previous = await readSessionToken();
    const revokedPrevious = previous ? await revokeSessionByToken(tx, previous) : 0;
    const { token, session } = await createSession(
      tx,
      { userAccountId: account.id, currentOrgId: organizationId, isPublicDevice: true, ip, userAgent, deviceLabel: DEMO_SESSION_LABEL },
      now,
    );
    await audit(
      { orgId: organizationId, personId: null, userId: null, requestId: tools.requestId, ip, userAgent },
      "iam.demo_login",
      { schema: "iam", table: "user_account", id: account.id },
      null,
      { personId, sessionId: session.id, publicDevice: true, revokedPrevious, ...mode },
      tx,
    );
    return { token, expiresAt: session.expiresAt };
  });
  if (!created) {
    logger.warn({ requestId: tools.requestId, ip, accountId, ...mode }, "demo login: refused (changed under the request)");
    return { kind: "refused", reason: "changed" };
  }
  await setSessionCookie(created.token, { isPublicDevice: true, expiresAt: created.expiresAt });
  logger.info({ requestId: tools.requestId, ip, accountId, organizationId, ...mode }, "demo login");
  return { kind: "ok" };
});

/**
 * Returns a Result only when it does not sign in — NOT_FOUND (no gate), VALIDATION, RATE_LIMITED, or FORBIDDEN with one
 * message for every refused account. On success it sets the session cookie and redirects to /home.
 */
export async function demoLoginAction(raw: FormData | unknown): Promise<Result<never>> {
  const result = await demoLoginCore(raw);
  if (!result.ok) return result;
  if (result.data.kind === "refused") return fail("FORBIDDEN", DEMO_LOGIN_REFUSED_MESSAGE);
  redirect("/home");
}

/** `useActionState` adapter for the «ورود آزمایشی» panel. */
export async function demoLoginFormAction(_prev: Result<never> | null, formData: FormData): Promise<Result<never>> {
  return demoLoginAction(formData);
}
