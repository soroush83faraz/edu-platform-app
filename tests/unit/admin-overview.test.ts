// The /admin landing page under the IA rule of QA round 3 (docs/decisions.md «one home per destination»): every
// admin SECTION gets exactly one row, and the two that are not sections get none — «نمای کلی» is this page, and
// «راه‌اندازی» is the setup panel the page renders above the list. Rendered statically, inspected as a string.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminCounts } from "@/lib/admin/overview";
import type { AdminScope } from "@/modules/iam/service";

// `PageHeader` is async and reads the request's shell context (a DB query): a plain title stands in for it here.
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => createElement("h2", null, title) }));

const { AdminOverview } = await import("@/components/admin/AdminOverview");
const { OnboardingProgress } = await import("@/components/admin/OnboardingProgress");
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
  activeEnrollments: 175,
  studentsWithoutClass: 0,
  accountsPending: 0,
};

/** What `adminNavItems` hands the page: the sections of that caller, «نمای کلی» already dropped. */
const itemsFor = (org: boolean) => adminSectionsFor({ org, singleSchool: !org }).filter((i) => i.key !== "overview");

function render(org: boolean) {
  const scope: AdminScope = org ? { kind: "organization" } : { kind: "school", schoolIds: ["s1"] };
  const progress = org ? createElement(OnboardingProgress, { progress: { done: 7, total: 11 } }) : null;
  return renderToStaticMarkup(createElement(AdminOverview, { data: { scope, counts }, items: itemsFor(org) }, progress));
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("AdminOverview (/admin landing)", () => {
  it("links to «راه‌اندازی» exactly once for the organization admin — the setup panel, not a second section row", () => {
    const html = render(true);
    expect(hrefs(html).filter((h) => h === "/admin/onboarding")).toEqual(["/admin/onboarding"]);
    expect(html).toContain("راه‌اندازی مدرسه");
  });

  it("shows a school-scoped admin no «راه‌اندازی» at all", () => {
    const html = render(false);
    expect(hrefs(html)).not.toContain("/admin/onboarding");
    expect(html).not.toContain("راه‌اندازی");
  });

  it("lists every other section once and never «نمای کلی» (this page)", () => {
    const html = render(true);
    // The section list is the last block: everything after the counters panel (`surface-panel`) and the setup panel.
    const rows = hrefs(html.slice(html.indexOf('class="surface-work'))).filter((h) => h.startsWith("/admin/"));
    // Every section the nav carries, in its order, minus «راه‌اندازی» — whatever sections `nav.ts` holds today.
    expect(rows).toEqual(itemsFor(true).filter((i) => i.key !== "onboarding").map((i) => i.href));
    expect(html).not.toContain("نمای کلی");
  });
});
