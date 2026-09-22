// The THREE nav items per role, in order, from a static server render of `AppNav` (no DOM environment: the markup
// is inspected as a string). Both renderings read role item · خانه · بیشتر (RTL, first = start/right); «اعلان‌ها»
// left the navigation in QA round 3 and «پنل من» in round 4 — Home's bell and کارتابل glyph are their one door
// each. The role item follows `navRoleFor`; `aria-current` marks the current route on both renderings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { AppNav } = await import("@/components/shell/AppNav");
const { adminSectionsFor } = await import("@/lib/admin/nav");
type AdminNavItem = import("@/lib/admin/nav").AdminNavItem;

function render(role: "admin" | "teacher" | "student" | null, at = "/home", adminItems?: readonly AdminNavItem[]) {
  pathname = at;
  const html = renderToStaticMarkup(createElement(AppNav, { schoolName: "دبستان", productName: "سامانهٴ مدرسه", role, adminItems }));
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
  it("student: «کلاس من» as the role item, «خانه» in the middle, «بیشتر» last", () => {
    const { bottom, side } = render("student");
    expect(bottom.map((l) => l.href)).toEqual(["/my-class", "/home", "/more"]);
    expect(bottom.map((l) => l.label)).toEqual(["کلاس من", "خانه", "بیشتر"]);
    expect(side.map((l) => l.href)).toEqual(["/my-class", "/home", "/more"]);
  });

  it("teacher: «کلاس‌ها»; admin: «مدیریت»; no hat: «راهنما» — always the FIRST cell", () => {
    expect(render("teacher").bottom[0]).toMatchObject({ href: "/classes", label: "کلاس‌ها" });
    expect(render("admin").bottom[0]).toMatchObject({ href: "/admin", label: "مدیریت" });
    expect(render(null).bottom[0]).toMatchObject({ href: "/help", label: "راهنما" });
  });

  it("aria-current follows the route on both renderings, nested routes included", () => {
    const admin = render("admin", "/admin/classes");
    expect(admin.bottom.map((l) => l.current)).toEqual([true, false, false]);
    expect(admin.side.map((l) => l.current)).toEqual([true, false, false]);
    const home = render("student", "/home");
    expect(home.bottom.map((l) => l.current)).toEqual([false, true, false]);
    const off = render("student", "/change-password");
    expect(off.bottom.every((l) => !l.current)).toBe(true);
  });

  it("«خانه» is a bare, bigger glyph — 24 px, no clay squircle — in both renderings", () => {
    const { html } = render("teacher");
    expect(html).not.toContain("clay-icon");
    // One `size-6` (24 px) glyph per rendering (bottom bar + rail); every other item stays at `size-5` (20 px).
    expect(html.match(/size-6/g)?.length).toBe(2);
    expect(html).not.toContain("size-7");
  });

  it("the nav carries no work surface and no badge: «پنل من» and «اعلان‌ها» live on Home", () => {
    for (const at of ["/home", "/inbox", "/notifications"]) {
      const { html, bottom, side } = render("student", at);
      expect(html).not.toContain('href="/inbox"');
      expect(html).not.toContain('href="/notifications"');
      expect(html).not.toContain("پنل من");
      expect(html).not.toContain("اعلان‌ها");
      expect(html).not.toContain("خوانده‌نشده");
      expect(bottom).toHaveLength(3);
      expect(side).toHaveLength(3);
    }
    // Three columns, and the sliding cell is a third of the bar.
    expect(render("student").html).toContain("grid-cols-3");
    expect(render("student").html).toContain("w-1/3");
  });

  it("the two neighbours ease away from «خانه» only while Home is the current tab", () => {
    const onHome = render("student", "/home").html;
    expect([...onHome.matchAll(/--nav-drift:\s*(-?\d+px)/g)].map((m) => m[1])).toEqual(["-4px", "0px", "4px"]);
    const elsewhere = render("student", "/my-class").html;
    expect([...elsewhere.matchAll(/--nav-drift:\s*(-?\d+px)/g)].map((m) => m[1])).toEqual(["0px", "0px", "0px"]);
  });
});

describe("AppNav rail inside /admin", () => {
  it("nests the admin sections (minus «نمای کلی») under «مدیریت» with their counts; «مدیریت» itself is current only on the landing", () => {
    // What `adminNavItems` hands the rail: the sections WITHOUT «نمای کلی» — /admin is the parent, not a section.
    const items = adminSectionsFor({ org: false, singleSchool: true })
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
    expect(html).toContain("مدرسه</span>");
    expect(html).toContain("۱۷۵");
    const nested = [...html.matchAll(/<a[^>]*>/g)].map((m) => m[0]).filter((a) => /aria-current="page"/.test(a)).flatMap((a) => a.match(/href="(\/admin\/[a-z]+)"/)?.[1] ?? []);
    expect(nested).toEqual(["/admin/students"]);
    expect(parentCurrent(render("admin", "/admin", items).html)).toBe(true);
    // Outside /admin the sections stay folded.
    expect(render("admin", "/home", items).html).not.toContain('href="/admin/staff"');
  });
});
