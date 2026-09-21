// Login / session / forced password change / logout against app_test, calling the Server Actions directly with
// an in-memory cookie+header store (no Next server). Fixtures are written as app_owner (set_config for RLS).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";

vi.mock("next/headers", () => import("./next-headers-mock").then((m) => m.nextHeadersMock));

import { withTenant } from "@/db/client";
import { defineAction, defineQuery } from "@/lib/actions";
import { getRequestContext } from "@/lib/ctx";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { changePasswordAction, loginAction, logoutAction, logoutAllAction } from "@/modules/iam/actions";
import { CURRENT_PASSWORD_REQUIRED_MESSAGE, CURRENT_PASSWORD_WRONG_MESSAGE, LOGIN_GENERIC_MESSAGE } from "@/modules/iam/messages";
import { PASSWORD_POLICY_MESSAGES, hashPassword } from "@/modules/iam/password";
import { unlockAccount, type IamCtx } from "@/modules/iam/service";
import { hashToken } from "@/modules/iam/session";
import { THROTTLE } from "@/modules/iam/throttle";
import * as f from "./fixtures";
import { asAppOwner } from "./helpers";
import { requestState } from "./next-headers-mock";

const PASSWORD = "Init-1405-pass";
const PERM = "iam.person.read";

interface Account {
  id: string;
  phone: string;
  personId: string;
}

let ipCounter = 10;
const freshIp = () => `10.0.0.${ipCounter++}`;
const uuid = (n: number) => `0199b000-0000-7000-8000-${String(n).padStart(12, "0")}`;

