// Login / session / forced password change / logout against app_test, calling the Server Actions directly with
// an in-memory cookie+header store (no Next server). Fixtures are written as app_owner (set_config for RLS).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";

vi.mock("next/headers", () => import("./next-headers-mock").then((m) => m.nextHeadersMock));

import { defineAction, defineQuery } from "@/lib/actions";
import { getRequestContext } from "@/lib/ctx";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { changePasswordAction, loginAction, logoutAction, logoutAllAction } from "@/modules/iam/actions";
import { LOGIN_GENERIC_MESSAGE } from "@/modules/iam/messages";
import { hashPassword } from "@/modules/iam/password";
import { hashToken } from "@/modules/iam/session";
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
    const r = await c.query<{ succeeded: boolean; ip: string }>("select succeeded, ip from iam.login_attempt where identifier = $1 order by at", [identifier]);
    return r.rows;
  });
}

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
    expect(await attempts(acc.phone)).toEqual([{ succeeded: false, ip: expect.any(String) }]);
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

  it("6 failures → soft lock: the 6th attempt with the RIGHT password fails identically and is still recorded", async () => {
    const acc = await createAccount(6);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await loginAction(form({ identifier: acc.phone, password: "bad-password" })));
    const sixth = await loginAction(form({ identifier: acc.phone, password: PASSWORD }));
    expect(JSON.stringify(sixth)).toBe(JSON.stringify(results[0]));
    expect(await sessionRows(acc.id)).toHaveLength(0);
    const recorded = await attempts(acc.phone);
    expect(recorded).toHaveLength(6);
    expect(recorded.every((a) => !a.succeeded)).toBe(true);
    expect((await accountRow(acc.id)).failed_login_count).toBe(6);
  });

  it("10 failures within an hour set locked_until; 20 set status = locked", async () => {
    const acc = await createAccount(7);
    await asAppOwner((c) =>
      c.query(
        `insert into iam.login_attempt (id, identifier, ip, succeeded, at)
         select app.uuid_generate_v7(), $1, '10.9.9.9', false, now() - interval '30 minutes' from generate_series(1, 9)`,
        [acc.phone],
      ),
    );
    await loginAction(form({ identifier: acc.phone, password: "bad-password" }));
    let row = await accountRow(acc.id);
    expect(row.locked_until).toBeInstanceOf(Date);
    expect(row.status).toBe("active");

    await asAppOwner((c) =>
      c.query(
        `insert into iam.login_attempt (id, identifier, ip, succeeded, at)
         select app.uuid_generate_v7(), $1, '10.9.9.9', false, now() - interval '5 hours' from generate_series(1, 9)`,
        [acc.phone],
      ),
    );
    await loginAction(form({ identifier: acc.phone, password: "bad-password" }));
    row = await accountRow(acc.id);
    expect(row.status).toBe("locked");
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
