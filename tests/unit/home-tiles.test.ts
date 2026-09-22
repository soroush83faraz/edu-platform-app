// The Home tile registry (`homeTilesFor`) under the IA rule of QA round 3 (docs/decisions.md «one home per
// destination»): Home is the person's OWN work, so a tile is only a personal destination the navigation does not
// already carry — no admin SECTION («دانش‌آموزان», «کارکنان», «کلاس‌ها», «راه‌اندازی» live on /admin alone), and no
// second door to the nav's own role item («کلاس من», «کلاس‌های من»). The one admin tile is «مدیریت», the door into
// the hub. Plus the pure organization-admin predicate and the nav role.
import { describe, expect, it } from "vitest";
import { HOME_TILES, HOME_UPCOMING, MODULES, homeTilesFor, type TileHats } from "@/lib/modules-registry";
import { isOrganizationAdmin, navRoleFor, type Assignment } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";

const ADMIN_PERMS: Permission[] = ["iam.admin.access", "tenancy.structure.write", "iam.person.write", "workspace.work_item.read", "workspace.work_item.create"];
const has = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const codes = (tiles: ReturnType<typeof homeTilesFor>) => tiles.map((t) => t.code);

const orgAdmin: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "organization" };
const principal: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school" };
const teacher: TileHats = { isStudent: false, isTeacher: true, isAdmin: false, adminScope: null };
const student: TileHats = { isStudent: true, isTeacher: false, isAdmin: false, adminScope: null };

describe("homeTilesFor", () => {
  it("an admin's ONLY tile is «مدیریت» — every admin section lives on /admin", () => {
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).toEqual(["admin"]);
    expect(codes(homeTilesFor(principal, has(ADMIN_PERMS)))).toEqual(["admin"]);
    expect(HOME_TILES.filter((t) => t.role === "admin").map((t) => t.href)).toEqual(["/admin"]);
    expect(HOME_TILES.some((t) => t.href.startsWith("/admin/"))).toBe(false);
  });

  it("no tile is a second door to a nav destination («کلاس من», «کلاس‌ها», «راهنما», «بیشتر», «خانه»)", () => {
    // The nav is THREE items now — the role item, «خانه», «بیشتر» (docs/decisions.md «navigation round 4»).
    // «مدیریت» stays the one documented exception: /admin is another AREA, and an admin-only account's only tile.
    const navHrefs = ["/my-class", "/classes", "/help", "/more", "/home"];
    expect(HOME_TILES.filter((t) => navHrefs.includes(t.href))).toEqual([]);
  });

  it("«اعلان‌ها» (round 3) and «پنل من» (round 4) left the nav for Home's greeting row, not for the grid", () => {
    // Their ONE door each is a header control — `NotificationsBell` / `InboxDoor`, carrying the unread badge.
    // A tile may only be a FILTER of the کارتابل («تکالیف من» `?tab=todo`) or another page under it («تکلیف جدید»).
    expect(HOME_TILES.filter((t) => t.href === "/inbox")).toEqual([]);
    expect(HOME_TILES.filter((t) => t.href.startsWith("/notifications"))).toEqual([]);
  });

  it("every tile href is unique: one home per destination", () => {
    const hrefs = HOME_TILES.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("a student sees their own two work views; a teacher the two they give", () => {
    expect(codes(homeTilesFor(student, has(["workspace.work_item.read", "academic.timetable.read"])))).toEqual(["my-todo", "my-done"]);
    expect(codes(homeTilesFor(teacher, has(["workspace.work_item.create", "iam.admin.access", "academic.timetable.read"])))).toEqual(["given", "new-item"]);
  });

  it("a teaching principal reads personal tiles first, then the hub", () => {
    expect(codes(homeTilesFor({ isStudent: false, isTeacher: true, isAdmin: true, adminScope: "school" }, has(ADMIN_PERMS)))).toEqual(["given", "new-item", "admin"]);
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
    // An admin who is neither reads the report in the hub, so no tile.
    expect(codes(homeTilesFor(orgAdmin, has(withAttendance)))).not.toContain("attendance");
    // Without the permission (a role that never sees attendance) the tile disappears.
    expect(codes(homeTilesFor(student, has(ADMIN_PERMS)))).not.toContain("attendance");
  });
});

