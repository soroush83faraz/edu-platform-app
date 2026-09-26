// The admin sections (src/lib/admin/nav.ts). Round 5 made «مدیریت» a focused area for PEOPLE AND THEIR ROLES and
// moved every structure destination to a Home tile; round 7 brought «مدرسه‌ها» and «تنظیمات زیرساختی» back as
// ORGANIZATION-ONLY sections. The rules asserted here are the IA contract, not today's list: the people sections
// belong to every admin, the organization-only ones to the organization admin alone, and NO PERSON ever has two
// doors to one destination across nav + tiles + «بیشتر» (docs/decisions.md «one home per destination»).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, ADMIN_SECTION_KEYS, adminSectionsFor, isAdminSectionFor, schoolsLabelFa } from "@/lib/admin/nav";
import { HOME_TILES, homeTilesFor, type TileHats } from "@/lib/modules-registry";

/** Every section, in order: the people area first, then what only the organization admin sees. */
const SECTIONS = ["overview", "students", "staff", "classes", "roles", "schools", "infrastructure"];
/** Sections a school-scoped admin never gets — the organization's own structure and its setup. */
const ORG_ONLY = ["schools", "infrastructure"];
/** What left the admin nav in round 5 and stayed out — each of these is a Home tile and nothing else. */
const MOVED = ["/admin/attendance"];
// The organisation catalogs live behind «تنظیمات زیرساختی» (/admin/infrastructure): neither a Home tile nor a nav row.
const CATALOGS = ["/admin/years", "/admin/grades", "/admin/subjects", "/admin/levels"];

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
  it("the people area belongs to every admin; «مدرسه‌ها» and «تنظیمات زیرساختی» to the organization admin alone", () => {
    expect(ADMIN_SECTIONS.map((s) => s.key)).toEqual(SECTIONS);
    expect(adminSectionsFor({ org: true }).map((s) => s.key)).toEqual(SECTIONS);
    expect(adminSectionsFor({ org: false }).map((s) => s.key)).toEqual(SECTIONS.filter((k) => !ORG_ONLY.includes(k)));
    expect(ADMIN_SECTIONS.filter((s) => s.orgOnly).map((s) => s.key)).toEqual(ORG_ONLY);
    expect(
      adminSectionsFor({ org: true })
        .filter((s) => s.orgOnly)
        .map((s) => s.labelFa),
    ).toEqual(["مدرسه‌ها", "تنظیمات زیرساختی"]);
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

  it("the organization admin reaches «مدرسه‌ها» and «راه‌اندازی» through the nav, a school admin their own school through a tile", () => {
    const orgTiles = homeTilesFor(orgAdmin, () => true).map((t) => t.href);
    expect(orgTiles).not.toContain("/admin/schools");
    expect(navHrefs).toContain("/admin/schools");
    expect(navHrefs).toContain("/admin/infrastructure");
    // A principal of one school keeps the tile, pointed at THAT school's hub — a different destination.
    expect(homeTilesFor(principal, () => true).map((t) => t.href)).toContain("/admin/schools/s1");
    expect(homeTilesFor(twoSchools, () => true).map((t) => t.href)).toContain("/admin/schools");
    // …and no admin of any scope ever gets the setup checklist as a tile.
    for (const hats of [orgAdmin, principal, twoSchools]) {
      expect(homeTilesFor(hats, () => true).map((t) => t.href)).not.toContain("/admin/infrastructure");
    }
  });

  it("every moved destination is a Home tile exactly once and is gone from the nav", () => {
    for (const href of MOVED) {
      expect(navHrefs).not.toContain(href);
      expect(tileHrefs.filter((h) => h === href)).toEqual([href]);
    }
  });

  it("the catalogs have one door: the infrastructure page, not a tile and not a nav row", () => {
    const infra = readFileSync(new URL("../../src/app/(admin)/admin/infrastructure/page.tsx", import.meta.url), "utf8");
    for (const href of CATALOGS) {
      expect(navHrefs).not.toContain(href);
      expect(tileHrefs).not.toContain(href);
      expect(infra).toContain(href);
    }
  });

  it("«بیشتر» is the account page: it never links into /admin", () => {
    const more = readFileSync(new URL("../../src/app/(app)/more/page.tsx", import.meta.url), "utf8");
    expect(more.match(/href="\/admin[^"]*"/g)).toBeNull();
  });
});
