// Owner (organisation admin, 2026-09-27): «attendance separate for each school … when they tap «مدرسه‌ها» and choose a
// school, add an «حضور و غیاب» item there among that school's other items». The school hub (/admin/schools/[id])
// carries a «حضور و غیاب» row beside «برنامهٴ کلاسی», linking to the admin report filtered to THAT school — for
// whoever may read the report (`can.attendance` ← `academic.attendance.report`). The page is rendered with its one
// read mocked; the report's server-side school filter and scope check are int-tested (tests/int/attendance.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchoolHubData } from "@/lib/admin/school-queries";

const SCHOOL_ID = "0199a000-0001-7000-8000-0000000000aa";
const hub = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/admin/school-queries", () => ({ schoolHubQuery: vi.fn(async () => ({ ok: true, data: hub.data })) }));
vi.mock("@/components/layout/PageHeader", async () => {
  const { createElement: h } = await import("react");
  return { PageHeader: () => h("header", null) };
});
vi.mock("@/components/admin/ResourceForm", () => ({ ResourceForm: () => null }));

const { default: SchoolHubPage } = await import("@/app/(admin)/admin/schools/[id]/page");

const base = (attendance: boolean): SchoolHubData => ({
  school: { id: SCHOOL_ID, name: "دبیرستان نمونه", genderPolicy: null, isDefault: true },
  counts: { classes: 0, students: 0, staff: 0 },
  years: [],
  classes: [],
  focusYear: null,
  offerings: { total: 0, withoutTeacher: 0 },
  staff: null,
  students: null,
  can: { school: false, classes: false, attendance },
  backHref: "/admin/schools",
  backLabelFa: "مدرسه‌ها",
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await SchoolHubPage({ params: Promise.resolve({ id: SCHOOL_ID }) }));
}

beforeEach(() => {
  hub.data = base(true);
});

describe("the school hub's «حضور و غیاب» item", () => {
  it("sits beside «برنامهٴ کلاسی» in the same card, linking to the report filtered to this school", async () => {
    const html = await render();
    const periods = html.indexOf(`href="/admin/schools/${SCHOOL_ID}/periods"`);
    const attendance = html.indexOf(`href="/admin/attendance?school=${SCHOOL_ID}"`);
    expect(periods).toBeGreaterThan(-1);
    expect(attendance).toBeGreaterThan(periods);
    // Same card (one <ul>), same row style: a whole-surface link with the row mark and the end chevron.
    const card = html.slice(html.lastIndexOf("<ul", periods), html.indexOf("</ul>", attendance));
    expect(card.match(/<li>/g)).toHaveLength(2);
    expect(card.match(/class="surface-link pressable/g)).toHaveLength(2);
    expect(card).toContain(">حضور و غیاب</span>");
    expect(card).toContain(">برنامهٴ کلاسی</span>");
  });

  it("is not drawn for someone who may not read the attendance report", async () => {
    hub.data = base(false);
    const html = await render();
    expect(html).toContain(`/admin/schools/${SCHOOL_ID}/periods`);
    expect(html).not.toContain("/admin/attendance");
  });
});
