// The FOUR nav items per role, in order, from a static server render of `AppNav` (no DOM environment: the markup
// is inspected as a string). Both renderings read خانه · پنل من · role item · بیشتر (RTL, first = start/right —
// UX review 2026-09-27, owner: the کارتابل is a nav destination again, with its unread badge). «اعلان‌ها» stays
// the bell on Home. The role item follows `navRoleFor`; `aria-current` marks the current route on both renderings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { AppNav } = await import("@/components/shell/AppNav");
const { InboxSummaryProvider } = await import("@/components/shell/InboxSummaryProvider");
const { adminSectionsFor } = await import("@/lib/admin/nav");
type AdminNavItem = import("@/lib/admin/nav").AdminNavItem;

function render(role: "admin" | "teacher" | "student" | null, at = "/home", adminItems?: readonly AdminNavItem[], unread = 0) {
  pathname = at;
  const nav = createElement(AppNav, { schoolName: "دبستان", productName: "دانینو", role, adminItems });
  const html = renderToStaticMarkup(createElement(InboxSummaryProvider, { initial: { overdue: 0, dueToday: 0, unread, unreadNotifications: 0 } } as Parameters<typeof InboxSummaryProvider>[0], nav));
  const links = [...html.matchAll(/<a([^>]*)href="([^"]+)"([^>]*)>(.*?)<\/a>/g)].map((m) => ({
    href: m[2],
    current: /aria-current="page"/.test(m[1] + m[3]),
    label: m[4].replace(/<[^>]+>/g, "").replace(/[۰-۹]+\+?/g, ""),
  }));
  const bottom = links.slice(0, 4);
  const side = links.slice(4, 8);
  return { html, bottom, side };
}

describe("AppNav items per role", () => {
  it("student: «خانه», «پنل من», «کلاس من», «بیشتر» — the same four on both renderings", () => {
    const { bottom, side } = render("student");
    expect(bottom.map((l) => l.href)).toEqual(["/home", "/inbox", "/my-class", "/more"]);
    expect(bottom.map((l) => l.label)).toEqual(["خانه", "پنل من", "کلاس من", "بیشتر"]);
    expect(side.map((l) => l.href)).toEqual(["/home", "/inbox", "/my-class", "/more"]);
  });

  it("teacher: «کلاس‌ها»; admin: «مدیریت»; no hat: «راهنما» — always the THIRD cell", () => {
    expect(render("teacher").bottom[2]).toMatchObject({ href: "/classes", label: "کلاس‌ها" });
    expect(render("admin").bottom[2]).toMatchObject({ href: "/admin", label: "مدیریت" });
    expect(render(null).bottom[2]).toMatchObject({ href: "/help", label: "راهنما" });
  });

  it("aria-current follows the route on both renderings, nested routes included", () => {
    const admin = render("admin", "/admin/classes");
    expect(admin.bottom.map((l) => l.current)).toEqual([false, false, true, false]);
    expect(admin.side.map((l) => l.current)).toEqual([false, false, true, false]);
    expect(render("student", "/home").bottom.map((l) => l.current)).toEqual([true, false, false, false]);
    expect(render("teacher", "/inbox/new").bottom.map((l) => l.current)).toEqual([false, true, false, false]);
    const off = render("student", "/change-password");
    expect(off.bottom.every((l) => !l.current)).toBe(true);
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

  it("«پنل من» carries the unread badge on both renderings; nothing is drawn at zero; «اعلان‌ها» stays off the nav", () => {
    const quiet = render("student");
    expect(quiet.html).not.toContain("خوانده‌نشده");
    const busy = render("student", "/home", undefined, 3);
    expect(busy.html.match(/aria-label="۳ مورد خوانده‌نشده"/g)?.length).toBe(2);
    expect(busy.html).not.toContain('href="/notifications"');
    expect(busy.html).not.toContain("اعلان‌ها");
    // Four columns, and the sliding cell is a quarter of the bar.
    expect(quiet.html).toContain("grid-cols-4");
    expect(quiet.html).toContain("w-1/4");
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
