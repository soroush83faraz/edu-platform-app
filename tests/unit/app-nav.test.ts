// The THREE nav items per role, in order, from a static server render of `AppNav` (no DOM environment: the markup
// is inspected as a string). Both renderings read role item · خانه · بیشتر (RTL, first = start/right: the role item
// on the right, «خانه» in the middle, «بیشتر» on the left — owner, nav round 2026-09-27). The کارتابل is no nav
// cell: it is reached from Home's «تکالیف نزدیک» card, so the nav carries no unread badge. «اعلان‌ها» stays the
// bell on Home. The role item follows `navRoleFor`; `aria-current` marks the current route on both renderings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { AppNav } = await import("@/components/shell/AppNav");
const { InboxSummaryProvider } = await import("@/components/shell/InboxSummaryProvider");
const { adminSectionsFor } = await import("@/lib/admin/nav");
const { MONOGRAM_PATH } = await import("@/lib/brand/mark");
type AdminNavItem = import("@/lib/admin/nav").AdminNavItem;

function render(role: "admin" | "teacher" | "student" | null, at = "/home", adminItems?: readonly AdminNavItem[], unread = 0) {
  pathname = at;
  const nav = createElement(AppNav, { schoolName: "دبستان", role, hats: role === "admin" ? ["principal"] : [], adminItems });
  const html = renderToStaticMarkup(createElement(InboxSummaryProvider, { initial: { overdue: 0, dueToday: 0, unread, unreadNotifications: 0 } } as Parameters<typeof InboxSummaryProvider>[0], nav));
  const links = [...html.matchAll(/<a([^>]*)href="([^"]+)"([^>]*)>(.*?)<\/a>/g)].map((m) => ({
    href: m[2],
    current: /aria-current="page"/.test(m[1] + m[3]),
    label: m[4].replace(/<[^>]+>/g, "").replace(/[۰-۹]+\+?/g, ""),
  }));
  const bottom = links.slice(0, 3);
  const side = links.slice(3, 6);
  return { html, bottom, side };
}

