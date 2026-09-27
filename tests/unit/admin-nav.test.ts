// The admin sections (src/lib/admin/nav.ts). Round 5 made «مدیریت» a focused area for PEOPLE AND THEIR ROLES and
// moved every structure destination to a Home tile; round 7 brought «مدرسه‌ها» back as an ORGANIZATION-ONLY section;
// 2026-09-27 (owner) removed «تنظیمات زیرساختی» (مقطع/پایه/سال are a fixed catalog with no page) and put
// «مدرسه‌ها» FIRST. The rules asserted here are the IA contract: the owner's order, the people sections for every
// admin, the organization-only one for the organization admin alone, and NO PERSON ever has two doors to one
// destination across nav + tiles + «بیشتر» (docs/decisions.md «one home per destination»).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, ADMIN_SECTION_KEYS, adminSectionsFor, isAdminSectionFor, schoolsLabelFa } from "@/lib/admin/nav";
import { RESOURCES, schoolResource, subjectResource } from "@/lib/admin/resources";
import { HOME_TILES, homeTilesFor, type TileHats } from "@/lib/modules-registry";

/** Every section, in the owner's order: the landing, «مدرسه‌ها» (the top management option), then the people area. */
const SECTIONS = ["overview", "schools", "students", "staff", "classes", "roles"];
/** Sections a school-scoped admin never gets — the organization's own list of schools. */
const ORG_ONLY = ["schools"];
/** What left the admin nav in round 5 and stayed out — each of these is a Home tile and nothing else. */
const MOVED = ["/admin/attendance"];
/** The fixed catalog (مقطع، پایه، سال، نوبت) and its old hub have NO door at all — no section, no tile, no page. */
const RETIRED = ["/admin/infrastructure", "/admin/years", "/admin/terms", "/admin/grades", "/admin/levels"];

const orgAdmin: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "organization", singleSchoolId: null };
const principal: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school", singleSchoolId: "s1" };
const twoSchools: TileHats = { ...principal, singleSchoolId: null };

describe("schoolsLabelFa", () => {
  it("is singular for a one-school scope only", () => {
    expect(schoolsLabelFa({ kind: "school", schoolIds: ["a"] })).toBe("مدرسه");
    expect(schoolsLabelFa({ kind: "school", schoolIds: ["a", "b"] })).toBe("مدرسه‌ها");
    expect(schoolsLabelFa({ kind: "organization" })).toBe("مدرسه‌ها");
  });
  it("accepts the nav's {org, singleSchool} shape the same way", () => {
    expect(schoolsLabelFa({ org: false, singleSchool: true })).toBe("مدرسه");
    expect(schoolsLabelFa({ org: true, singleSchool: true })).toBe("مدرسه‌ها");
    expect(schoolsLabelFa({ org: false, singleSchool: false })).toBe("مدرسه‌ها");
  });
});

describe("adminSectionsFor", () => {
  it("owner's order — «مدرسه‌ها» first, then دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها; «مدرسه‌ها» for the organization admin alone", () => {
    expect(ADMIN_SECTIONS.map((s) => s.key)).toEqual(SECTIONS);
    expect(adminSectionsFor({ org: true }).map((s) => s.labelFa)).toEqual(["نمای کلی", "مدرسه‌ها", "دانش‌آموزان", "کارکنان", "کلاس‌ها", "نقش‌ها"]);
    expect(adminSectionsFor({ org: false }).map((s) => s.key)).toEqual(SECTIONS.filter((k) => !ORG_ONLY.includes(k)));
    expect(ADMIN_SECTIONS.filter((s) => s.orgOnly).map((s) => s.key)).toEqual(ORG_ONLY);
    // «نمای کلی» is the landing and always the first entry — the rail's «مدیریت» parent, never a row (adminNavItems).
    expect(ADMIN_SECTIONS[0]).toMatchObject({ key: "overview", href: "/admin" });
  });
  it("`isAdminSectionFor` answers per caller — «مدرسه‌ها» is a section for the organization admin, not for a principal", () => {
    expect(isAdminSectionFor("schools", { org: true })).toBe(true);
    expect(isAdminSectionFor("schools", { org: false })).toBe(false);
    expect(isAdminSectionFor("students", { org: false })).toBe(true);
    expect(isAdminSectionFor("years", { org: true })).toBe(false);
  });
  it("every section carries a glyph and an href under /admin, and `ADMIN_SECTION_KEYS` mirrors the list", () => {
    for (const s of ADMIN_SECTIONS) {
      expect(typeof s.icon).toBe("object");
      expect(s.href.startsWith("/admin")).toBe(true);
    }
    expect([...ADMIN_SECTION_KEYS].sort()).toEqual([...SECTIONS].sort());
  });
});

