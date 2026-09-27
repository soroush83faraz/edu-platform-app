// The Home tile registry (`homeTilesFor`) under the IA rule (docs/decisions.md «one home per destination»): a
// destination has exactly ONE door — EXCEPT the کارتابل, whose «پنل من» tile (owner, 2026-09-27,
// docs/decisions-pending/nav-home.md) is a second, accepted door alongside the «همهٴ …» link of Home's «تکالیف
// نزدیک» card (`home-inbox-door.test.ts`). Home carries that tile first, then the person's role tiles, then one
// tile per STRUCTURE page, each gated by the permission and scope that guard the page itself. No OTHER tile is a
// second door to a NAV destination — «کلاس من», «کلاس‌ها», «مدیریت», «بیشتر», «خانه» — and no admin SECTION
// («دانش‌آموزان», «کارکنان», «کلاس‌ها», «نقش‌ها») gets one either.
// Plus the pure organization-admin predicate and the nav role.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "../../scripts/catalog";
import { HOME_TILES, MODULES, UPCOMING_MODULES, homeTilesFor, type TileHats } from "@/lib/modules-registry";
import { isOrganizationAdmin, navRoleFor, type Assignment } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";

const ADMIN_PERMS: Permission[] = [
  "iam.admin.access",
  "tenancy.structure.read",
  "tenancy.structure.write",
  "iam.person.write",
  "academic.attendance.report",
  "workspace.work_item.read",
  "workspace.work_item.create",
];
/** The seeded roles' own permission sets (scripts/catalog.ts) — the vice principal holds the principal's (owner, 2026-09-27). */
const catalogPerms = (code: string): Permission[] => SYSTEM_ROLES.find((r) => r.code === code)?.permissions ?? [];
const PRINCIPAL_PERMS = catalogPerms("school_principal");
const VICE_PERMS = catalogPerms("vice_principal");
/** An admin hat WITHOUT `workspace.work_item.create` and without any structure write — no seeded role is like this any more. */
const READ_ONLY_ADMIN_PERMS: Permission[] = ["iam.admin.access", "tenancy.structure.read", "academic.attendance.report", "workspace.work_item.read"];
const has = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const codes = (tiles: ReturnType<typeof homeTilesFor>) => tiles.map((t) => t.code);
const tile = (tiles: ReturnType<typeof homeTilesFor>, code: string) => tiles.find((t) => t.code === code);

const orgAdmin: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "organization", singleSchoolId: null };
/** A principal of exactly one school; `twoSchools` is the same hat over a scope of two. */
const principal: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school", singleSchoolId: "s1" };
const twoSchools: TileHats = { ...principal, singleSchoolId: null };
const teacher: TileHats = { isStudent: false, isTeacher: true, isAdmin: false, adminScope: null };
const student: TileHats = { isStudent: true, isTeacher: false, isAdmin: false, adminScope: null };

