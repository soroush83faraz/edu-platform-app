// «ورود آزمایشی» (docs/decisions.md 2026-10-18) — the pure parts of the demo quick-login's gates and its panel:
// the configuration (off unless complete), the unlock cookie (constant-time key check, an expiring HMAC bound to the
// key and the secret), the /login/demo hand-off (same answer whatever happens, a cookie only for the right key), the
// eligibility rule (who may be signed in to) and the dropdown labels/grouping. The database half is
// tests/int/demo-login.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_OFF, demoConfigFrom, parseDemoOrgSlugs, type DemoConfig } from "@/lib/demo-login/config";
import {
  DEMO_COOKIE_NAME,
  DEMO_UNLOCK_TTL_S,
  demoKeyMatches,
  demoUnlockDecision,
  mintDemoUnlock,
  verifyDemoUnlock,
} from "@/lib/demo-login/unlock";
import { demoTarget, type DemoAccountFacts, type DemoMembershipFacts } from "@/modules/iam/demo-login/eligibility";
import { buildDemoDirectory, teacherSummary, type DemoOrgFacts } from "@/modules/iam/demo-login/labels";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/iam/actions", () => ({ loginFormAction: async () => null }));
vi.mock("@/modules/iam/demo-login/actions", () => ({ demoLoginFormAction: async () => null }));

const KEY = "Zq4-demo_key-0123456789abcdefXY";
const SECRET = "unit-test-session-secret-0123456789abcdef";
const ON = { DEMO_LOGIN: "1", DEMO_LOGIN_KEY: KEY, DEMO_LOGIN_ORGS: "allameh, farzanegan,helli,pishgaman,allameh", SESSION_SECRET: SECRET };
const cfg: DemoConfig = demoConfigFrom(ON);
const NOW = Date.UTC(2026, 9, 18, 8, 0, 0);

describe("configuration — off unless complete", () => {
  it("is off by default and for any switch value but \"1\"", () => {
    expect(demoConfigFrom({ SESSION_SECRET: SECRET })).toEqual(DEMO_OFF);
    for (const v of ["0", "true", "yes", "1 ", ""]) expect(demoConfigFrom({ ...ON, DEMO_LOGIN: v }).enabled).toBe(false);
  });

  it("is off when the key, the organization list or the secret is missing or malformed", () => {
    expect(demoConfigFrom({ ...ON, DEMO_LOGIN_KEY: undefined }).enabled).toBe(false);
    expect(demoConfigFrom({ ...ON, DEMO_LOGIN_KEY: "short-key-123" }).enabled).toBe(false); // < 24
    expect(demoConfigFrom({ ...ON, DEMO_LOGIN_KEY: "has spaces in it 0123456789" }).enabled).toBe(false);
    expect(demoConfigFrom({ ...ON, DEMO_LOGIN_ORGS: undefined }).enabled).toBe(false);
    expect(demoConfigFrom({ ...ON, DEMO_LOGIN_ORGS: " , " }).enabled).toBe(false);
    expect(demoConfigFrom({ ...ON, DEMO_LOGIN_ORGS: "allameh,Real School" }).enabled).toBe(false);
    expect(demoConfigFrom({ ...ON, SESSION_SECRET: "too-short" }).enabled).toBe(false);
  });

  it("keeps the slugs distinct, trimmed and in the order written", () => {
    expect(cfg.enabled).toBe(true);
    expect(cfg.orgSlugs).toEqual(["allameh", "farzanegan", "helli", "pishgaman"]);
    expect(parseDemoOrgSlugs(undefined)).toEqual([]);
    expect(parseDemoOrgSlugs("ab")).toBeNull(); // < 3 characters, like organization_slug_chk
    expect(parseDemoOrgSlugs("school-a")).toEqual(["school-a"]);
  });
});

