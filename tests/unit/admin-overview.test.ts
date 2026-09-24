// The /admin landing page under the IA rule (docs/decisions.md «one home per destination»): every admin SECTION
// gets exactly one row and «نمای کلی» none (it IS this page). Round 7: «مدرسه‌ها» and «تنظیمات زیرساختی» are
// ordinary rows of that list for the organization admin — the setup checklist has no panel of its own any more —
// while the remaining structure destinations stay Home tiles. Rendered statically, inspected as a string.
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
  it("«تنظیمات زیرساختی» and «مدرسه‌ها» are ordinary section rows for the organization admin — each linked exactly once, neither a panel of its own", () => {
    const html = render(true);
    expect(hrefs(html).filter((h) => h === "/admin/infrastructure")).toEqual(["/admin/infrastructure"]);
    expect(hrefs(html).filter((h) => h === "/admin/schools")).toEqual(["/admin/schools"]);
    expect(html).toContain("تنظیمات زیرساختی");
    // The progress bar lived in a panel above the list; the section row replaced it («progressbar» was its mark).
    expect(html).not.toContain("progressbar");
  });

  it("carries no moved row: سال تحصیلی، پایه‌ها، درس‌ها، مقطع‌ها and حضور و غیاب are Home tiles now", () => {
    const html = render(true);
    for (const href of ["/admin/attendance", "/admin/years", "/admin/grades", "/admin/subjects", "/admin/levels"]) {
      expect(hrefs(html)).not.toContain(href);
    }
  });

  it("shows a school-scoped admin neither «راه‌اندازی» nor the organization's «مدرسه‌ها» list (their door to their own school is a Home tile)", () => {
    const html = render(false);
    expect(hrefs(html)).not.toContain("/admin/infrastructure");
    expect(hrefs(html)).not.toContain("/admin/schools");
    expect(html).not.toContain("راه‌اندازی");
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