describe("homeTilesFor", () => {
  it("«پنل من» is a tile again, for every hat that reads work items, and leads the grid (owner, 2026-09-27)", () => {
    expect(HOME_TILES.find((t) => t.code === "inbox")).toMatchObject({ href: "/inbox", labelFa: "پنل من" });
    for (const hats of [orgAdmin, principal, teacher, student]) {
      const tiles = homeTilesFor(hats, has(ADMIN_PERMS));
      expect(codes(tiles)).toContain("inbox");
      expect(codes(tiles)[0]).toBe("inbox");
    }
    // No permission, no tile — and someone with neither a student, teacher nor admin hat (e.g. a guardian) never
    // gets it either, permission or not.
    const noHat: TileHats = { isStudent: false, isTeacher: false, isAdmin: false, adminScope: null };
    expect(codes(homeTilesFor(noHat, has(["workspace.work_item.read"])))).toEqual([]);
    expect(codes(homeTilesFor(student, has([])))).not.toContain("inbox");
  });

  it("the organization admin: the structure tiles the nav gave up, in that order — and no «مدیریت», «مدرسه‌ها» or «راه‌اندازی» tile", () => {
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).toEqual(["inbox", "admin-attendance"]);
    // Round 7: «مدرسه‌ها» (the organization's list) is an admin SECTION for this person, so Home does not carry it —
    // one door. «زنگ‌بندی» has no organization-wide page, so it has no tile either; the fixed catalog (مقطع، پایه،
    // سال) and the retired «تنظیمات زیرساختی» have no door anywhere (2026-09-27).
    expect(tile(homeTilesFor(orgAdmin, has(ADMIN_PERMS)), "schools")).toBeUndefined();
    for (const href of ["/admin/infrastructure", "/admin/years", "/admin/grades", "/admin/levels", "/admin/subjects"]) expect(HOME_TILES.filter((t) => t.href === href)).toEqual([]);
  });

  it("a principal of ONE school gets «مدرسه» and that school's زنگ‌بندی, and no organization catalog", () => {
    const tiles = homeTilesFor(principal, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["inbox", "admin-attendance", "schools", "periods"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه", href: "/admin/schools/s1" });
    expect(tile(tiles, "periods")).toMatchObject({ href: "/admin/schools/s1/periods" });
  });

  it("two schools: «مدرسه‌ها» plural and no زنگ‌بندی tile — a bell schedule belongs to one school", () => {
    const tiles = homeTilesFor(twoSchools, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["inbox", "admin-attendance", "schools"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه‌ها", href: "/admin/schools" });
  });

  it("a vice principal of ONE school gets exactly the principal's tiles — «زنگ‌بندی» of that school included (catalog permissions)", () => {
    const vice = homeTilesFor(principal, has(VICE_PERMS));
    expect(vice).toEqual(homeTilesFor(principal, has(PRINCIPAL_PERMS)));
    expect(codes(vice)).toEqual(["inbox", "admin-attendance", "schools", "periods"]);
    expect(tile(vice, "periods")).toMatchObject({ href: "/admin/schools/s1/periods" });
    // Two schools: the same plural «مدرسه‌ها» and no زنگ‌بندی tile as a principal of two.
    expect(homeTilesFor(twoSchools, has(VICE_PERMS))).toEqual(homeTilesFor(twoSchools, has(PRINCIPAL_PERMS)));
  });

  it("an admin hat without the structure write reads the structure but edits none of it: the roll-call report and «مدرسه»", () => {
    expect(codes(homeTilesFor(principal, has(READ_ONLY_ADMIN_PERMS)))).toEqual(["inbox", "admin-attendance", "schools"]);
  });

  it("«مدرسه‌ها»/«مدرسه» is a tile for SCHOOL-scoped admins only — the organization admin has the section instead", () => {
    // The same permission, the same hat: only the SCOPE decides, so neither person meets the destination twice.
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).not.toContain("schools");
    for (const hats of [principal, twoSchools]) expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))).toContain("schools");
  });

  it("no tile is a second door to a nav destination («خانه», «مدیریت», «کلاس من», «کلاس‌ها», «راهنما», «بیشتر»)", () => {
    // The nav is THREE items — the role item, «خانه», «بیشتر» (owner, nav round 2026-09-27). The کارتابل (/inbox)
    // is no nav cell, but it DOES now have a tile (owner, 2026-09-27) — its second, accepted door alongside the
    // Home card's «همهٴ …» link — so «/inbox» is excluded from this nav-destination check on purpose.
    const navHrefs = ["/home", "/admin", "/my-class", "/classes", "/help", "/more"];
    expect(HOME_TILES.filter((t) => navHrefs.includes(t.href))).toEqual([]);
  });

  it("«اعلان‌ها» is not a tile: it is the bell on Home's greeting row, not a destination of its own", () => {
    expect(HOME_TILES.filter((t) => t.href.startsWith("/notifications"))).toEqual([]);
  });

  it("every tile a person actually sees has a real, unique href: one home per destination", () => {
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      const hrefs = homeTilesFor(hats, has(ADMIN_PERMS)).map((t) => t.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) expect(href.startsWith("/")).toBe(true);
    }
  });

  it("a student's own work now has two doors — the «پنل من» tile and the Home card's «همهٴ تکالیف»; no FILTER tile", () => {
    // «تکالیف من» and «انجام‌شده» left the grid (owner, branding round): both were FILTERS of the کارتابل, and
    // the card's «همهٴ تکالیف» opens it with those very two tabs at the top. Only the plain «پنل من» tile remains.
    expect(codes(homeTilesFor(student, has(["workspace.work_item.read", "academic.timetable.read"])))).toEqual(["inbox"]);
    expect(HOME_TILES.filter((t) => t.href.startsWith("/inbox?tab="))).toEqual([]);
    // Round 2026-09-27 (owner): the creation tile is gone too — a teacher with none of the other tiles'
    // permissions now sees an empty grid; creating stays possible only from the inbox page's own header button.
    expect(codes(homeTilesFor(teacher, has(["workspace.work_item.create", "iam.admin.access", "academic.timetable.read"])))).toEqual([]);
  });

  it("there is no creation tile any more: no «new-item» code and no «/inbox/new» href anywhere in HOME_TILES", () => {
    expect(HOME_TILES.filter((t) => t.code === "new-item")).toEqual([]);
    expect(HOME_TILES.filter((t) => t.href === "/inbox/new")).toEqual([]);
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))).not.toContain("new-item");
    }
  });

  it("a teaching principal reads the school's structure, with no creation tile ahead of it", () => {
    expect(codes(homeTilesFor({ isStudent: false, isTeacher: true, isAdmin: true, adminScope: "school", singleSchoolId: "s1" }, has(ADMIN_PERMS)))).toEqual([
      "inbox",
      "admin-attendance",
      "schools",
      "periods",
    ]);
  });
});

