// The admin sections (src/lib/admin/nav.ts) after QA round 5: «مدیریت» is a focused area for PEOPLE AND THEIR
// ROLES, and every structure destination moved to a Home tile. The rules asserted here are the IA contract, not
// today's list: the nav ⊆ the people sections, and a destination has exactly ONE door across nav + tiles + «بیشتر»
// (docs/decisions.md «one home per destination»).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, ADMIN_SECTION_KEYS, adminSectionsFor, schoolsLabelFa } from "@/lib/admin/nav";
import { HOME_TILES } from "@/lib/modules-registry";

/** What «مدیریت» is allowed to contain: the people and their roles, and nothing else. */
const PEOPLE_SECTIONS = ["overview", "students", "staff", "classes", "roles"];
/** What left the admin nav in round 5 — each of these is now a Home tile and nothing else. */
const MOVED = ["/admin/attendance", "/admin/schools", "/admin/years", "/admin/grades", "/admin/subjects", "/admin/levels", "/admin/onboarding"];

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
  it("«مدیریت» is people and roles only — nothing structural may return to this list", () => {
    expect(ADMIN_SECTIONS.map((s) => s.key)).toEqual(PEOPLE_SECTIONS);
    for (const s of ADMIN_SECTIONS) expect(PEOPLE_SECTIONS).toContain(s.key);
    // The organization admin and a principal now see the SAME sections: the organization-only entries all moved.
    expect(adminSectionsFor({ org: true }).map((s) => s.labelFa)).toEqual(adminSectionsFor({ org: false }).map((s) => s.labelFa));
  });
  it("every section carries a glyph and an href under /admin, and `ADMIN_SECTION_KEYS` mirrors the list", () => {
    for (const s of ADMIN_SECTIONS) {
      expect(typeof s.icon).toBe("object");
      expect(s.href.startsWith("/admin")).toBe(true);
    }
    expect([...ADMIN_SECTION_KEYS].sort()).toEqual([...PEOPLE_SECTIONS].sort());
  });
});

describe("one home per destination (nav · Home tiles · بیشتر)", () => {
  const navHrefs = ADMIN_SECTIONS.map((s) => s.href);
  const tileHrefs = HOME_TILES.map((t) => t.href);

  it("no destination is both an admin section and a Home tile — /admin included", () => {
    expect(tileHrefs.filter((h) => navHrefs.includes(h))).toEqual([]);
    // Round 5: «مدیریت» lost its tile too — the nav's first cell is that door for an admin.
    expect(tileHrefs).not.toContain("/admin");
  });

  it("every moved destination is a Home tile exactly once and is gone from the nav", () => {
    for (const href of MOVED) {
      expect(navHrefs).not.toContain(href);
      expect(tileHrefs.filter((h) => h === href)).toEqual([href]);
    }
  });

  it("«بیشتر» is the account page: it never links into /admin", () => {
    const more = readFileSync(new URL("../../src/app/(app)/more/page.tsx", import.meta.url), "utf8");
    expect(more.match(/href="\/admin[^"]*"/g)).toBeNull();
  });
});
