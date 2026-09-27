// The /admin landing page under the IA rule (docs/decisions.md «one home per destination»): every admin SECTION
// gets exactly one row and «نمای کلی» none (it IS this page). «مدرسه‌ها» is the FIRST row for the organization admin
// (owner, 2026-09-27); «تنظیمات زیرساختی» is gone and the fixed catalog (مقطع، پایه، سال) has no door at all.
// Rendered statically, inspected as a string.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminCounts } from "@/lib/admin/overview";
import type { AdminScope } from "@/modules/iam/service";

// `PageHeader` is async and reads the request's shell context (a DB query): a plain title stands in for it here.
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => createElement("h2", null, title) }));

const { AdminOverview } = await import("@/components/admin/AdminOverview");
const { adminSectionsFor } = await import("@/lib/admin/nav");

const counts: AdminCounts = {
  schools: 1,
  branches: 1,
  years: 1,
  currentYears: 1,
  terms: 2,
  levels: 3,
  grades: 12,
  subjects: 20,
  classes: 8,
  classesWithoutOfferings: 0,
  classesWithoutTimetable: 0,
  offerings: 40,
  offeringsWithoutTeacher: 0,
  teachers: 15,
  teacherAssignments: 40,
  staff: 18,
  students: 175,
  managerRoles: 3,
  activeEnrollments: 175,
  studentsWithoutClass: 0,
  accountsPending: 0,
};

/** What `adminNavItems` hands the page: the sections of that caller, «نمای کلی» already dropped. */
const itemsFor = (org: boolean) => adminSectionsFor({ org }).filter((i) => i.key !== "overview");

function render(org: boolean) {
  const scope: AdminScope = org ? { kind: "organization" } : { kind: "school", schoolIds: ["s1"] };
  return renderToStaticMarkup(createElement(AdminOverview, { data: { scope, counts }, items: itemsFor(org) }));
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("AdminOverview (/admin landing)", () => {
  it("«مدرسه‌ها» is the organization admin's first section row — linked exactly once, with درس‌ها named in its hint", () => {
    const html = render(true);
    const rows = hrefs(html.slice(html.indexOf('class="surface-work'))).filter((h) => h.startsWith("/admin/"));
    expect(rows[0]).toBe("/admin/schools");
    expect(hrefs(html).filter((h) => h === "/admin/schools")).toEqual(["/admin/schools"]);
    expect(html).toContain("مدرسهٴ جدید، درس‌ها و صفحهٴ مدیریت هر مدرسه");
    expect(html).not.toContain("progressbar");
  });

  it("carries no door to the fixed catalog or its old hub, and none to درس‌ها or حضور و غیاب (the one lives under «مدرسه‌ها», the other is a Home tile)", () => {
    const html = render(true);
    for (const href of ["/admin/infrastructure", "/admin/attendance", "/admin/years", "/admin/terms", "/admin/grades", "/admin/subjects", "/admin/levels"]) {
      expect(hrefs(html)).not.toContain(href);
    }
    expect(html).not.toContain("تنظیمات زیرساختی");
  });

  it("shows a school-scoped admin not the organization's «مدرسه‌ها» list (their door to their own school is a Home tile)", () => {
    const html = render(false);
    expect(hrefs(html)).not.toContain("/admin/schools");
    expect(hrefs(html)).not.toContain("/admin/infrastructure");
  });

  it("lists every other section once and never «نمای کلی» (this page)", () => {
    const html = render(true);
    // The section list is the last block: everything after the counters panel (`surface-panel`).
    const rows = hrefs(html.slice(html.indexOf('class="surface-work'))).filter((h) => h.startsWith("/admin/"));
    // Every section the nav carries, in its order — whatever sections `nav.ts` holds today.
    expect(rows).toEqual(itemsFor(true).map((i) => i.href));
    expect(html).not.toContain("نمای کلی");
  });
});
