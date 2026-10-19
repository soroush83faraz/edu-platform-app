// «ورود آزمایشی» against app_test (docs/decisions.md 2026-10-18): the demo login creates a real session for an
// allowed account WITHOUT any password, audits `iam.demo_login` in the account's organization, and refuses — with no
// session and no audit row — when the switch is off, the unlock cookie is missing/forged/stale, the account belongs
// to an organization off DEMO_LOGIN_ORGS (or ALSO to one), or the account/person is not live. The panel's list is
// read the same way. The pilot's open mode (DEMO_LOGIN_OPEN=1) needs neither the cookie nor a key, and changes
// nothing else but a tighter per-IP cap and `open: true` on the audit row. Calls the Server Action directly with the
// in-memory cookie+header store (no Next server).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isRedirectError } from "next/dist/client/components/redirect-error";

vi.mock("next/headers", () => import("./next-headers-mock").then((m) => m.nextHeadersMock));

import { getRequestContext } from "@/lib/ctx";
import { demoConfig } from "@/lib/demo-login/gate";
import { DEMO_COOKIE_NAME, mintDemoUnlock } from "@/lib/demo-login/unlock";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { demoLoginAction } from "@/modules/iam/demo-login/actions";
import { loadDemoDirectory } from "@/modules/iam/demo-login/directory";
import { DEMO_LOGIN_REFUSED_MESSAGE } from "@/modules/iam/demo-login/messages";
import { DEMO_RATE, DEMO_SESSION_LABEL } from "@/modules/iam/demo-login/repo";
import { hashToken } from "@/modules/iam/session";
import * as f from "./fixtures";
import { asAppOwner } from "./helpers";
import { requestState } from "./next-headers-mock";

const KEY = "int-test-demo-key-0123456789abcdef";
const id = (block: number, n: number) => `0199d000-${String(block).padStart(4, "0")}-7000-8000-${String(n).padStart(12, "0")}`;
const phone = (n: number) => `+98935990${String(n).padStart(4, "0")}`;

interface DemoAccount {
  id: string;
  phone: string;
  personIds: string[];
}

/**
 * user_account (+ optionally a password identity) with one person + membership per organization; optionally a
 * student of CLASS_GROUP_A1 in ORG_A. Written as app_owner (set_config for RLS is allowed in tests).
 */
async function createAccount(
  n: number,
  opts: {
    orgs: string[];
    status?: string;
    mustChange?: boolean;
    withPassword?: boolean;
    personStatus?: string;
    membershipStatus?: string;
    student?: boolean;
  },
): Promise<DemoAccount> {
  const accountId = id(0, n);
  const personIds = opts.orgs.map((_, i) => id(1 + i, n));
  await asAppOwner(async (c) => {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO iam.user_account (id, login_identifier, phone_e164, status, must_change_password) VALUES ($1, $2, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [accountId, phone(n), opts.status ?? "active", opts.mustChange ?? false],
    );
    if (opts.withPassword) {
      await c.query(
        `INSERT INTO iam.auth_identity (id, user_account_id, provider, secret_hash) VALUES (app.uuid_generate_v7(), $1, 'password', 'not-a-real-hash')
         ON CONFLICT (user_account_id, provider) DO NOTHING`,
        [accountId],
      );
    }
    for (const [i, org] of opts.orgs.entries()) {
      await c.query("SELECT set_config('app.current_org_id', $1, true)", [org]);
      await c.query(
        `INSERT INTO iam.person (id, organization_id, first_name, last_name, status) VALUES ($1, $2, 'دمو', $3, $4) ON CONFLICT (id) DO NOTHING`,
        [personIds[i], org, `آزمایشی ${n}`, opts.personStatus ?? "active"],
      );
      await c.query(
        `INSERT INTO iam.organization_membership (id, organization_id, user_account_id, person_id, status)
         VALUES (app.uuid_generate_v7(), $1, $2, $3, $4) ON CONFLICT (organization_id, user_account_id) DO NOTHING`,
        [org, accountId, personIds[i], opts.membershipStatus ?? "active"],
      );
      if (opts.student && org === f.ORG_A) {
        await c.query(
          `INSERT INTO iam.student_profile (id, organization_id, person_id, student_number) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [id(5, n), org, personIds[i], `DEMO${n}`],
        );
        await c.query(
          `INSERT INTO academic.school_enrollment (id, organization_id, student_profile_id, school_id, academic_year_id, grade_level_id)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [id(7, n), org, id(5, n), f.SCHOOL_A, f.YEAR_A, f.GRADE_A],
        );
        await c.query(
          `INSERT INTO academic.class_enrollment (id, organization_id, school_enrollment_id, class_group_id, student_profile_id, status)
           VALUES ($1, $2, $3, $4, $5, 'active') ON CONFLICT (id) DO NOTHING`,
          [id(6, n), org, id(7, n), f.CLASS_GROUP_A1, id(5, n)],
        );
      }
    }
    await c.query("COMMIT");
  });
  return { id: accountId, phone: phone(n), personIds };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  fd.append("$ACTION_ID_abc", "x"); // Next adds this on progressive-enhancement posts; the strict schema must survive it
  return fd;
}