describe("the unlock key and cookie", () => {
  it("matches only the exact key, never when the feature is off", () => {
    expect(demoKeyMatches(cfg, KEY)).toBe(true);
    expect(demoKeyMatches(cfg, `${KEY}x`)).toBe(false);
    expect(demoKeyMatches(cfg, KEY.slice(0, -1))).toBe(false);
    expect(demoKeyMatches(cfg, KEY.toLowerCase())).toBe(false);
    expect(demoKeyMatches(cfg, "")).toBe(false);
    expect(demoKeyMatches(cfg, undefined)).toBe(false);
    expect(demoKeyMatches(cfg, ["x"])).toBe(false);
    expect(demoKeyMatches(cfg, "a".repeat(10_000))).toBe(false);
    expect(demoKeyMatches(DEMO_OFF, "")).toBe(false);
    expect(demoKeyMatches({ ...cfg, enabled: false }, KEY)).toBe(false);
  });

  it("a minted cookie verifies for 30 days and never holds the key", () => {
    const value = mintDemoUnlock(cfg, NOW);
    expect(value).toMatch(/^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain(KEY);
    expect(verifyDemoUnlock(cfg, value, NOW)).toBe(true);
    expect(verifyDemoUnlock(cfg, value, NOW + (DEMO_UNLOCK_TTL_S - 1) * 1000)).toBe(true);
    expect(verifyDemoUnlock(cfg, value, NOW + DEMO_UNLOCK_TTL_S * 1000)).toBe(false); // expired, whatever the browser kept
  });

  it("a rotated key, a rotated secret, a switched-off feature or a forged/edited value all fail", () => {
    const value = mintDemoUnlock(cfg, NOW);
    expect(verifyDemoUnlock({ ...cfg, key: `${KEY.slice(0, -1)}Z` }, value, NOW)).toBe(false);
    expect(verifyDemoUnlock({ ...cfg, secret: `${SECRET}!` }, value, NOW)).toBe(false);
    expect(verifyDemoUnlock({ ...cfg, enabled: false }, value, NOW)).toBe(false);
    const [v, exp, sig] = value.split(".");
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(verifyDemoUnlock(cfg, `${v}.${exp}.${flipped}`, NOW)).toBe(false);
    expect(verifyDemoUnlock(cfg, `${v}.${Number(exp) + 86_400}.${sig}`, NOW)).toBe(false); // a longer life is not signed
    expect(verifyDemoUnlock(cfg, `v2.${exp}.${sig}`, NOW)).toBe(false);
    for (const junk of [undefined, null, "", "demo", KEY, `${value}.x`, `v1.${exp}.${sig}=`]) expect(verifyDemoUnlock(cfg, junk, NOW)).toBe(false);
  });

  it("refuses a value dated further ahead than it is ever minted", () => {
    const fromTheFuture = mintDemoUnlock(cfg, NOW + 10 * 86_400_000);
    expect(verifyDemoUnlock(cfg, fromTheFuture, NOW)).toBe(false);
  });

  it("/login/demo: the same answer whatever happens, a cookie only for the right key with the feature on", () => {
    expect(demoUnlockDecision(DEMO_OFF, KEY, NOW)).toEqual({ outcome: "off", cookie: null });
    expect(demoUnlockDecision(cfg, "wrong-key-wrong-key-wrong-key", NOW)).toEqual({ outcome: "bad_key", cookie: null });
    const ok = demoUnlockDecision(cfg, KEY, NOW);
    expect(ok.outcome).toBe("unlocked");
    expect(ok.cookie).toMatchObject({
      name: DEMO_COOKIE_NAME,
      options: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60, secure: false },
    });
    expect(DEMO_COOKIE_NAME).toBe("demo"); // `__Host-demo` + Secure in production (NODE_ENV=production)
    expect(verifyDemoUnlock(cfg, ok.cookie!.value, NOW)).toBe(true);
  });
});

