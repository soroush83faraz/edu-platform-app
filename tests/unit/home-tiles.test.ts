// The Home tile registry (`homeTilesFor`) under the IA rule (docs/decisions.md «one home per destination»): a
// destination has exactly ONE door. Home carries the person's role tiles, then one tile per STRUCTURE page, each
// gated by the permission and scope that guard the page itself. No tile is a second door to a NAV destination —
// «پنل من» (a nav cell again since the 2026-09-27 UX review), «کلاس من», «کلاس‌های من», «مدیریت», «بیشتر»,
// «خانه» — and no admin SECTION («دانش‌آموزان», «کارکنان», «کلاس‌ها», «نقش‌ها») gets one either.
// Plus the pure organization-admin predicate and the nav role.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
/** A vice principal: the admin hat, the roll-call report and the structure READ — never the structure write. */
const VICE_PERMS: Permission[] = ["iam.admin.access", "tenancy.structure.read", "iam.person.write", "academic.attendance.report", "workspace.work_item.read"];
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
  it("no «پنل من» tile, for any hat: the کارتابل is a nav destination (UX review 2026-09-27)", () => {
    expect(HOME_TILES.filter((t) => t.href === "/inbox" || t.code === "inbox")).toEqual([]);
    for (const hats of [orgAdmin, principal, teacher, student]) {
      expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))).not.toContain("inbox");
    }
    const noHat: TileHats = { isStudent: false, isTeacher: false, isAdmin: false, adminScope: null };
    expect(codes(homeTilesFor(noHat, has(["workspace.work_item.read"])))).toEqual([]);
  });

  it("the organization admin: the structure tiles the nav gave up, in that order — and no «مدیریت», «مدرسه‌ها» or «راه‌اندازی» tile", () => {
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).toEqual(["new-item", "admin-attendance"]);
    // Round 7: «مدرسه‌ها» (the organization's list) and «تنظیمات زیرساختی» are admin SECTIONS for this person, so
    // Home carries neither — one door each. «زنگ‌بندی» has no organization-wide page, so it has no tile either.
    expect(tile(homeTilesFor(orgAdmin, has(ADMIN_PERMS)), "schools")).toBeUndefined();
    expect(HOME_TILES.filter((t) => t.href === "/admin/infrastructure")).toEqual([]);
  });

  it("a principal of ONE school gets «مدرسه» and that school's زنگ‌بندی, and no organization catalog", () => {
    const tiles = homeTilesFor(principal, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["new-item", "admin-attendance", "schools", "periods"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه", href: "/admin/schools/s1" });
    expect(tile(tiles, "periods")).toMatchObject({ href: "/admin/schools/s1/periods" });
  });

  it("two schools: «مدرسه‌ها» plural and no زنگ‌بندی tile — a bell schedule belongs to one school", () => {
    const tiles = homeTilesFor(twoSchools, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["new-item", "admin-attendance", "schools"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه‌ها", href: "/admin/schools" });
  });

  it("a vice principal reads the structure but edits none of it: the roll-call report and «مدرسه»", () => {
    expect(codes(homeTilesFor(principal, has(VICE_PERMS)))).toEqual(["admin-attendance", "schools"]);
  });

  it("«مدرسه‌ها»/«مدرسه» is a tile for SCHOOL-scoped admins only — the organization admin has the section instead", () => {
    // The same permission, the same hat: only the SCOPE decides, so neither person meets the destination twice.
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).not.toContain("schools");
    for (const hats of [principal, twoSchools]) expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))).toContain("schools");
  });

  it("no tile is a second door to a nav destination («خانه», «پنل من», «مدیریت», «کلاس من», «کلاس‌ها», «راهنما», «بیشتر»)", () => {
    // The nav is FOUR items — «خانه», «پنل من», the role item, «بیشتر» (docs/decisions.md, UX review 2026-09-27).
    const navHrefs = ["/home", "/inbox", "/admin", "/my-class", "/classes", "/help", "/more"];
    expect(HOME_TILES.filter((t) => navHrefs.includes(t.href))).toEqual([]);
  });

  it("neither the کارتابل nor «اعلان‌ها» is a tile: one is a nav cell, the other the bell on Home's greeting row", () => {
    expect(HOME_TILES.filter((t) => t.href === "/inbox")).toEqual([]);
    expect(HOME_TILES.filter((t) => t.href.startsWith("/notifications"))).toEqual([]);
  });

  it("every tile a person actually sees has a real, unique href: one home per destination", () => {
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      const hrefs = homeTilesFor(hats, has(ADMIN_PERMS)).map((t) => t.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) expect(href.startsWith("/")).toBe(true);
    }
  });

  it("a student's own work is ONE door — the «پنل من» nav cell; a teacher keeps the tile they create from", () => {
    // «تکالیف من» and «انجام‌شده» left the grid (owner, branding round): both were FILTERS of the کارتابل, and
    // «پنل من» opens it with those very two tabs at the top.
    expect(codes(homeTilesFor(student, has(["workspace.work_item.read", "academic.timetable.read"])))).toEqual([]);
    expect(HOME_TILES.filter((t) => t.href.startsWith("/inbox?tab="))).toEqual([]);
    expect(codes(homeTilesFor(teacher, has(["workspace.work_item.create", "iam.admin.access", "academic.timetable.read"])))).toEqual(["new-item"]);
  });

  it("the ONE creation tile is for admins and students too, and says the person's own word", () => {
    const label = (hats: TileHats) => tile(homeTilesFor(hats, has(ADMIN_PERMS)), "new-item")?.labelFa;
    expect(label(teacher)).toBe("تکلیف جدید");
    expect(label(orgAdmin)).toBe("تسک جدید");
    expect(label(principal)).toBe("تسک جدید");
    // Round 6: a student opens work for THEMSELVES, and that is a «تسک».
    expect(label(student)).toBe("تسک جدید");
    // A teaching principal is a teacher first.
    expect(label({ isStudent: false, isTeacher: true, isAdmin: true, adminScope: "school", singleSchoolId: "s1" })).toBe("تکلیف جدید");
    // The permission still decides: without `workspace.work_item.create` nobody sees it (a vice principal,
    // and a student in a deployment whose catalog has not been re-seeded).
    expect(codes(homeTilesFor(principal, has(VICE_PERMS)))).not.toContain("new-item");
    expect(codes(homeTilesFor(student, has(["workspace.work_item.read"])))).not.toContain("new-item");
    // Still ONE door to the form.
    expect(HOME_TILES.filter((t) => t.href === "/inbox/new")).toHaveLength(1);
    // A student's create tile has no mirror.
    expect(codes(homeTilesFor(student, has(ADMIN_PERMS)))).toEqual(["new-item"]);
  });

  it("a teaching principal reads personal tiles first, then the school's structure", () => {
    expect(codes(homeTilesFor({ isStudent: false, isTeacher: true, isAdmin: true, adminScope: "school", singleSchoolId: "s1" }, has(ADMIN_PERMS)))).toEqual([
      "new-item",
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
  it("«تکالیف» is delivered (phase 1) and no longer «به‌زودی»; «برنامهٴ کلاسی» likewise", () => {
    expect(MODULES.find((m) => m.code === "homework")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "class-schedule")?.phase).toBe(1);
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("homework");
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("class-schedule");
    expect(UPCOMING_MODULES.every((m) => m.phase > 1)).toBe(true);
  });

  it("Home carries live destinations only: no tile points at the roadmap (UX review 2026-09-27)", () => {
    // What is coming is reached from «بیشتر ← نقشهٴ راه», never from a muted tile on Home.
    expect(HOME_TILES.filter((t) => t.href.startsWith("/roadmap"))).toEqual([]);
    for (const file of ["HomeGrid.tsx", "dashboard/DashboardAside.tsx"]) {
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

