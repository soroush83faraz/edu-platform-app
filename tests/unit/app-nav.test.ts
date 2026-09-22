// The five nav items per role, in order, from a static server render of `AppNav` (no DOM environment: the markup
// is inspected as a string). Bottom bar (RTL, first = start/right): پنل من · اعلان‌ها · خانه · role item · بیشتر;
// rail: خانه first. The role item follows `navRoleFor`; `aria-current` marks the current route on both renderings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/components/shell/InboxSummaryProvider", () => ({
  useInboxSummaryContext: () => ({ overdue: 0, dueToday: 0, unread: 3, unreadNotifications: 0, stale: false }),
}));

const { AppNav } = await import("@/components/shell/AppNav");

function render(role: "admin" | "teacher" | "student" | null, at = "/home") {
  pathname = at;
  const html = renderToStaticMarkup(createElement(AppNav, { schoolName: "دبستان", role }));
  const links = [...html.matchAll(/<a([^>]*)href="([^"]+)"([^>]*)>(.*?)<\/a>/g)].map((m) => ({
    href: m[2],
    current: /aria-current="page"/.test(m[1] + m[3]),
    label: m[4].replace(/<[^>]+>/g, "").replace(/[۰-۹]+\+?/g, ""),
  }));
  const bottom = links.slice(0, 5);
  const side = links.slice(5, 10);
  return { html, bottom, side };
}

describe("AppNav items per role", () => {
  it("student: «کلاس من» as the role item", () => {
    const { bottom, side } = render("student");
    expect(bottom.map((l) => l.href)).toEqual(["/inbox", "/notifications", "/home", "/my-class", "/more"]);
    expect(bottom.map((l) => l.label)).toEqual(["پنل من", "اعلان‌ها", "خانه", "کلاس من", "بیشتر"]);
    expect(side.map((l) => l.href)).toEqual(["/home", "/inbox", "/notifications", "/my-class", "/more"]);
  });

  it("teacher: «کلاس‌ها»; admin: «مدیریت»; no hat: «راهنما»", () => {
    expect(render("teacher").bottom[3]).toMatchObject({ href: "/classes", label: "کلاس‌ها" });
    expect(render("admin").bottom[3]).toMatchObject({ href: "/admin", label: "مدیریت" });
    expect(render(null).bottom[3]).toMatchObject({ href: "/help", label: "راهنما" });
  });

  it("aria-current follows the route on both renderings, nested routes included", () => {
    const admin = render("admin", "/admin/classes");
    expect(admin.bottom.map((l) => l.current)).toEqual([false, false, false, true, false]);
    expect(admin.side.map((l) => l.current)).toEqual([false, false, false, true, false]);
    const home = render("student", "/home");
    expect(home.bottom.map((l) => l.current)).toEqual([false, false, true, false, false]);
    const off = render("student", "/change-password");
    expect(off.bottom.every((l) => !l.current)).toBe(true);
  });

  it("«خانه» carries the clay mark in both renderings; the unread count shows on «پنل من» twice", () => {
    const { html } = render("teacher");
    expect(html.match(/class="clay-icon/g)?.length).toBe(2);
    expect(html.match(/۳ مورد خوانده‌نشده/g)?.length).toBe(2);
  });
});