/** user_account + password identity + person + membership in ORG_A (+ optional role assignment). */
async function createAccount(
  n: number,
  opts: { mustChange?: boolean; withRole?: "organization" | "school"; status?: string } = {},
): Promise<Account> {
  const id = uuid(n);
  const personId = uuid(1000 + n);
  const phone = `+9891200000${String(n).padStart(2, "0")}`;
  const hash = await hashPassword(PASSWORD);
  await asAppOwner(async (c) => {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO iam.user_account (id, login_identifier, phone_e164, status, must_change_password)
       VALUES ($1, $2, $2, $3, $4)
       ON CONFLICT (login_identifier) DO UPDATE SET status = EXCLUDED.status, must_change_password = EXCLUDED.must_change_password,
         failed_login_count = 0, locked_until = NULL`,
      [id, phone, opts.status ?? "active", opts.mustChange ?? false],
    );
    await c.query(
      `INSERT INTO iam.auth_identity (id, user_account_id, provider, secret_hash) VALUES (app.uuid_generate_v7(), $1, 'password', $2)
       ON CONFLICT (user_account_id, provider) DO UPDATE SET secret_hash = EXCLUDED.secret_hash`,
      [id, hash],
    );
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [f.ORG_A]);
    await c.query(
      `INSERT INTO iam.person (id, organization_id, first_name, last_name) VALUES ($1, $2, 'کاربر', $3) ON CONFLICT (id) DO NOTHING`,
      [personId, f.ORG_A, `آزمون ${n}`],
    );
    await c.query(
      `INSERT INTO iam.organization_membership (id, organization_id, user_account_id, person_id, status)
       VALUES (app.uuid_generate_v7(), $1, $2, $3, 'active') ON CONFLICT (organization_id, user_account_id) DO NOTHING`,
      [f.ORG_A, id, personId],
    );
    if (opts.withRole === "school") {
      await c.query(
        `INSERT INTO iam.role_assignment (id, organization_id, person_id, role_id, scope_type, school_id)
         VALUES (app.uuid_generate_v7(), $1, $2, $3, 'school', $4) ON CONFLICT DO NOTHING`,
        [f.ORG_A, personId, f.ROLE_A, f.SCHOOL_A],
      );
    } else if (opts.withRole === "organization") {
      await c.query(
        `INSERT INTO iam.role_assignment (id, organization_id, person_id, role_id, scope_type)
         VALUES (app.uuid_generate_v7(), $1, $2, $3, 'organization') ON CONFLICT DO NOTHING`,
        [f.ORG_A, personId, f.ROLE_A],
      );
    }
    await c.query("COMMIT");
  });
  return { id, phone, personId };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  fd.append("$ACTION_ID_abc", "x"); // Next adds this on progressive-enhancement posts; strict schemas must survive it
  return fd;
}

/** Runs an action that is expected to redirect; returns the target path. */
async function expectRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (isRedirectError(err)) return err.digest.split(";")[2];
    throw err;
  }
  throw new Error("expected a redirect");
}

async function sessionRows(accountId: string) {
  return asAppOwner(async (c) => {
    const r = await c.query<{ id: string; token_hash: string; revoked_at: Date | null; expires_at: Date; is_public_device: boolean; current_org_id: string }>(
      "select id, token_hash, revoked_at, expires_at, is_public_device, current_org_id from iam.user_session where user_account_id = $1 order by created_at",
      [accountId],
    );
    return r.rows;
  });
}

async function attempts(identifier: string) {
  return asAppOwner(async (c) => {
    const r = await c.query<{ succeeded: boolean; ip: string; outcome: string | null; cleared_at: Date | null }>(
      "select succeeded, ip, outcome, cleared_at from iam.login_attempt where identifier = $1 order by at, id",
      [identifier],
    );
    return r.rows;
  });
}

/** `n` counted (`outcome` NULL = legacy) failures of `identifier`, `ago` in the past, from a fixed foreign IP. */
async function insertFailures(identifier: string, n: number, ago: string): Promise<void> {
  await asAppOwner((c) =>
    c.query(
      `insert into iam.login_attempt (id, identifier, ip, succeeded, at)
       select app.uuid_generate_v7(), $1, '10.9.9.9', false, now() - $2::interval from generate_series(1, $3)`,
      [identifier, ago, n],
    ),
  );
}

/** `n` failures from `ip` against unknown identifiers (credential spraying), just now. */
async function insertIpFailures(ip: string, n: number): Promise<void> {
  await asAppOwner((c) =>
    c.query(
      `insert into iam.login_attempt (id, identifier, ip, succeeded, outcome, at)
       select app.uuid_generate_v7(), '+98912777' || lpad(g::text, 4, '0'), $1::inet, false, 'unknown', now() from generate_series(1, $2) g`,
      [ip, n],
    ),
  );
}

/** Simulates time passing for the COUNTED failures of an identifier (the refused `locked` rows keep their timestamp). */
async function ageCountedFailures(identifier: string, by: string): Promise<void> {
  await asAppOwner((c) =>
    c.query("update iam.login_attempt set at = at - $2::interval where identifier = $1 and succeeded = false and outcome is distinct from 'locked'", [identifier, by]),
  );
}

async function auditActions(accountId: string): Promise<Array<{ action: string; after: Record<string, unknown> | null }>> {
  return asAppOwner(async (c) => {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [f.ORG_A]);
    const r = await c.query<{ action: string; after: Record<string, unknown> | null }>(
      "select action, after from audit.audit_log where entity_table = 'user_account' and entity_id = $1 order by at, id",
      [accountId],
    );
    await c.query("COMMIT");
    return r.rows;
  });
}

/** An organization admin of A acting through the iam service (what unlockAccountAction does after its own scope checks). */
const adminCtx: IamCtx = { orgId: f.ORG_A, personId: f.PERSON_A1, userId: null, requestId: "int-test", assignments: [] };

async function accountRow(id: string) {
  return asAppOwner(async (c) => {
    const r = await c.query<{ failed_login_count: number; locked_until: Date | null; status: string; must_change_password: boolean }>(
      "select failed_login_count, locked_until, status, must_change_password from iam.user_account where id = $1",
      [id],
    );
    return r.rows[0];
  });
}

const readPersonsCount = defineQuery({ permission: PERM }, async (tx) => {
  const r = await tx.execute<{ n: number }>("select count(*)::int as n from iam.person");
  return r.rows[0].n;
});

const noopAction = defineAction({ schema: z.object({}).strict(), permission: PERM }, async () => "done");

const SchoolInput = z.object({ schoolId: z.uuid() }).strict();
const schoolScopedAction = defineAction(
  { schema: SchoolInput, permission: PERM, scope: (i) => ({ scopeType: "school", id: i.schoolId }) },
  async (_tx, input) => input.schoolId,
);

beforeAll(async () => {
  // The permission catalog + role_permission for ROLE_A (fixture role 'principal' @ school) — normally the seed's job.
  await asAppOwner(async (c) => {
    await c.query(`INSERT INTO iam.permission (code, module, name) VALUES ($1, 'iam', 'x') ON CONFLICT (code) DO NOTHING`, [PERM]);
    await c.query(`INSERT INTO iam.role_permission (role_id, permission_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [f.ROLE_A, PERM]);
  });
});

