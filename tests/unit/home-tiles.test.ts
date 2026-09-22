// The Home tile registry (`homeTilesFor`) under the IA rule (docs/decisions.md «one home per destination»): a
// destination has exactly ONE door, and since QA round 5 Home carries most of them — «پنل من» first (the کارتابل
// is a tile, not a header control), then the person's role tiles, then one tile per STRUCTURE page, each gated by
// the permission and scope that guard the page itself. No tile is a second door to a NAV destination — «کلاس من»,
// «کلاس‌های من», «مدیریت» (/admin is the admin's own nav cell), «بیشتر», «خانه» — and no admin SECTION
// («دانش‌آموزان», «کارکنان», «کلاس‌ها», «نقش‌ها») gets one either: those live on /admin.
// Plus the pure organization-admin predicate and the nav role.
import { describe, expect, it } from "vitest";
import { HOME_TILES, HOME_UPCOMING, MODULES, homeTilesFor, type TileHats } from "@/lib/modules-registry";
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
  it("«پنل من» is the first tile, for every hat and for a person with none", () => {
    expect(HOME_TILES[0].code).toBe("inbox");
    for (const hats of [orgAdmin, principal, teacher, student]) {
      expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))[0]).toBe("inbox");
    }
    const noHat: TileHats = { isStudent: false, isTeacher: false, isAdmin: false, adminScope: null };
    expect(codes(homeTilesFor(noHat, has(["workspace.work_item.read"])))).toEqual(["inbox"]);
    // Without the کارتابل permission it disappears like any other tile.
    expect(codes(homeTilesFor(student, has(["academic.timetable.read"])))).not.toContain("inbox");
  });

  it("the organization admin: the structure tiles the nav gave up, in that order — and no «مدیریت» tile", () => {
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).toEqual(["inbox", "admin-attendance", "schools", "years", "grades", "subjects", "levels", "onboarding"]);
    // «مدرسه‌ها» plural, the list; «زنگ‌بندی» has no organization-wide page, so no tile.
    expect(tile(homeTilesFor(orgAdmin, has(ADMIN_PERMS)), "schools")).toMatchObject({ labelFa: "مدرسه‌ها", href: "/admin/schools" });
  });

  it("a principal of ONE school gets «مدرسه» and that school's زنگ‌بندی, and no organization catalog", () => {
    const tiles = homeTilesFor(principal, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["inbox", "admin-attendance", "schools", "years", "periods"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه", href: "/admin/schools/s1" });
    expect(tile(tiles, "periods")).toMatchObject({ href: "/admin/schools/s1/periods" });
  });

  it("two schools: «مدرسه‌ها» plural and no زنگ‌بندی tile — a bell schedule belongs to one school", () => {
    const tiles = homeTilesFor(twoSchools, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["inbox", "admin-attendance", "schools", "years"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه‌ها", href: "/admin/schools" });
  });

  it("a vice principal reads the structure but edits none of it: the roll-call report and «مدرسه»", () => {
    expect(codes(homeTilesFor(principal, has(VICE_PERMS)))).toEqual(["inbox", "admin-attendance", "schools"]);
  });

  it("no tile is a second door to a nav destination («مدیریت», «کلاس من», «کلاس‌ها», «راهنما», «بیشتر», «خانه»)", () => {
    // The nav is THREE items — the role item, «خانه», «بیشتر» (docs/decisions.md «navigation round 4»). Round 5
    // closed the last exception: /admin is the admin's own nav cell, so no tile points at it either.
    const navHrefs = ["/admin", "/my-class", "/classes", "/help", "/more", "/home"];
    expect(HOME_TILES.filter((t) => navHrefs.includes(t.href))).toEqual([]);
  });

  it("«پنل من» is a TILE (round 5) while «اعلان‌ها» stays a header control", () => {
    // The کارتابل's ONE door is this tile, which carries the unread badge; the bell keeps its own control.
    // Every other work tile is a FILTER of the کارتابل («تکالیف من» `?tab=todo`) or a page under it.
    expect(HOME_TILES.filter((t) => t.href === "/inbox").map((t) => t.labelFa)).toEqual(["پنل من"]);
    expect(HOME_TILES.filter((t) => t.href.startsWith("/notifications"))).toEqual([]);
  });

  it("every tile a person actually sees has a real, unique href: one home per destination", () => {
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      const hrefs = homeTilesFor(hats, has(ADMIN_PERMS)).map((t) => t.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) expect(href.startsWith("/")).toBe(true);
    }
  });

  it("a student sees their own two work views; a teacher the two they give", () => {
    expect(codes(homeTilesFor(student, has(["workspace.work_item.read", "academic.timetable.read"])))).toEqual(["inbox", "my-todo", "my-done"]);
    expect(codes(homeTilesFor(teacher, has(["workspace.work_item.create", "iam.admin.access", "academic.timetable.read"])))).toEqual(["given", "new-item"]);
  });

  it("a teaching principal reads personal tiles first, then the school's structure", () => {
    expect(codes(homeTilesFor({ isStudent: false, isTeacher: true, isAdmin: true, adminScope: "school", singleSchoolId: "s1" }, has(ADMIN_PERMS)))).toEqual([
      "inbox",
      "given",
      "new-item",
      "admin-attendance",
      "schools",
      "years",
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
  it("«تکالیف» is delivered (phase 1) and no longer a «به‌زودی» tile; «برنامهٴ کلاسی» likewise", () => {
    expect(MODULES.find((m) => m.code === "homework")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "class-schedule")?.phase).toBe(1);
    expect(HOME_UPCOMING.map((m) => m.code)).not.toContain("homework");
    expect(HOME_UPCOMING.map((m) => m.code)).not.toContain("class-schedule");
    expect(HOME_UPCOMING.every((m) => m.phase > 1)).toBe(true);
  });

  it("«حضور و غیاب» is delivered too, and its ONE tile serves both the student and the teacher", () => {
    expect(MODULES.find((m) => m.code === "attendance")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "attendance")?.href).toBe("/attendance");
    expect(HOME_UPCOMING.map((m) => m.code)).not.toContain("attendance");
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