describe("isOrganizationAdmin", () => {
  const a = (scopeType: Assignment["scopeType"], permissions: string[]): Assignment => ({ roleCode: "x", roleId: "r", scopeType, scopeId: "s", permissions });
  it("true only for an ORGANIZATION-scoped assignment that carries iam.admin.access", () => {
    expect(isOrganizationAdmin([a("organization", ["iam.admin.access"])])).toBe(true);
    expect(isOrganizationAdmin([a("school", ["iam.admin.access"]), a("branch", ["iam.admin.access"])])).toBe(false);
    expect(isOrganizationAdmin([a("organization", ["workspace.work_item.read"])])).toBe(false);
    expect(isOrganizationAdmin([])).toBe(false);
  });
});

describe("navRoleFor", () => {
  const r = (roleCode: string, scopeType: Assignment["scopeType"], permissions: string[] = []): Assignment => ({ roleCode, roleId: "r", scopeType, scopeId: "s", permissions });
  const student = r("student", "student");
  const teacher = r("teacher", "class_offering", ["workspace.work_item.create"]);
  const principal = r("school_principal", "school", ["iam.admin.access"]);

  it("one hat → that hat", () => {
    expect(navRoleFor([student])).toBe("student");
    expect(navRoleFor([teacher, teacher])).toBe("teacher");
    expect(navRoleFor([principal])).toBe("admin");
    expect(navRoleFor([r("org_admin", "organization", ["iam.admin.access"])])).toBe("admin");
  });

  it("several hats → the highest of admin > teacher > student", () => {
    expect(navRoleFor([student, teacher])).toBe("teacher");
    expect(navRoleFor([teacher, principal])).toBe("admin");
    expect(navRoleFor([student, principal])).toBe("admin");
  });

  it("the admin hat is the permission, not the role name; no hat → null", () => {
    expect(navRoleFor([r("vice_principal", "branch", ["iam.admin.access"])])).toBe("admin");
    expect(navRoleFor([r("guardian_full", "family")])).toBeNull();
    expect(navRoleFor([])).toBeNull();
  });
});

describe("product map", () => {
  it("«تکالیف» is delivered (phase 1) and no longer «به‌زودی»; «برنامهٴ هفتگی» likewise", () => {
    expect(MODULES.find((m) => m.code === "homework")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "class-schedule")?.phase).toBe(1);
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("homework");
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("class-schedule");
    expect(UPCOMING_MODULES.every((m) => m.phase > 1)).toBe(true);
  });

  it("Home carries live destinations only: no tile points at the roadmap (UX review 2026-09-27)", () => {
    // What is coming is reached from «بیشتر ← نقشهٴ راه», never from a muted tile on Home.
    expect(HOME_TILES.filter((t) => t.href.startsWith("/roadmap"))).toEqual([]);
    for (const file of ["HomeGrid.tsx", "dashboard/DashboardTiles.tsx"]) {
      const src = readFileSync(new URL(`../../src/components/home/${file}`, import.meta.url), "utf8");
      expect(src).not.toContain("/roadmap");
      expect(src).not.toContain("UPCOMING");
    }
  });

  it("«حضور و غیاب» is delivered too, and its ONE tile serves both the student and the teacher", () => {
    expect(MODULES.find((m) => m.code === "attendance")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "attendance")?.href).toBe("/attendance");
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("attendance");
    // One destination, one tile (the IA rule) — even though two hats reach it.
    expect(HOME_TILES.filter((t) => t.href === "/attendance")).toHaveLength(1);
    const withAttendance: Permission[] = [...ADMIN_PERMS, "academic.attendance.read"];
    expect(codes(homeTilesFor(student, has(withAttendance)))).toContain("attendance");
    expect(codes(homeTilesFor(teacher, has(withAttendance)))).toContain("attendance");
    // An admin who neither teaches nor studies reads the REPORT instead — a different page with its own tile.
    expect(codes(homeTilesFor(orgAdmin, has(withAttendance)))).not.toContain("attendance");
    expect(codes(homeTilesFor(orgAdmin, has(withAttendance)))).toContain("admin-attendance");
    expect(HOME_TILES.filter((t) => t.href === "/admin/attendance")).toHaveLength(1);
    // Without the permission (a role that never sees attendance) the tile disappears.
    expect(codes(homeTilesFor(student, has(ADMIN_PERMS)))).not.toContain("attendance");
  });
});