beforeEach(() => {
  requestState.reset();
  requestState.headers.set("x-forwarded-for", `${freshIp()}, 172.16.0.1`);
  requestState.headers.set("user-agent", "vitest");
});

describe("loginAction", () => {
  it("happy path: session row + cookie flags + redirect to /home; identifier accepts Persian digits and 0-prefix", async () => {
    const acc = await createAccount(1, { withRole: "school" });
    const target = await expectRedirect(() => loginAction(form({ identifier: "۰۹۱۲ ۰۰۰ ۰۰۰۱", password: PASSWORD })));
    expect(target).toBe("/home");

    const rows = await sessionRows(acc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
    expect(rows[0].is_public_device).toBe(false);
    expect(rows[0].current_org_id).toBe(f.ORG_A);
    const days = (rows[0].expires_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const set = requestState.setCookieCalls.at(-1)!;
    expect(set.name).toBe(SESSION_COOKIE_NAME);
    expect(set.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(set.value)).toBe(rows[0].token_hash);
    expect(set.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect(set.options?.expires).toBeInstanceOf(Date);

    const recorded = await attempts(acc.phone);
    expect(recorded.at(-1)?.succeeded).toBe(true);

    const ctx = await getRequestContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(acc.id);
    expect(ctx!.orgId).toBe(f.ORG_A);
    expect(ctx!.personId).toBe(acc.personId);
    expect(ctx!.firstName).toBe("کاربر");
    expect(ctx!.orgName).toBe("مدرسه الف");
    expect(ctx!.schoolName).toBe("دبستان");
    expect(ctx!.assignments).toHaveLength(1);
    expect(ctx!.assignments[0]).toMatchObject({ roleCode: "principal", scopeType: "school", scopeId: f.SCHOOL_A, permissions: [PERM] });
  });

  it("honours a same-origin `next` deep link after login and ignores anything else", async () => {
    const acc = await createAccount(20);
    expect(await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD, next: "/inbox/0199b000-0000-7000-8000-000000000001?tab=done" })))).toBe(
      "/inbox/0199b000-0000-7000-8000-000000000001?tab=done",
    );
    requestState.cookies.clear();
    expect(await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD, next: "https://evil.example/inbox" })))).toBe("/home");
    requestState.cookies.clear();
    expect(await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD, next: "//evil.example" })))).toBe("/home");
    requestState.cookies.clear();
    // A pending forced change always wins over the deep link.
    const forced = await createAccount(21, { mustChange: true });
    expect(await expectRedirect(() => loginAction(form({ identifier: forced.phone, password: PASSWORD, next: "/inbox" })))).toBe("/change-password");
  });

  it("public device: 8h expiry, no Max-Age/expires on the cookie", async () => {
    const acc = await createAccount(2);
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD, publicDevice: "on" })));
    const rows = await sessionRows(acc.id);
    expect(rows[0].is_public_device).toBe(true);
    const hours = (rows[0].expires_at.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.9);
    expect(hours).toBeLessThan(8.1);
    const set = requestState.setCookieCalls.at(-1)!;
    expect(set.options?.expires).toBeUndefined();
    expect(set.options?.maxAge).toBeUndefined();
  });

  it("wrong password: generic message, attempt recorded, failed_login_count incremented, no session, no cookie", async () => {
    const acc = await createAccount(3);
    const res = await loginAction(form({ identifier: acc.phone, password: "nope-nope" }));
    expect(res).toEqual({ ok: false, code: "UNAUTHENTICATED", message: LOGIN_GENERIC_MESSAGE });
    expect(await attempts(acc.phone)).toEqual([{ succeeded: false, ip: expect.any(String), outcome: "bad_password", cleared_at: null }]);
    expect((await accountRow(acc.id)).failed_login_count).toBe(1);
    expect(await sessionRows(acc.id)).toHaveLength(0);
    expect(requestState.setCookieCalls).toHaveLength(0);
  });

  it("unknown identifier and wrong password return byte-identical Results (no enumeration)", async () => {
    const acc = await createAccount(4);
    const unknown = await loginAction(form({ identifier: "+989129999999", password: "whatever-1" }));
    const wrong = await loginAction(form({ identifier: acc.phone, password: "whatever-1" }));
    const disabledAcc = await createAccount(5, { status: "disabled" });
    const disabled = await loginAction(form({ identifier: disabledAcc.phone, password: PASSWORD }));
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(wrong));
    expect(JSON.stringify(disabled)).toBe(JSON.stringify(wrong));
    expect(await attempts("+989129999999")).toHaveLength(1);
  });

  it("5 failures → soft lock: the 6th attempt with the RIGHT password fails identically, is recorded as `locked` and is NOT counted", async () => {
    const acc = await createAccount(6);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await loginAction(form({ identifier: acc.phone, password: "bad-password" })));
    const sixth = await loginAction(form({ identifier: acc.phone, password: PASSWORD }));
    expect(JSON.stringify(sixth)).toBe(JSON.stringify(results[0]));
    expect(await sessionRows(acc.id)).toHaveLength(0);
    const recorded = await attempts(acc.phone);
    expect(recorded.map((a) => a.outcome)).toEqual(["bad_password", "bad_password", "bad_password", "bad_password", "bad_password", "locked"]);
    expect(recorded.every((a) => !a.succeeded)).toBe(true);
    // The refused attempt did not touch the account: five real failures, no hour lock.
    expect(await accountRow(acc.id)).toMatchObject({ failed_login_count: 5, locked_until: null, status: "active" });
  });

  it("retrying during a soft lock (even with the RIGHT password) does not extend the window or escalate the lock", async () => {
    const acc = await createAccount(22);
    for (let i = 0; i < 5; i++) await loginAction(form({ identifier: acc.phone, password: "bad-password" }));
    for (let i = 0; i < 5; i++) expect(await loginAction(form({ identifier: acc.phone, password: PASSWORD }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    // Before the fix these five retries counted: 10 in an hour → locked_until = +1h, and the window kept sliding.
    expect(await accountRow(acc.id)).toMatchObject({ failed_login_count: 5, locked_until: null, status: "active" });
    // Sixteen minutes later (simulated for the five counted failures only — the refused rows are still "just now") …
    await ageCountedFailures(acc.phone, "16 minutes");
    // … the right password works: the refused attempts never counted.
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    expect((await accountRow(acc.id)).failed_login_count).toBe(0);
  });

  it("«رفع قفل» clears the throttle too: soft-locked → unlock → the right password logs in at once (audit keeps the rows)", async () => {
    const acc = await createAccount(23);
    for (let i = 0; i < 5; i++) await loginAction(form({ identifier: acc.phone, password: "bad-password" }));
    expect(await loginAction(form({ identifier: acc.phone, password: PASSWORD }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });

    const unlocked = await withTenant({ orgId: f.ORG_A, personId: f.PERSON_A1 }, (tx) => unlockAccount(tx, adminCtx, { userAccountId: acc.id }));
    expect(unlocked).toEqual({ clearedAttempts: 6 }); // 5 counted + 1 refused: all stamped, none deleted
    expect(await accountRow(acc.id)).toMatchObject({ failed_login_count: 0, locked_until: null, status: "active" });
    const rows = await attempts(acc.phone);
    expect(rows).toHaveLength(6);
    expect(rows.every((a) => a.cleared_at instanceof Date)).toBe(true);
    expect((await auditActions(acc.id)).at(-1)).toMatchObject({ action: "iam.account.unlocked", after: { status: "active", clearedAttempts: 6 } });

    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    expect((await attempts(acc.phone)).at(-1)).toMatchObject({ succeeded: true, outcome: "success", cleared_at: null });
  });

  it("10 counted failures within an hour set locked_until; 20 within 24 h set status = locked; refused attempts escalate nothing", async () => {
    const acc = await createAccount(7);
    await insertFailures(acc.phone, 9, "30 minutes");
    await loginAction(form({ identifier: acc.phone, password: "bad-password" })); // the 10th counted failure
    let row = await accountRow(acc.id);
    expect(row.locked_until).toBeInstanceOf(Date);
    expect(row.status).toBe("active");
    expect(row.failed_login_count).toBe(1);

    // Hammering the hour-locked account, right or wrong password: recorded as `locked`, nothing changes.
    await loginAction(form({ identifier: acc.phone, password: "bad-password" }));
    await loginAction(form({ identifier: acc.phone, password: PASSWORD }));
    row = await accountRow(acc.id);
    expect(row.failed_login_count).toBe(1);
    expect(row.status).toBe("active");
    expect((await attempts(acc.phone)).slice(-2).map((a) => a.outcome)).toEqual(["locked", "locked"]);

    // Two hours later (simulated): the hour lock is over and the ten failures left the 1 h window but not the 24 h one.
    await ageCountedFailures(acc.phone, "2 hours");
    await asAppOwner((c) => c.query("update iam.user_account set locked_until = null where id = $1", [acc.id]));
    await insertFailures(acc.phone, 9, "5 hours"); // 24 h: 10 + 9 = 19 counted
    await loginAction(form({ identifier: acc.phone, password: "bad-password" })); // the 20th
    row = await accountRow(acc.id);
    expect(row.status).toBe("locked");
  });

  it("per IP: 300 failures in 10 min only SLOW logins from that IP (a school NAT keeps working); 1000 refuse them", async () => {
    const acc = await createAccount(24);
    const ip = freshIp();
    requestState.headers.set("x-forwarded-for", ip);
    await insertIpFailures(ip, THROTTLE.ipSlow10m);
    const started = Date.now();
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    expect(Date.now() - started).toBeGreaterThanOrEqual(THROTTLE.slowDelayMs - 50);
    requestState.cookies.clear();

    await insertIpFailures(ip, THROTTLE.ipBlock10m - THROTTLE.ipSlow10m);
    const refused = await loginAction(form({ identifier: acc.phone, password: PASSWORD }));
    expect(refused).toEqual({ ok: false, code: "UNAUTHENTICATED", message: LOGIN_GENERIC_MESSAGE });
    expect((await attempts(acc.phone)).at(-1)).toMatchObject({ succeeded: false, outcome: "locked" });
    // The identifier is innocent: no failure is charged to the account.
    expect(await accountRow(acc.id)).toMatchObject({ failed_login_count: 0, locked_until: null, status: "active" });
    // From another IP the same account logs in immediately.
    requestState.headers.set("x-forwarded-for", freshIp());
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
  });

  it("rejects unknown fields and empty input with VALIDATION (strict schema) without touching the DB", async () => {
    const res = await loginAction(form({ identifier: "x", password: "y", extra: "1" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
    const empty = await loginAction(form({ identifier: "", password: "" }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.fieldErrors?.identifier?.[0]).toMatch(/وارد کنید/);
  });
});

describe("must_change_password gate", () => {
  it("login redirects to /change-password; other actions and queries fail with PASSWORD_CHANGE_REQUIRED", async () => {
    const acc = await createAccount(8, { mustChange: true, withRole: "organization" });
    const target = await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    expect(target).toBe("/change-password");
    expect((await getRequestContext())?.mustChangePassword).toBe(true);

    const action = await noopAction({});
    expect(action).toEqual({ ok: false, code: "PASSWORD_CHANGE_REQUIRED", message: "ابتدا رمز خود را تغییر دهید." });
    const query = await readPersonsCount();
    expect(query).toMatchObject({ ok: false, code: "PASSWORD_CHANGE_REQUIRED" });
  });

  it("changePasswordAction enforces the policy with field errors, then clears the flag and revokes OTHER sessions", async () => {
    const acc = await createAccount(9, { mustChange: true, withRole: "organization" });
    // Two sessions: an "other device" first, then the current one.
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    const otherCookie = requestState.cookies.get(SESSION_COOKIE_NAME)!;
    requestState.cookies.clear();
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    expect(await sessionRows(acc.id)).toHaveLength(2);

    const weak = await changePasswordAction(form({ newPassword: "12345678", confirm: "12345678" }));
    expect(weak).toMatchObject({ ok: false, code: "VALIDATION" });
    if (!weak.ok) expect(weak.fieldErrors?.newPassword?.[0]).toBeTruthy();
    const mismatch = await changePasswordAction(form({ newPassword: "Kh0rshid-1405", confirm: "Kh0rshid-1406" }));
    if (!mismatch.ok) expect(mismatch.fieldErrors?.confirm?.[0]).toBe("تکرار رمز با رمز جدید یکی نیست.");
    const asPhone = await changePasswordAction(form({ newPassword: acc.phone, confirm: acc.phone }));
    expect(asPhone.ok).toBe(false);
    // M1: re-entering the temporary password as the "new" one is refused (verified against the current hash).
    const same = await changePasswordAction(form({ newPassword: PASSWORD, confirm: PASSWORD }));
    expect(same).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { newPassword: [PASSWORD_POLICY_MESSAGES.sameAsCurrent] } });
    expect((await accountRow(acc.id)).must_change_password).toBe(true);

    const changed = await changePasswordAction(form({ newPassword: "Kh0rshid-1405", confirm: "Kh0rshid-1405" }));
    expect(changed).toEqual({ ok: true, data: { revokedSessions: 1 } });
    expect((await accountRow(acc.id)).must_change_password).toBe(false);

    const rows = await sessionRows(acc.id);
    expect(rows.filter((r) => r.revoked_at === null)).toHaveLength(1);
    expect(rows.find((r) => r.token_hash === hashToken(otherCookie))?.revoked_at).toBeInstanceOf(Date);

    // The gate is open now, the other device is out, and the old password is dead.
    expect(await noopAction({})).toEqual({ ok: true, data: "done" });
    requestState.cookies.set(SESSION_COOKIE_NAME, otherCookie);
    expect(await getRequestContext()).toBeNull();
    requestState.cookies.clear();
    requestState.headers.set("x-forwarded-for", freshIp());
    expect(await loginAction(form({ identifier: acc.phone, password: PASSWORD }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: "Kh0rshid-1405" })));
  });
});

describe("voluntary password change (must_change_password = false)", () => {
  it("requires and verifies «رمز فعلی» under the login throttle; wrong guesses are counted login failures; success revokes the other sessions", async () => {
    const acc = await createAccount(25);
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    const otherCookie = requestState.cookies.get(SESSION_COOKIE_NAME)!;
    requestState.cookies.clear();
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    const NEW = "Kh0rshid-1405";

    const missing = await changePasswordAction(form({ newPassword: NEW, confirm: NEW }));
    expect(missing).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { currentPassword: [CURRENT_PASSWORD_REQUIRED_MESSAGE] } });
    expect((await attempts(acc.phone)).filter((a) => !a.succeeded)).toHaveLength(0); // nothing to count: no guess was made

    const wrong = await changePasswordAction(form({ currentPassword: "not-my-password", newPassword: NEW, confirm: NEW }));
    expect(wrong).toEqual({ ok: false, code: "VALIDATION", message: CURRENT_PASSWORD_WRONG_MESSAGE, fieldErrors: { currentPassword: [CURRENT_PASSWORD_WRONG_MESSAGE] } });
    expect((await attempts(acc.phone)).at(-1)).toMatchObject({ succeeded: false, outcome: "bad_password" });
    expect((await accountRow(acc.id)).failed_login_count).toBe(1);
    expect((await auditActions(acc.id)).at(-1)).toMatchObject({ action: "iam.account.password_change_rejected", after: { reason: "wrong_current" } });
    expect((await accountRow(acc.id)).must_change_password).toBe(false);

    // Four more guesses reach the login soft lock: now even the RIGHT current password is refused (same message) …
    for (let i = 0; i < 4; i++) await changePasswordAction(form({ currentPassword: `guess-${i}`, newPassword: NEW, confirm: NEW }));
    const throttled = await changePasswordAction(form({ currentPassword: PASSWORD, newPassword: NEW, confirm: NEW }));
    expect(throttled).toEqual(wrong);
    expect((await attempts(acc.phone)).at(-1)).toMatchObject({ succeeded: false, outcome: "locked" });
    expect((await auditActions(acc.id)).at(-1)).toMatchObject({ action: "iam.account.password_change_rejected", after: { reason: "throttled" } });
    expect((await accountRow(acc.id)).failed_login_count).toBe(5);
    // … and so is the login form (one throttle for both doors).
    const cookie = requestState.cookies.get(SESSION_COOKIE_NAME)!;
    requestState.cookies.clear();
    expect(await loginAction(form({ identifier: acc.phone, password: PASSWORD }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    requestState.cookies.set(SESSION_COOKIE_NAME, cookie);
    // The password never changed.
    expect((await attempts(acc.phone)).filter((a) => a.succeeded)).toHaveLength(2);

    await ageCountedFailures(acc.phone, "16 minutes");
    // New == current is refused even with the right current password.
    const same = await changePasswordAction(form({ currentPassword: PASSWORD, newPassword: PASSWORD, confirm: PASSWORD }));
    expect(same).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { newPassword: [PASSWORD_POLICY_MESSAGES.sameAsCurrent] } });

    const changed = await changePasswordAction(form({ currentPassword: PASSWORD, newPassword: NEW, confirm: NEW }));
    expect(changed).toEqual({ ok: true, data: { revokedSessions: 1 } });
    expect((await auditActions(acc.id)).at(-1)).toMatchObject({ action: "iam.account.password_changed", after: { revokedSessions: 1, forced: false } });
    const rows = await sessionRows(acc.id);
    expect(rows.filter((r) => r.revoked_at === null)).toHaveLength(1);
    expect(rows.find((r) => r.token_hash === hashToken(otherCookie))?.revoked_at).toBeInstanceOf(Date);
    expect(await getRequestContext()).not.toBeNull(); // the current session survives

    requestState.cookies.clear();
    requestState.headers.set("x-forwarded-for", freshIp());
    expect(await loginAction(form({ identifier: acc.phone, password: PASSWORD }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: NEW })));
  });
});

describe("defineAction / defineQuery with a real permission", () => {
  it("UNAUTHENTICATED without a cookie; FORBIDDEN without the permission; ok with it", async () => {
    expect(await noopAction({})).toEqual({ ok: false, code: "UNAUTHENTICATED", message: "برای ادامه وارد حساب خود شوید." });
    const noRole = await createAccount(10);
    await expectRedirect(() => loginAction(form({ identifier: noRole.phone, password: PASSWORD })));
    expect(await noopAction({})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await readPersonsCount()).toMatchObject({ ok: false, code: "FORBIDDEN" });

    requestState.cookies.clear();
    const withRole = await createAccount(11, { withRole: "organization" });
    await expectRedirect(() => loginAction(form({ identifier: withRole.phone, password: PASSWORD })));
    expect(await noopAction({})).toEqual({ ok: true, data: "done" });
    const count = await readPersonsCount();
    expect(count.ok).toBe(true);
    if (count.ok) expect(count.data).toBeGreaterThanOrEqual(f.PERSONS_IN_A);
    expect(await noopAction({ unexpected: 1 })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("a school-scoped role passes only for refs inside its school; org-level checks and foreign refs are FORBIDDEN", async () => {
    const principal = await createAccount(15, { withRole: "school" });
    await expectRedirect(() => loginAction(form({ identifier: principal.phone, password: PASSWORD })));
    expect(await noopAction({})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await schoolScopedAction({ schoolId: f.SCHOOL_A })).toEqual({ ok: true, data: f.SCHOOL_A });
    // SCHOOL_B belongs to organization B: invisible under RLS → chain unresolvable → FORBIDDEN (no existence leak).
    expect(await schoolScopedAction({ schoolId: f.SCHOOL_B })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("logout and dead sessions", () => {
  it("logoutAction revokes the row, clears the cookie and redirects to /login?out=1", async () => {
    const acc = await createAccount(12);
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    const target = await expectRedirect(() => logoutAction());
    expect(target).toBe("/login?out=1");
    expect((await sessionRows(acc.id))[0].revoked_at).toBeInstanceOf(Date);
    expect(requestState.cookies.has(SESSION_COOKIE_NAME)).toBe(false);
    const cleared = requestState.setCookieCalls.at(-1)!;
    expect(cleared.options).toMatchObject({ maxAge: 0, httpOnly: true, path: "/" });
  });

  it("logoutAllAction revokes every session of the account", async () => {
    const acc = await createAccount(13);
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    requestState.cookies.clear();
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    await expectRedirect(() => logoutAllAction());
    expect((await sessionRows(acc.id)).every((r) => r.revoked_at !== null)).toBe(true);
  });

  it("getRequestContext is null for a revoked, an expired and a garbage cookie", async () => {
    const acc = await createAccount(14);
    await expectRedirect(() => loginAction(form({ identifier: acc.phone, password: PASSWORD })));
    const token = requestState.cookies.get(SESSION_COOKIE_NAME)!;
    expect(await getRequestContext()).not.toBeNull();

    await asAppOwner((c) => c.query("update iam.user_session set expires_at = now() - interval '1 second' where token_hash = $1", [hashToken(token)]));
    expect(await getRequestContext()).toBeNull();

    await asAppOwner((c) =>
      c.query("update iam.user_session set expires_at = now() + interval '1 day', revoked_at = now() where token_hash = $1", [hashToken(token)]),
    );
    expect(await getRequestContext()).toBeNull();

    requestState.cookies.set(SESSION_COOKIE_NAME, "definitely-not-a-token");
    expect(await getRequestContext()).toBeNull();
  });
});
