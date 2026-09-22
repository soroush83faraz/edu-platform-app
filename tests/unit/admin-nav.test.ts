// The admin sections (src/lib/admin/nav.ts): the owner's order, the organization-only entry, and the «مدرسه» /
// «مدرسه‌ها» label — singular only for a school-scoped admin who manages exactly one school.
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, adminSectionsFor, schoolsLabelFa } from "@/lib/admin/nav";

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
  it("orders people and classes first; only the organization admin gets «راه‌اندازی»", () => {
    const org = adminSectionsFor({ org: true, singleSchool: false });
    expect(org.map((s) => s.key)).toEqual(["overview", "students", "staff", "classes", "schools", "years", "grades", "subjects", "levels", "roles", "onboarding"]);
    const school = adminSectionsFor({ org: false, singleSchool: true });
    expect(school.some((s) => s.key === "onboarding")).toBe(false);
    expect(school.find((s) => s.key === "schools")?.labelFa).toBe("مدرسه");
    expect(org.find((s) => s.key === "schools")?.labelFa).toBe("مدرسه‌ها");
  });
  it("every section carries a glyph and an href under /admin", () => {
    for (const s of ADMIN_SECTIONS) {
      expect(typeof s.icon).toBe("object");
      expect(s.href.startsWith("/admin")).toBe(true);
    }
  });
});
