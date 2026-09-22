// The Home tile registry (`homeTilesFor`) and the pure organization-admin predicate behind the owner's rule of QA
// round 2: «راه‌اندازی مدرسه» (school setup) belongs to the organization admin — the one who defines schools — so a
// principal or vice principal never sees the tile, the admin nav entry or the «بیشتر» row (the page itself is
// NOT_FOUND for them, checked in tests/int/admin-scope.test.ts against the database-derived scope).
import { describe, expect, it } from "vitest";
import { HOME_TILES, homeTilesFor, type TileHats } from "@/lib/modules-registry";
import { isOrganizationAdmin, navRoleFor, type Assignment } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";

const ADMIN_PERMS: Permission[] = ["iam.admin.access", "tenancy.structure.write", "iam.person.write", "workspace.work_item.read", "workspace.work_item.create"];
const has = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const codes = (tiles: ReturnType<typeof homeTilesFor>) => tiles.map((t) => t.code);

const orgAdmin: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "organization" };
const principal: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school" };
const teacher: TileHats = { isStudent: false, isTeacher: true, isAdmin: false, adminScope: null };

describe("homeTilesFor", () => {
  it("the organization admin sees every admin tile, «راه‌اندازی مدرسه» included", () => {
    const admin = HOME_TILES.filter((t) => t.role === "admin").map((t) => t.code);
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).toEqual(admin);
    expect(admin).toContain("onboarding");
  });

  it("a school-scoped admin (principal, vice principal) gets the admin tiles WITHOUT «راه‌اندازی مدرسه»", () => {
    const tiles = codes(homeTilesFor(principal, has(ADMIN_PERMS)));
    expect(tiles).not.toContain("onboarding");
    expect(tiles).toEqual(HOME_TILES.filter((t) => t.role === "admin" && t.code !== "onboarding").map((t) => t.code));
  });

  it("the tile is the only organization-scoped one; a teacher without the admin hat sees no admin tile at all", () => {
    expect(HOME_TILES.filter((t) => t.adminScope).map((t) => t.code)).toEqual(["onboarding"]);
    const tiles = codes(homeTilesFor(teacher, has(["workspace.work_item.create", "iam.admin.access", "academic.timetable.read"])));
    expect(tiles).toEqual(["classes", "teacher-timetable", "given", "new-item"]);
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