describe("the /login/demo route", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function hit(key: string | null) {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/(auth)/login/demo/route");
    const url = new URL("http://localhost:3000/login/demo");
    if (key !== null) url.searchParams.set("key", key);
    return GET(new NextRequest(url));
  }

  it("redirects to a clean /login in every case and sets the unlock cookie only for the right key", async () => {
    vi.stubEnv("DEMO_LOGIN", "1");
    vi.stubEnv("DEMO_LOGIN_KEY", KEY);
    vi.stubEnv("DEMO_LOGIN_ORGS", "allameh");
    vi.stubEnv("SESSION_SECRET", SECRET);
    for (const key of [null, "nope", `${KEY}x`]) {
      const res = await hit(key);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("http://localhost:3000/login");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const res = await hit(KEY);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^demo=v1\.\d{10}\.[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    expect(setCookie).not.toContain(KEY);
  });

  it("with the feature off the right key changes nothing", async () => {
    vi.stubEnv("DEMO_LOGIN", undefined);
    vi.stubEnv("DEMO_LOGIN_KEY", KEY);
    vi.stubEnv("DEMO_LOGIN_ORGS", "allameh");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const res = await hit(KEY);
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("env.ts refuses a half-configured switch at boot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5432/app",
    MIGRATION_DATABASE_URL: "postgres://u:p@localhost:5432/app",
    SESSION_SECRET: SECRET,
    INITIAL_PASSWORD_KEY: "0".repeat(64),
    PUBLIC_ORIGIN: "http://localhost:3000",
  };
  const load = async (extra: Record<string, string>) => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const k of ["DEMO_LOGIN", "DEMO_LOGIN_KEY", "DEMO_LOGIN_ORGS"]) vi.stubEnv(k, undefined);
    for (const [k, v] of Object.entries({ ...base, ...extra })) vi.stubEnv(k, v);
    return import("@/lib/env");
  };

  it("DEMO_LOGIN=1 needs DEMO_LOGIN_KEY and DEMO_LOGIN_ORGS; a bad value is an error, not «off»", async () => {
    await expect(load({ DEMO_LOGIN: "1", DEMO_LOGIN_ORGS: "allameh" })).rejects.toThrow(/DEMO_LOGIN_KEY/);
    await expect(load({ DEMO_LOGIN: "1", DEMO_LOGIN_KEY: KEY })).rejects.toThrow(/DEMO_LOGIN_ORGS/);
    await expect(load({ DEMO_LOGIN: "1", DEMO_LOGIN_KEY: "short", DEMO_LOGIN_ORGS: "allameh" })).rejects.toThrow(/DEMO_LOGIN_KEY/);
    await expect(load({ DEMO_LOGIN: "true", DEMO_LOGIN_KEY: KEY, DEMO_LOGIN_ORGS: "allameh" })).rejects.toThrow(/DEMO_LOGIN/);
    await expect(load({ DEMO_LOGIN_ORGS: "allameh,NOT A SLUG" })).rejects.toThrow(/DEMO_LOGIN_ORGS/);
  });

  it("absent or complete is fine", async () => {
    await expect(load({})).resolves.toBeTruthy();
    const mod = await load({ DEMO_LOGIN: "1", DEMO_LOGIN_KEY: KEY, DEMO_LOGIN_ORGS: "allameh,helli" });
    expect(mod.env.DEMO_LOGIN).toBe("1");
  });
});

// ---- who may be signed in to ----
const ACCOUNT: DemoAccountFacts = { id: "acc", status: "active", mustChangePassword: false, lockedUntil: null };
const m = (over: Partial<DemoMembershipFacts>): DemoMembershipFacts => ({
  organizationId: "org-a",
  orgSlug: "allameh",
  orgStatus: "active",
  status: "active",
  personId: "person-a",
  isDefaultOrg: false,
  joinedAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});
const ALLOWED = ["allameh", "farzanegan"];
const now = new Date(NOW);

describe("demoTarget — the eligibility rule", () => {
  it("an active demo account lands in its organization", () => {
    expect(demoTarget(ACCOUNT, [m({})], ALLOWED, now)).toEqual({ ok: true, organizationId: "org-a", personId: "person-a" });
  });

  it("refuses a missing, disabled, admin-locked, soft-locked or must-change account", () => {
    expect(demoTarget(null, [m({})], ALLOWED, now)).toEqual({ ok: false, reason: "no_account" });
    expect(demoTarget({ ...ACCOUNT, status: "disabled" }, [m({})], ALLOWED, now)).toEqual({ ok: false, reason: "inactive" });
    expect(demoTarget({ ...ACCOUNT, status: "locked" }, [m({})], ALLOWED, now)).toEqual({ ok: false, reason: "inactive" });
    expect(demoTarget({ ...ACCOUNT, lockedUntil: new Date(NOW + 60_000) }, [m({})], ALLOWED, now)).toEqual({ ok: false, reason: "locked" });
    expect(demoTarget({ ...ACCOUNT, lockedUntil: new Date(NOW - 60_000) }, [m({})], ALLOWED, now).ok).toBe(true);
    expect(demoTarget({ ...ACCOUNT, mustChangePassword: true }, [m({})], ALLOWED, now)).toEqual({ ok: false, reason: "must_change_password" });
  });

  it("refuses an account with ANY membership off the allow-list — active or not — so a real school's admin is never reachable", () => {
    expect(demoTarget(ACCOUNT, [m({ orgSlug: "real-school" })], ALLOWED, now)).toEqual({ ok: false, reason: "outside_demo" });
    expect(demoTarget(ACCOUNT, [m({}), m({ organizationId: "org-x", orgSlug: "real-school" })], ALLOWED, now)).toEqual({ ok: false, reason: "outside_demo" });
    expect(demoTarget(ACCOUNT, [m({}), m({ organizationId: "org-x", orgSlug: "real-school", status: "left" })], ALLOWED, now)).toEqual({
      ok: false,
      reason: "outside_demo",
    });
  });

  it("needs a live membership in an active organization", () => {
    expect(demoTarget(ACCOUNT, [], ALLOWED, now)).toEqual({ ok: false, reason: "no_membership" });
    expect(demoTarget(ACCOUNT, [m({ status: "left" })], ALLOWED, now)).toEqual({ ok: false, reason: "no_membership" });
    expect(demoTarget(ACCOUNT, [m({ orgStatus: "suspended" })], ALLOWED, now)).toEqual({ ok: false, reason: "no_membership" });
  });

  it("picks the organization a password login would: the default one, else the oldest membership", () => {
    const older = m({ organizationId: "org-old", personId: "p-old", orgSlug: "farzanegan", joinedAt: new Date("2026-01-01T00:00:00Z") });
    const def = m({ organizationId: "org-def", personId: "p-def", isDefaultOrg: true });
    expect(demoTarget(ACCOUNT, [m({}), older], ALLOWED, now)).toMatchObject({ organizationId: "org-old" });
    expect(demoTarget(ACCOUNT, [m({}), older, def], ALLOWED, now)).toMatchObject({ organizationId: "org-def", personId: "p-def" });
  });
});

// ---- the panel's dropdowns ----
describe("labels", () => {
  it("a دبستان's class teacher is «آموزگار <class>»; a secondary teacher lists درس‌ها with their classes", () => {
    const one = (subjectName: string, className = "اول الف", gradeSeq = 1) => ({ subjectName, className, gradeSeq });
    expect(teacherSummary([one("فارسی"), one("ریاضی"), one("علوم تجربی")], true)).toBe("آموزگار اول الف");
    // The ورزش teacher of every class: one درس, the classes (three, then «…»).
    expect(teacherSummary([one("تربیت بدنی", "سوم الف", 3), one("تربیت بدنی", "اول الف", 1), one("تربیت بدنی", "دوم الف", 2), one("تربیت بدنی", "ششم الف", 6)], true)).toBe(
      "تربیت بدنی اول الف، دوم الف، سوم الف…",
    );
    expect(
      teacherSummary([one("فیزیک", "۱۱/۱", 11), one("ریاضی", "۱۰/۳", 10), one("ریاضی", "۱۰/۱", 10), one("ریاضی", "۱۲/۲", 12), one("ریاضی", "۱۰/۲", 10)], false),
    ).toBe("ریاضی ۱۰/۱، ۱۰/۲، ۱۰/۳… · فیزیک ۱۱/۱");
    expect(teacherSummary([one("الف", "۷/۱", 7), one("ب", "۷/۱", 7), one("ج", "۷/۱", 7)], false)).toBe("الف ۷/۱ · ب ۷/۱ · …");
  });

  const SCHOOL = "school-1";
  const org: DemoOrgFacts = {
    orgId: "org-1",
    orgName: "دبستان پیشگامان",
    schools: [{ id: SCHOOL, name: "دبستان پیشگامان", primary: true }],
    people: [
      { personId: "admin", accountId: "acc-admin", firstName: "مریم", lastName: "احمدی" },
      { personId: "head", accountId: "acc-head", firstName: "زهرا", lastName: "کاظمی" },
      { personId: "t1", accountId: "acc-t1", firstName: "هانیه", lastName: "فتحی" },
      { personId: "s1", accountId: "acc-s1", firstName: "لیلا", lastName: "نیک‌خواه" },
      { personId: "s2", accountId: "acc-s2", firstName: "سارا", lastName: "امینی" },
      { personId: "s3", accountId: "acc-s3", firstName: "نگار", lastName: "رضایی" },
    ],
    managers: [
      { personId: "admin", hat: "org_admin", schoolId: null },
      { personId: "head", hat: "principal", schoolId: SCHOOL },
      { personId: "ghost", hat: "vice", schoolId: SCHOOL }, // not an eligible account → no «معاون» role at all
    ],
    teaching: [
      { personId: "t1", schoolId: SCHOOL, subjectName: "فارسی", className: "اول الف", gradeSeq: 1 },
      { personId: "t1", schoolId: SCHOOL, subjectName: "ریاضی", className: "اول الف", gradeSeq: 1 },
    ],
    students: [
      { personId: "s3", schoolId: SCHOOL, className: "دوم الف", gradeName: "دوم", gradeSeq: 2 },
      { personId: "s1", schoolId: SCHOOL, className: "اول الف", gradeName: "اول", gradeSeq: 1 },
      { personId: "s2", schoolId: SCHOOL, className: "اول الف", gradeName: "اول", gradeSeq: 1 },
      { personId: "removed", schoolId: SCHOOL, className: "اول الف", gradeName: "اول", gradeSeq: 1 },
    ],
  };

  it("builds «مدرسه» → «نقش» → «حساب»: only roles that exist, in the product's order, students grouped by پایه", () => {
    const dir = buildDemoDirectory([org]);
    expect(dir.schools).toHaveLength(1);
    const [school] = dir.schools;
    expect(school.label).toBe("دبستان پیشگامان");
    expect(school.roles.map((r) => [r.key, r.label])).toEqual([
      ["org_admin", "مدیر سازمان"],
      ["principal", "مدیر مدرسه"],
      ["teacher", "آموزگار"],
      ["student", "دانش‌آموز"],
    ]);
    const teacher = school.roles.find((r) => r.key === "teacher")!;
    expect(teacher.groups).toEqual([{ label: null, options: [{ id: "acc-t1", label: "هانیه فتحی — آموزگار اول الف" }] }]);
    const students = school.roles.find((r) => r.key === "student")!;
    expect(students.groups.map((g) => g.label)).toEqual(["پایهٴ اول", "پایهٴ دوم"]);
    expect(students.groups[0].options).toEqual([
      { id: "acc-s2", label: "پایهٴ اول — اول الف — سارا امینی" },
      { id: "acc-s1", label: "پایهٴ اول — اول الف — لیلا نیک‌خواه" },
    ]);
    expect(students.groups[1].options).toEqual([{ id: "acc-s3", label: "پایهٴ دوم — دوم الف — نگار رضایی" }]);
    // Labels and ids only — nothing else about a person reaches the browser.
    expect(JSON.stringify(dir)).not.toMatch(/\+98|09\d{9}|password|person/);
  });

  it("a secondary school's teacher role is «دبیر»; an organization-wide admin is under every school; same-name schools get the organization", () => {
    const secondary: DemoOrgFacts = {
      ...org,
      orgId: "org-2",
      orgName: "مجتمع دوم",
      schools: [
        { id: "a", name: "مرکزی", primary: false },
        { id: "b", name: "شعبهٴ دو", primary: false },
      ],
      managers: [{ personId: "admin", hat: "org_admin", schoolId: null }],
      teaching: [{ personId: "t1", schoolId: "b", subjectName: "ریاضی", className: "۱۰/۱", gradeSeq: 10 }],
      students: [],
    };
    const third: DemoOrgFacts = { ...secondary, orgId: "org-3", orgName: "مجتمع سوم", schools: [{ id: "c", name: "مرکزی", primary: false }], teaching: [] };
    const dir = buildDemoDirectory([secondary, third]);
    expect(dir.schools.map((s) => s.label)).toEqual(["مرکزی — مجتمع دوم", "شعبهٴ دو", "مرکزی — مجتمع سوم"]);
    for (const s of dir.schools) expect(s.roles[0]).toMatchObject({ key: "org_admin", groups: [{ options: [{ id: "acc-admin" }] }] });
    expect(dir.schools[1].roles.find((r) => r.key === "teacher")).toMatchObject({ label: "دبیر" });
  });

  it("an organization without a school still offers its «مدیر سازمان»", () => {
    const dir = buildDemoDirectory([{ ...org, schools: [], teaching: [], students: [] }]);
    expect(dir.schools).toEqual([
      { key: "org-1/", label: "دبستان پیشگامان", roles: [{ key: "org_admin", label: "مدیر سازمان", groups: [{ label: null, options: [{ id: "acc-admin", label: "مریم احمدی" }] }] }] },
    ]);
  });
});

// ---- the pill and its panel ----
describe("the «ورود آزمایشی» panel on /login", () => {
  it("renders only with a directory: the pill, a closed panel, and ONE named field — the account id", async () => {
    const { LoginScene } = await import("@/modules/iam/ui/LoginScene");
    const directory = buildDemoDirectory([
      {
        orgId: "org-1",
        orgName: "فرزانگان",
        schools: [{ id: "s1", name: "فرزانگان", primary: false }],
        people: [{ personId: "p1", accountId: "0199d000-0000-7000-8000-000000000001", firstName: "لیلا", lastName: "نیک‌خواه" }],
        managers: [],
        teaching: [],
        students: [{ personId: "p1", schoolId: "s1", className: "۷/۱", gradeName: "هفتم", gradeSeq: 7 }],
      },
    ]);
    const html = renderToStaticMarkup(createElement(LoginScene, { loggedOut: false, next: null, demo: directory }));
    expect(html).toContain("ورود آزمایشی");
    expect(html).toContain("فقط برای دورهٴ آزمایشی");
    expect(html).toMatch(/<form[^>]*hidden=""/); // closed until the pill is tapped
    expect(html).toMatch(/aria-expanded="false"/);
    const named = [...html.matchAll(/<select[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(named).toEqual(["accountId"]);
    expect(html.match(/<select/g)).toHaveLength(3);
    expect(html).toContain('<optgroup label="پایهٴ هفتم">');
    expect(html).toContain("پایهٴ هفتم — ۷/۱ — لیلا نیک‌خواه");
    // The panel carries labels and account ids only (the login form beside it has its own password field).
    const panel = html.slice(html.indexOf("pointer-events-none fixed"));
    expect(panel).not.toMatch(/password|\+98/);
  });
});
