// «کارنامهٴ توصیفی» on the hub Home: the staff tile for a teacher of a primary class or an admin of a school with
// one (permission + `reportCard.staff`), «کارنامهٴ من» for a primary student — never for a secondary school, and
// before «حضور و غیاب», which stays the last tile; every tile keeps a distinct label and glyph.
import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "../../scripts/catalog";
import { homeTilesFor, type TileHats } from "@/lib/modules-registry";
import type { Permission } from "@/modules/iam/permissions";

const perms = (code: string): Permission[] => SYSTEM_ROLES.find((r) => r.code === code)?.permissions ?? [];
const has = (list: readonly Permission[]) => (p: Permission) => list.includes(p);
const codes = (hats: TileHats, list: Permission[]) => homeTilesFor(hats, has(list), { variant: "hub" }).map((t) => t.code);

const primary = { staff: true, student: false };
const teacher: TileHats = { isStudent: false, isTeacher: true, isAdmin: false, adminScope: null, reportCard: primary };
const principal: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school", singleSchoolId: "s1", reportCard: primary };
const student: TileHats = { isStudent: true, isTeacher: false, isAdmin: false, adminScope: null, reportCard: { staff: false, student: true } };

describe("report-card Home tiles (hub)", () => {
  it("a primary teacher and a primary principal get «کارنامهٴ توصیفی»; a primary student gets «کارنامهٴ من»", () => {
    expect(codes(teacher, perms("teacher"))).toContain("report-card");
    expect(codes(principal, perms("school_principal"))).toContain("report-card");
    expect(codes(student, perms("student"))).toEqual(expect.arrayContaining(["my-report-card"]));
    expect(codes(student, perms("student"))).not.toContain("report-card");
    expect(codes(teacher, perms("teacher"))).not.toContain("my-report-card");
  });

  it("nobody outside a primary class sees them — the permission alone is not enough", () => {
    for (const hats of [teacher, principal, student]) {
      const secondary = { ...hats, reportCard: { staff: false, student: false } };
      expect(codes(secondary, [...perms("school_principal"), ...perms("student")])).not.toEqual(expect.arrayContaining(["report-card"]));
      expect(codes(secondary, [...perms("school_principal"), ...perms("student")])).not.toContain("my-report-card");
      const unknown = { ...hats, reportCard: undefined };
      expect(codes(unknown, perms("school_principal"))).not.toContain("report-card");
    }
    // A guardian (no report-card permission) never gets it.
    expect(codes(student, perms("guardian_full"))).not.toContain("my-report-card");
  });

  it("sits before «حضور و غیاب» (still last) with a label and glyph no other tile of that person uses", () => {
    for (const [hats, list] of [
      [teacher, perms("teacher")],
      [{ ...principal, isTeacher: true }, [...perms("school_principal"), ...perms("teacher")]],
      [student, perms("student")],
    ] as const) {
      const tiles = homeTilesFor(hats, has(list), { variant: "hub" });
      const at = tiles.findIndex((t) => t.code === "report-card" || t.code === "my-report-card");
      expect(at).toBeGreaterThan(0);
      expect(tiles.at(-1)?.code).toMatch(/attendance/);
      expect(new Set(tiles.map((t) => t.labelFa)).size).toBe(tiles.length);
      expect(new Set(tiles.map((t) => t.icon)).size).toBe(tiles.length);
    }
  });
});