describe("AppNav items per role", () => {
  it("student: «کلاس من», «خانه», «بیشتر» — the same three on both renderings", () => {
    const { bottom, side } = render("student");
    expect(bottom.map((l) => l.href)).toEqual(["/my-class", "/home", "/more"]);
    expect(bottom.map((l) => l.label)).toEqual(["کلاس من", "خانه", "بیشتر"]);
    expect(side.map((l) => l.href)).toEqual(["/my-class", "/home", "/more"]);
    expect(side.map((l) => l.label)).toEqual(["کلاس من", "خانه", "بیشتر"]);
  });

  it("teacher: «کلاس‌ها»; admin: «مدیریت»; no hat: «راهنما» — always the FIRST (right) cell, «خانه» in the middle", () => {
    for (const [role, href, label] of [
      ["teacher", "/classes", "کلاس‌ها"],
      ["admin", "/admin", "مدیریت"],
      [null, "/help", "راهنما"],
    ] as const) {
      const { bottom, side } = render(role);
      expect(bottom.map((l) => l.href)).toEqual([href, "/home", "/more"]);
      expect(bottom.map((l) => l.label)).toEqual([label, "خانه", "بیشتر"]);
      expect(side.map((l) => l.href)).toEqual([href, "/home", "/more"]);
    }
  });

  it("no «پنل من» on the nav, for any role: the کارتابل is reached from Home's card", () => {
    for (const role of ["admin", "teacher", "student", null] as const) {
      const { html } = render(role);
      expect(html).not.toContain('href="/inbox"');
      expect(html).not.toContain("پنل من");
    }
  });

  it("aria-current follows the route on both renderings, nested routes included", () => {
    const admin = render("admin", "/admin/classes");
    expect(admin.bottom.map((l) => l.current)).toEqual([true, false, false]);
    expect(admin.side.map((l) => l.current)).toEqual([true, false, false]);
    expect(render("student", "/home").bottom.map((l) => l.current)).toEqual([false, true, false]);
    expect(render("teacher", "/classes/abc").side.map((l) => l.current)).toEqual([true, false, false]);
    expect(render("student", "/more").bottom.map((l) => l.current)).toEqual([false, false, true]);
    // The کارتابل is no tab any more: on /inbox no cell is current and the sliding cell fades out.
    for (const at of ["/inbox", "/inbox/new", "/change-password"]) {
      const off = render("teacher", at);
      expect(off.bottom.every((l) => !l.current)).toBe(true);
      expect(off.html).toContain("opacity:0");
    }
  });

  it("«خانه» is a bare, bigger house glyph — 24 px, no clay squircle — in both renderings", () => {
    const { html } = render("teacher");
    expect(html).not.toContain("clay-icon");
    // One `size-6` (24 px) glyph per rendering (bottom bar + rail); every other item stays at `size-5` (20 px).
    expect(html.match(/size-6/g)?.length).toBe(2);
    expect(html).not.toContain("size-7");
    expect(html).toContain("lucide-house");
    expect(html).not.toContain("lucide-layout-grid");
  });

  it("no unread badge on the nav — not even with unread items; «اعلان‌ها» stays off the nav (the bell keeps its badge)", () => {
    const busy = render("student", "/home", undefined, 3);
    expect(busy.html).not.toContain("خوانده‌نشده");
    expect(busy.html).not.toContain("۳");
    expect(busy.html).not.toContain('href="/notifications"');
    expect(busy.html).not.toContain("اعلان‌ها");
    // Three columns, and the sliding cell is a third of the bar; on «خانه» it sits in the middle column.
    expect(busy.html).toContain("grid-cols-3");
    expect(busy.html).toContain("w-1/3");
    expect(busy.html).toMatch(/inset-inline-start:33\.3+\d*%/);
  });

  it("the rail opens with the school line and the role mark — no «دانینو» wordmark or product mark", () => {
    const { html } = render("admin");
    const rail = html.slice(html.indexOf("<aside"));
    expect(rail).toContain("دبستان");
    expect(rail).toContain('role="img"');
    expect(rail).not.toContain("دانینو");
    expect(rail).not.toContain(MONOGRAM_PATH.slice(0, 60));
  });

  it("no cell drifts: the neighbour animation is gone (UX review 2026-09-27)", () => {
    expect(render("student", "/home").html).not.toContain("--nav-drift");
  });
});

describe("AppNav rail inside /admin", () => {
  it("nests the admin sections (minus «نمای کلی») under «مدیریت» with their counts; «مدیریت» itself is current only on the landing", () => {
    // What `adminNavItems` hands the rail: the sections WITHOUT «نمای کلی» — /admin is the parent, not a section.
    const items = adminSectionsFor({ org: false })
      .filter((i) => i.key !== "overview")
      .map((i) => (i.key === "students" ? { ...i, count: 175 } : i));
    const { html } = render("admin", "/admin/students", items);
    // The rail only (the bottom bar's «مدیریت» stays current on every /admin route).
    const parentCurrent = (h: string) => {
      const rail = h.slice(h.indexOf("<aside"));
      return /<a[^>]*href="\/admin"[^>]*aria-current="page"/.test(rail) || /<a[^>]*aria-current="page"[^>]*href="\/admin"/.test(rail);
    };
    expect(parentCurrent(html)).toBe(false);
    expect(html).toContain('href="/admin/staff"');
    expect(html).not.toContain("نمای کلی");
    expect(html).toContain("نقش‌ها</span>");
    // Round 5: the structure sections left the nav — the rail nests people and roles only.
    expect(html).not.toContain('href="/admin/schools"');
    expect(html).not.toContain('href="/admin/years"');
    expect(html).toContain("۱۷۵");
    const nested = [...html.matchAll(/<a[^>]*>/g)].map((m) => m[0]).filter((a) => /aria-current="page"/.test(a)).flatMap((a) => a.match(/href="(\/admin\/[a-z]+)"/)?.[1] ?? []);
    expect(nested).toEqual(["/admin/students"]);
    expect(parentCurrent(render("admin", "/admin", items).html)).toBe(true);
    // Outside /admin the sections stay folded.
    expect(render("admin", "/home", items).html).not.toContain('href="/admin/staff"');
  });
});