describe("one home per destination (nav · Home tiles · بیشتر)", () => {
  const navHrefs = ADMIN_SECTIONS.map((s) => s.href);
  const tileHrefs = HOME_TILES.map((t) => t.href);

  it("no PERSON sees a destination twice: the sections they get and the tiles they get never overlap", () => {
    for (const [hats, org] of [
      [orgAdmin, true],
      [principal, false],
      [twoSchools, false],
    ] as const) {
      const mine = adminSectionsFor({ org }).map((s) => s.href);
      const tiles = homeTilesFor(hats, () => true).map((t) => t.href);
      expect(tiles.filter((h) => mine.includes(h))).toEqual([]);
    }
    // Round 5: «مدیریت» lost its tile too — the nav's first cell is that door for an admin.
    expect(tileHrefs).not.toContain("/admin");
  });

  it("hub layout (no nav, no rail): the tiles ARE the doors — each of the person's sections is exactly one tile", () => {
    // docs/decisions-pending/home-hub-tiles.md: with the «مدیریت» role item gone, every section (the overview too)
    // becomes its own Home tile, so nothing an admin reached through the nav is lost, and nothing is there twice.
    for (const [hats, org] of [
      [orgAdmin, true],
      [principal, false],
      [twoSchools, false],
    ] as const) {
      const tiles = homeTilesFor(hats, () => true, { variant: "hub" }).map((t) => t.href);
      for (const href of adminSectionsFor({ org }).map((s) => s.href)) expect(tiles.filter((h) => h === href)).toEqual([href]);
      expect(new Set(tiles).size).toBe(tiles.length);
    }
    // A principal of one school gets their own school's hub, not the organization's list.
    const one = homeTilesFor(principal, () => true, { variant: "hub" }).map((t) => t.href);
    expect(one).toContain("/admin/schools/s1");
    expect(one).not.toContain("/admin/schools");
  });

  it("the organization admin reaches «مدرسه‌ها» through the nav, a school admin their own school through a tile", () => {
    const orgTiles = homeTilesFor(orgAdmin, () => true).map((t) => t.href);
    expect(orgTiles).not.toContain("/admin/schools");
    expect(navHrefs).toContain("/admin/schools");
    // A principal of one school keeps the tile, pointed at THAT school's hub — a different destination.
    expect(homeTilesFor(principal, () => true).map((t) => t.href)).toContain("/admin/schools/s1");
    expect(homeTilesFor(twoSchools, () => true).map((t) => t.href)).toContain("/admin/schools");
  });

  it("every moved destination is a Home tile exactly once and is gone from the nav", () => {
    for (const href of MOVED) {
      expect(navHrefs).not.toContain(href);
      expect(tileHrefs.filter((h) => h === href)).toEqual([href]);
    }
  });

  it("the fixed catalog has no door: no section, no tile, no page; its old routes send an admin back to /admin", () => {
    for (const href of RETIRED) {
      expect(navHrefs).not.toContain(href);
      expect(tileHrefs).not.toContain(href);
    }
    expect(existsSync(new URL("../../src/app/(admin)/admin/infrastructure/page.tsx", import.meta.url))).toBe(false);
    const route = readFileSync(new URL("../../src/app/(admin)/admin/[resource]/page.tsx", import.meta.url), "utf8");
    expect(route).toContain('const RETIRED = new Set(["years", "terms", "levels", "grades", "infrastructure"]);');
    expect(route).toContain('redirect("/admin")');
  });

  it("درس‌ها stays editable, one step under «مدرسه‌ها» — linked for the organization admin only, and back to «مدرسه‌ها»", () => {
    expect(navHrefs).not.toContain("/admin/subjects");
    expect(tileHrefs).not.toContain("/admin/subjects");
    expect(schoolResource.links).toEqual([{ href: "/admin/subjects", labelFa: "درس‌ها", orgOnly: true }]);
    expect(subjectResource.back).toEqual({ href: "/admin/schools", labelFa: "مدرسه‌ها" });
    // No resource (so no form and no mutation) is left for years, terms, levels or grades.
    expect(Object.keys(RESOURCES).sort()).toEqual(["classes", "offerings", "schools", "subjects"]);
  });

  it("«بیشتر» is the account page: it never links into /admin", () => {
    const more = readFileSync(new URL("../../src/app/(app)/more/page.tsx", import.meta.url), "utf8");
    expect(more.match(/href="\/admin[^"]*"/g)).toBeNull();
  });
});
