// The bell schedule opens READ-ONLY (owner, QA round 5) and only becomes editable on demand. Rendered
// statically and inspected as a string: what matters is that the default state carries no form control at all,
// and that a vice principal — who may read the structure but not write it — is never offered one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PeriodInput } from "@/lib/timetable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {} } }));
// The action pulls in the whole server stack (db, session); the read view never calls it.
vi.mock("@/modules/academic/actions", () => ({ setSchoolPeriodsAction: async () => ({ ok: true, data: { count: 0 } }) }));

const { PeriodsEditor } = await import("@/modules/academic/ui/PeriodsEditor");

const PERIODS: PeriodInput[] = [
  { periodNo: 1, label: "زنگ اول", startsAt: "08:00", endsAt: "08:45" },
  { periodNo: 2, label: "زنگ دوم", startsAt: "08:55", endsAt: "09:40" },
];

const render = (canEdit: boolean, initial: PeriodInput[] = PERIODS) =>
  renderToStaticMarkup(createElement(PeriodsEditor, { schoolId: "11111111-1111-7111-8111-111111111111", initial, canEdit }));

describe("PeriodsEditor (زنگ‌بندی)", () => {
  it("opens read-only for an admin who may edit: the times as text, one «ویرایش» and no input", () => {
    const html = render(true);
    expect(html).not.toContain("<input");
    expect(html).toContain("ویرایش");
    expect(html).toContain("ساعت شروع");
    expect(html).toContain("ساعت پایان");
    // The times are rendered, in Persian digits inside a `<bdi dir="ltr">`.
    expect(html).toContain("۰۸:۰۰");
    expect(html).toContain('dir="ltr"');
    // The edit-only affordances stay out of the read view.
    expect(html).not.toContain("زنگ جدید");
    expect(html).not.toContain("ذخیرهٴ زنگ‌بندی");
    expect(html).not.toContain("انصراف");
  });

  it("a vice principal gets the read view with NO form control and no way into one", () => {
    const html = render(false);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("ویرایش");
    expect(html).toContain("زنگ‌بندی را فقط مدیر مدرسه یا مدیر سازمان تغییر می‌دهد.");
    // The schedule itself is still readable.
    expect(html).toContain("زنگ اول");
    expect(html).toContain("۰۸:۴۵");
  });

  it("a school with no زنگ at all is offered «تعریف زنگ‌بندی», not «ویرایش»", () => {
    const html = render(true, []);
    expect(html).toContain("هنوز زنگی تعریف نشده.");
    expect(html).toContain("تعریف زنگ‌بندی");
  });
});
