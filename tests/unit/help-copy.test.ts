// The public guide's admin answer «ساختار مدرسه و کلاس‌ها را از کجا می‌سازم؟» (src/app/(public)/help/page.tsx) after
// the fixed catalogs (owner, 2026-09-27): سال‌ها، مقطع‌ها and پایه‌ها are ready-made; the admin builds the classes
// (grade picked from the list), the bell schedule and the weekly timetable, and adds students and staff; the درس‌ها
// are the organization admin's, under «مدرسه‌ها ← درس‌ها». The old answer sent admins to «چیپ‌های بالای صفحه» to
// create years, levels and grades — pages that no longer exist (verifier, 2026-09-27).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A signed-out reader sees every section (the page is public); the back link is its own server component.
vi.mock("@/lib/ctx", () => ({ getRequestContext: async () => null }));
vi.mock("@/components/shell/PublicBackLink", () => ({ PublicBackLink: () => null }));

const { default: HelpPage } = await import("@/app/(public)/help/page");

/** The text of one `<QA>` (a `<details id=…>`), tags stripped. */
async function answer(id: string): Promise<string> {
  const html = renderToStaticMarkup(await HelpPage());
  const start = html.indexOf(`<details id="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  const end = html.indexOf("</details>", start);
  return html.slice(start, end).replace(/<[^>]+>/g, " ");
}

describe("help — the admin's «ساختار مدرسه» answer", () => {
  it("says the years, levels and grades are ready-made (grades 1–12 in three levels, this year and next)", async () => {
    const text = await answer("admin-structure");
    expect(text).toContain("پایه‌های اول تا دوازدهم");
    expect(text).toContain("سه مقطع");
    expect(text).toContain("سال تحصیلی جاری و سال بعد");
  });

  it("walks the admin through what IS theirs: classes with a grade from the list, «برنامهٴ کلاسی», the weekly timetable, students and staff; درس‌ها with the organization admin", async () => {
    const text = await answer("admin-structure");
    for (const phrase of ["«کلاس‌ها»", "پایه‌اش را از فهرست", "«برنامهٴ کلاسی»", "«برنامهٴ هفتگی»", "«دانش‌آموزان»", "«کارکنان»", "«مدرسه‌ها ← درس‌ها»", "مدیر سازمان"]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("no longer sends anyone to the removed chips or asks them to create years, levels and grades", async () => {
    const text = await answer("admin-structure");
    expect(text).not.toContain("چیپ");
    expect(text).not.toContain("سال تحصیلی و نوبت‌ها، مقطع و پایه");
  });
});

// The hub layout (everyone's since 2026-09-27, docs/decisions-pending/home-hub.md): no bottom nav, every place a Home
// icon, the profile icon at the top right opens the account, the bell at the top left the notifications.
describe("help — where everything is in the hub layout", () => {
  it("explains the layout: no bottom bar, everything on Home as icons, the profile icon (right) and the bell (left)", async () => {
    const text = await answer("layout");
    for (const phrase of ["نوار پایین", "«خانه»", "آیکون", "سمت راست", "تغییر رمز", "راهنما", "خروج", "زنگوله", "سمت چپ", "«اعلان‌ها»"]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("no answer points at the retired doors: the «بیشتر» menu, the «تکالیف نزدیک» card, «همهٴ تکالیف», «کلاس من», «مدیریت»", async () => {
    const html = renderToStaticMarkup(await HelpPage());
    for (const gone of ["«بیشتر ←", "«تکالیف نزدیک»", "«همهٴ تکالیف»", "«کلاس من»", "«مدیریت»"]) expect(html, gone).not.toContain(gone);
    expect(await answer("timetable")).toContain("«برنامهٴ هفتگی»");
    expect(await answer("student-items")).toContain("«پنل من»");
  });
});