async function expectRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (isRedirectError(err)) return err.digest.split(";")[2];
    throw err;
  }
  throw new Error("expected a redirect");
}

async function sessions(accountId: string) {
  return asAppOwner(async (c) => {
    const r = await c.query<{
      id: string;
      token_hash: string;
      revoked_at: Date | null;
      is_public_device: boolean;
      device_label: string | null;
      current_org_id: string;
      ip: string;
    }>(
      "select id, token_hash, revoked_at, is_public_device, device_label, current_org_id, host(ip) as ip from iam.user_session where user_account_id = $1 order by created_at, id",
      [accountId],
    );
    return r.rows;
  });
}

async function demoAudits(org: string, accountId: string) {
  return asAppOwner(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SELECT set_config('app.current_org_id', $1, true)", [org]);
      const r = await c.query<{ action: string; actor_person_id: string | null; actor_user_id: string | null; host: string; after: Record<string, unknown> }>(
        "select action, actor_person_id, actor_user_id, host(ip) as host, after from audit.audit_log where action = 'iam.demo_login' and entity_id = $1 order by at, id",
        [accountId],
      );
      return r.rows;
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

/** Keyed (the default): DEMO_LOGIN_OPEN is removed, whatever a local .env says. */
function demoOn(orgs = "school-a"): void {
  process.env.DEMO_LOGIN = "1";
  process.env.DEMO_LOGIN_KEY = KEY;
  process.env.DEMO_LOGIN_ORGS = orgs;
  delete process.env.DEMO_LOGIN_OPEN;
}
/** The pilot's open mode (owner 2026-10-18): every visitor, with or without a key. */
function demoOpen(opts: { key: boolean }, orgs = "school-a"): void {
  demoOn(orgs);
  process.env.DEMO_LOGIN_OPEN = "1";
  if (!opts.key) delete process.env.DEMO_LOGIN_KEY;
}
function demoOff(): void {
  delete process.env.DEMO_LOGIN;
  delete process.env.DEMO_LOGIN_OPEN;
  delete process.env.DEMO_LOGIN_KEY;
  delete process.env.DEMO_LOGIN_ORGS;
}
/** `n` demo sessions created just now from `ip` — what the rate limit counts. */
async function seedDemoSessions(ip: string, n: number): Promise<void> {
  await asAppOwner((c) =>
    c.query(
      `insert into iam.user_session (id, user_account_id, token_hash, current_org_id, ip, device_label, is_public_device, expires_at)
       select app.uuid_generate_v7(), $1, md5(random()::text || g::text), $2, $3::inet, $4, true, now() + interval '1 hour'
       from generate_series(1, $5) g`,
      [allowedTwo.id, f.ORG_A, ip, DEMO_SESSION_LABEL, n],
    ),
  );
}
/** This browser opened /login?demo=<key>: a valid unlock cookie for the CURRENT configuration. */
function unlock(): void {
  requestState.cookies.set(DEMO_COOKIE_NAME, mintDemoUnlock(demoConfig(), Date.now()));
}
function from(ip: string): void {
  requestState.headers.set("x-forwarded-for", ip);
  requestState.headers.set("user-agent", "int-test demo");
}

let allowed: DemoAccount;
let allowedTwo: DemoAccount;
let otherOrg: DemoAccount;
let crossOrg: DemoAccount;
let disabled: DemoAccount;
let mustChange: DemoAccount;
let archivedPerson: DemoAccount;

beforeAll(async () => {
  allowed = await createAccount(1, { orgs: [f.ORG_A], student: true }); // NO password identity at all
  allowedTwo = await createAccount(2, { orgs: [f.ORG_A], withPassword: true });
  otherOrg = await createAccount(3, { orgs: [f.ORG_B], withPassword: true });
  crossOrg = await createAccount(4, { orgs: [f.ORG_A, f.ORG_B], withPassword: true });
  disabled = await createAccount(5, { orgs: [f.ORG_A], status: "disabled" });
  mustChange = await createAccount(6, { orgs: [f.ORG_A], mustChange: true });
  archivedPerson = await createAccount(7, { orgs: [f.ORG_A], personStatus: "archived", membershipStatus: "left" });
});

beforeEach(() => {
  requestState.reset();
  demoOn();
});

afterEach(() => demoOff());

describe("the gate — NOT_FOUND, no session, no audit", () => {
  it("switch off: the panel list and the login answer NOT_FOUND even with a cookie minted while it was on", async () => {
    unlock();
    demoOff();
    from("10.7.0.10");
    const res = await demoLoginAction(form({ accountId: allowed.id }));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await loadDemoDirectory({})).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await sessions(allowed.id)).toHaveLength(0);
  });

  it("no unlock cookie, a forged one, or one minted for an older key: NOT_FOUND", async () => {
    from("10.7.0.11");
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await loadDemoDirectory({})).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const exp = Math.floor(Date.now() / 1000) + 3600;
    requestState.cookies.set(DEMO_COOKIE_NAME, `v1.${exp}.${"A".repeat(43)}`);
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "NOT_FOUND" });

    unlock();
    process.env.DEMO_LOGIN_KEY = `${KEY}-rotated`;
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await sessions(allowed.id)).toHaveLength(0);
  });

  it("a closed gate never parses: malformed input is NOT_FOUND too (no validation oracle)", async () => {
    expect(await demoLoginAction({ accountId: "nope", organizationId: f.ORG_A })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("with the gate open", () => {
  it("accepts only `{ accountId }` (strict, a UUID)", async () => {
    unlock();
    from("10.7.0.12");
    expect(await demoLoginAction({ accountId: allowed.id, organizationId: f.ORG_A })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await demoLoginAction({ accountId: "not-a-uuid" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await demoLoginAction({})).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await sessions(allowed.id)).toHaveLength(0);
  });

  it("signs in as an allowed account with no password at all: a public-device demo session, the cookie, the audit row", async () => {
    unlock();
    from("10.7.0.1");
    expect(await expectRedirect(() => demoLoginAction(form({ accountId: allowed.id })))).toBe("/home");

    const rows = await sessions(allowed.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ revoked_at: null, is_public_device: true, device_label: DEMO_SESSION_LABEL, current_org_id: f.ORG_A, ip: "10.7.0.1" });

    const call = requestState.setCookieCalls.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(call).toBeDefined();
    expect(hashToken(call!.value)).toBe(rows[0].token_hash);
    expect(call!.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(call!.options).not.toHaveProperty("expires"); // public device: a browser-session cookie

    // The session is real: the request context resolves to the demo account's person in ORG_A.
    const ctx = await getRequestContext();
    expect(ctx).toMatchObject({ userId: allowed.id, orgId: f.ORG_A, personId: allowed.personIds[0], mustChangePassword: false });

    const audits = await demoAudits(f.ORG_A, allowed.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "iam.demo_login", actor_person_id: null, actor_user_id: null, host: "10.7.0.1" });
    expect(audits[0].after).toMatchObject({ personId: allowed.personIds[0], sessionId: rows[0].id, publicDevice: true });
    expect(audits[0].after).not.toHaveProperty("open"); // keyed rows look as they always did

    // No password was involved: the account has no password identity, and no login attempt was recorded.
    await asAppOwner(async (c) => {
      const ids = await c.query("select 1 from iam.auth_identity where user_account_id = $1", [allowed.id]);
      expect(ids.rowCount).toBe(0);
      const attempts = await c.query("select 1 from iam.login_attempt where identifier = $1", [allowed.phone]);
      expect(attempts.rowCount).toBe(0);
    });
  });

  it("switching accounts revokes the session this browser held", async () => {
    unlock();
    from("10.7.0.2");
    await expectRedirect(() => demoLoginAction(form({ accountId: allowedTwo.id })));
    const first = (await sessions(allowedTwo.id)).at(-1)!;
    expect(first.revoked_at).toBeNull();

    // Same browser (the mock kept the session cookie the first login set), now as another account.
    await expectRedirect(() => demoLoginAction(form({ accountId: allowed.id })));
    const revoked = (await sessions(allowedTwo.id)).find((s) => s.id === first.id)!;
    expect(revoked.revoked_at).not.toBeNull();
    const audits = await demoAudits(f.ORG_A, allowed.id);
    expect(audits.at(-1)!.after).toMatchObject({ revokedPrevious: 1 });
  });

  it("refuses an account of an organization off DEMO_LOGIN_ORGS — and one that ALSO belongs to such an organization", async () => {
    unlock();
    from("10.7.0.3");
    for (const target of [otherOrg, crossOrg]) {
      const res = await demoLoginAction(form({ accountId: target.id }));
      expect(res).toEqual({ ok: false, code: "FORBIDDEN", message: DEMO_LOGIN_REFUSED_MESSAGE });
      expect(await sessions(target.id)).toHaveLength(0);
    }
    expect(await demoAudits(f.ORG_B, otherOrg.id)).toHaveLength(0);
    expect(await demoAudits(f.ORG_A, crossOrg.id)).toHaveLength(0);
  });

  it("refuses a disabled account, a pending forced password change, a removed person and an unknown id — one answer", async () => {
    unlock();
    from("10.7.0.4");
    for (const accountId of [disabled.id, mustChange.id, archivedPerson.id, id(0, 999)]) {
      const res = await demoLoginAction(form({ accountId }));
      expect(res).toEqual({ ok: false, code: "FORBIDDEN", message: DEMO_LOGIN_REFUSED_MESSAGE });
      expect(await sessions(accountId)).toHaveLength(0);
    }
  });

  it("allowing ORG_B too makes its account reachable (the list is the only switch per organization)", async () => {
    demoOn("school-a,school-b");
    unlock();
    from("10.7.0.5");
    expect(await expectRedirect(() => demoLoginAction(form({ accountId: otherOrg.id })))).toBe("/home");
    expect((await sessions(otherOrg.id)).filter((s) => s.revoked_at === null)).toHaveLength(1);
    expect(await demoAudits(f.ORG_B, otherOrg.id)).toHaveLength(1);
  });

  it("rate limit: from one IP, demo sessions of the last ten minutes are capped", async () => {
    unlock();
    from("10.7.9.9");
    await seedDemoSessions("10.7.9.9", DEMO_RATE.perIp10m);
    const before = (await sessions(allowed.id)).length;
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(await sessions(allowed.id)).toHaveLength(before);
  });
});

describe("open mode — DEMO_LOGIN_OPEN=1 (the pilot: the panel for every visitor)", () => {
  it("no key and no unlock cookie: the list is read, the login signs in, and the audit row says `open: true`", async () => {
    demoOpen({ key: false });
    from("10.7.0.20");
    expect(requestState.cookies.has(DEMO_COOKIE_NAME)).toBe(false);

    const dir = await loadDemoDirectory({});
    expect(dir.ok).toBe(true);
    if (!dir.ok) return;
    const everyId = dir.data.schools.flatMap((s) => s.roles.flatMap((r) => r.groups.flatMap((g) => g.options.map((o) => o.id))));
    expect(everyId).toContain(allowed.id);
    for (const refused of [otherOrg.id, disabled.id, mustChange.id, archivedPerson.id]) expect(everyId).not.toContain(refused);
    expect(dir.data.schools.some((s) => s.key.startsWith(f.ORG_B))).toBe(false);

    expect(await expectRedirect(() => demoLoginAction(form({ accountId: allowed.id })))).toBe("/home");
    const newest = (await sessions(allowed.id)).at(-1)!;
    // The same session as when keyed: public device (8 hours, never extended), labelled, in the account's organization.
    expect(newest).toMatchObject({ revoked_at: null, is_public_device: true, device_label: DEMO_SESSION_LABEL, current_org_id: f.ORG_A, ip: "10.7.0.20" });
    const call = requestState.setCookieCalls.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(call && hashToken(call.value)).toBe(newest.token_hash);
    expect(call!.options).not.toHaveProperty("expires");
    expect(await getRequestContext()).toMatchObject({ userId: allowed.id, orgId: f.ORG_A, personId: allowed.personIds[0] });

    const row = (await demoAudits(f.ORG_A, allowed.id)).find((a) => a.after.sessionId === newest.id);
    expect(row).toMatchObject({ action: "iam.demo_login", actor_person_id: null, actor_user_id: null, host: "10.7.0.20" });
    expect(row!.after).toMatchObject({ personId: allowed.personIds[0], publicDevice: true, open: true });
  });

  it("with a key configured it is just as open — no cookie needed", async () => {
    demoOpen({ key: true });
    from("10.7.0.21");
    expect(await expectRedirect(() => demoLoginAction(form({ accountId: allowedTwo.id })))).toBe("/home");
    const newest = (await sessions(allowedTwo.id)).at(-1)!;
    expect(newest).toMatchObject({ revoked_at: null, ip: "10.7.0.21", device_label: DEMO_SESSION_LABEL });
  });

  it("every other gate stays: the switch, exactly \"1\", the strict input, the allow-list, the eligibility rule", async () => {
    from("10.7.0.22");
    // DEMO_LOGIN off: open mode opens nothing.
    demoOpen({ key: false });
    delete process.env.DEMO_LOGIN;
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await loadDemoDirectory({})).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // Any value but "1" is keyed: no cookie → NOT_FOUND.
    demoOn();
    process.env.DEMO_LOGIN_OPEN = "true";
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await loadDemoDirectory({})).toMatchObject({ ok: false, code: "NOT_FOUND" });

    demoOpen({ key: false });
    expect(await demoLoginAction({ accountId: allowed.id, organizationId: f.ORG_A })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await demoLoginAction({ accountId: "not-a-uuid" })).toMatchObject({ ok: false, code: "VALIDATION" });
    for (const target of [otherOrg, crossOrg, disabled, mustChange, archivedPerson]) {
      expect(await demoLoginAction(form({ accountId: target.id }))).toEqual({ ok: false, code: "FORBIDDEN", message: DEMO_LOGIN_REFUSED_MESSAGE });
    }
    // Nothing was created from this test's address (otherOrg has a session + audit row from the ORG_B test above).
    for (const target of [allowed, otherOrg, crossOrg, disabled, mustChange, archivedPerson]) {
      expect((await sessions(target.id)).filter((s) => s.ip === "10.7.0.22")).toHaveLength(0);
    }
    for (const [org, target] of [[f.ORG_B, otherOrg], [f.ORG_A, crossOrg], [f.ORG_B, crossOrg], [f.ORG_A, allowed]] as const) {
      expect((await demoAudits(org, target.id)).filter((a) => a.host === "10.7.0.22")).toHaveLength(0);
    }
  });

  it(`the per-IP cap is tighter: ${DEMO_RATE.perIp10mOpen} demo sessions from one IP pass keyed, and are refused open`, async () => {
    from("10.7.9.20");
    await seedDemoSessions("10.7.9.20", DEMO_RATE.perIp10mOpen);
    unlock(); // keyed: 20 < 30
    expect(await expectRedirect(() => demoLoginAction(form({ accountId: allowedTwo.id })))).toBe("/home");

    demoOpen({ key: false });
    const before = (await sessions(allowed.id)).length;
    expect(await demoLoginAction(form({ accountId: allowed.id }))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(await sessions(allowed.id)).toHaveLength(before);
  });
});

describe("the panel's list", () => {
  it("lists the allowed organization's eligible accounts with labels, and nothing of another organization", async () => {
    unlock();
    const res = await loadDemoDirectory({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const school = res.data.schools.find((s) => s.key === `${f.ORG_A}/${f.SCHOOL_A}`);
    expect(school).toBeDefined();
    const students = school!.roles.find((r) => r.key === "student");
    expect(students?.groups.map((g) => g.label)).toContain("پایهٴ اول");
    const options = students!.groups.flatMap((g) => g.options);
    expect(options).toContainEqual({ id: allowed.id, label: "پایهٴ اول — اول 1 — دمو آزمایشی 1" });

    const everyId = res.data.schools.flatMap((s) => s.roles.flatMap((r) => r.groups.flatMap((g) => g.options.map((o) => o.id))));
    for (const refused of [otherOrg.id, disabled.id, mustChange.id, archivedPerson.id]) expect(everyId).not.toContain(refused);
    expect(res.data.schools.some((s) => s.key.startsWith(f.ORG_B))).toBe(false);
    expect(JSON.stringify(res.data)).not.toContain(allowed.phone);
  });

  it("«ولی» (2026-10-18): a guardian with a live link to a student of the school is offered, labelled by the child — never with a phone", async () => {
    const guardian = await createAccount(8, { orgs: [f.ORG_A], withPassword: true });
    await asAppOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_org_id', $1, true)", [f.ORG_A]);
      await c.query(
        `INSERT INTO iam.guardian_link (id, organization_id, guardian_person_id, student_profile_id, relation, is_primary)
         VALUES ($1, $2, $3, $4, 'mother', true) ON CONFLICT DO NOTHING`,
        [id(8, 1), f.ORG_A, guardian.personIds[0], id(5, 1)],
      );
      await c.query("COMMIT");
    });
    unlock();
    const res = await loadDemoDirectory({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const school = res.data.schools.find((s) => s.key === `${f.ORG_A}/${f.SCHOOL_A}`)!;
    const role = school.roles.find((r) => r.key === "guardian");
    expect(role?.label).toBe("ولی");
    expect(role?.groups.flatMap((g) => g.options)).toContainEqual({ id: guardian.id, label: "ولیِ دمو آزمایشی 1 — اول 1" });
    expect(JSON.stringify(role)).not.toContain(guardian.phone);
  });
});
