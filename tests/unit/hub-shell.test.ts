// The «hub» layout — everyone's since the owner adopted it (docs/decisions-pending/home-hub.md) — against the kept
// «classic» branch, from static server renders inspected as strings. Hub: no nav at all, one top bar — the profile
// icon (→ /more) at the start and the bell at the end, on the content column, no school name — and `PageHeader`
// leads every page back to «خانه» unless the page opts out (Home). Classic (reachable only by editing
// `getUiVariant()`): the nav (bottom bar + rail) and the phone header with the school name, as before.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/ctx";
import type { UiVariant } from "@/lib/ui-variant";

let variant: UiVariant = "hub";
vi.mock("@/lib/ui-variant", () => ({ getUiVariant: async () => variant }));
vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));
vi.mock("@/lib/shell-context", () => ({ getShellContext: async () => ({ schoolName: "دبستان نمونه", yearName: "۱۴۰۵-۱۴۰۶", termName: null, schools: [] }) }));
vi.mock("@/modules/workspace/queries", () => ({ inboxSummaryQuery: async () => ({ ok: true, data: { overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 2 } }) }));

const { AppShell } = await import("@/components/shell/AppShell");
const { PageHeader, pageBack } = await import("@/components/layout/PageHeader");
const { SchoolBanner } = await import("@/components/home/SchoolBanner");
const { ContentWidth } = await import("@/components/layout/ContentWidth");

const ctx = {
  firstName: "سارا",
  lastName: "احمدی",
  orgName: "سازمان نمونه",
  schoolName: "دبستان نمونه",
  assignments: [{ roleCode: "teacher", roleId: "r", scopeType: "class_offering", scopeId: "o", permissions: ["workspace.work_item.read"] }],
} as unknown as Ctx;

async function shell(v: UiVariant) {
  variant = v;
  return renderToStaticMarkup(await AppShell({ ctx, children: createElement("p", null, "محتوا") }));
}

async function header(v: UiVariant, props: Partial<Parameters<typeof PageHeader>[0]> = {}) {
  variant = v;
  return renderToStaticMarkup(await PageHeader({ title: "صفحه", ...props }));
}

/** The markup of the sticky top <header> (the one before <main>). */
const topBar = (html: string) => html.slice(html.indexOf("<header"), html.indexOf("</header>") + 9);

beforeEach(() => {
  variant = "hub"; // what `getUiVariant()` returns for everyone (tests/unit/ui-variant.test.ts)
});

describe("AppShell: classic vs hub", () => {
  it("classic renders the nav (bottom bar + rail) and the phone header with the school name", async () => {
    const html = await shell("classic");
    expect(html).toContain('aria-label="پیمایش اصلی"');
    expect(html).toContain("<aside");
    expect(topBar(html)).toContain("دبستان نمونه");
    expect(topBar(html)).toContain("lg:hidden");
    expect(html).toContain("pb-24");
    expect(html).not.toContain('aria-label="حساب من"');
  });

  it("hub renders no bottom nav and no rail, and reserves no bottom-bar padding", async () => {
    const html = await shell("hub");
    expect(html).not.toContain('aria-label="پیمایش اصلی"');
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("pb-24");
    expect(html).toContain("محتوا");
  });

  it("hub top bar: the profile icon → /more at the start, the bell (with its badge) at the end, on every size", async () => {
    const bar = topBar(await shell("hub"));
    expect(bar).not.toContain("lg:hidden");
    expect(bar).toContain("sticky");
    expect(bar).toContain("safe-area-inset-top");
    const profile = bar.indexOf('href="/more"');
    const bell = bar.indexOf('href="/notifications"');
    expect(profile).toBeGreaterThan(-1);
    expect(bell).toBeGreaterThan(profile); // DOM order = RTL start → end
    expect(bar).toContain('aria-label="حساب من"');
    expect(bar).toContain("surface-panel");
    expect(bar).toContain("lucide-user-round"); // a person glyph, not the first name's initial
    expect(bar).not.toContain(">س<");
    expect(bar).toContain("۲ اعلان خوانده‌نشده");
  });

  it("hub top bar: the controls sit on the content column (1200 px, the page gutters), not the viewport edges", async () => {
    const bar = topBar(await shell("hub"));
    const inner = bar.match(/<div class="([^"]*)"/)?.[1] ?? "";
    for (const cls of ["mx-auto", "w-full", "max-w-content", "px-4", "lg:px-8", "justify-between"]) expect(inner.split(" ")).toContain(cls);
    // Exactly `ContentWidth`'s column: the same cap and the same gutters.
    const content = renderToStaticMarkup(createElement(ContentWidth, null));
    for (const cls of ["mx-auto", "w-full", "max-w-content", "px-4", "lg:px-8"]) expect(content).toContain(cls);
  });

  it("hub has no school-name box: the name is only the sr-only page heading", async () => {
    const html = await shell("hub");
    expect(topBar(html)).not.toContain("دبستان نمونه");
    expect(html.match(/دبستان نمونه/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="sr-only">دبستان نمونه</h1>');
  });

  it("the profile button is the same person icon whatever the name", async () => {
    const html = renderToStaticMarkup(await AppShell({ ctx: { ...ctx, firstName: " " }, children: null }));
    expect(topBar(html)).toContain("lucide-user-round");
  });
});

describe("PageHeader: the default «خانه» back link in hub only", () => {
  it("classic: no back link unless the page gives one", async () => {
    expect(await header("classic")).not.toContain("<a");
    expect(await header("classic", { back: { href: "/inbox", label: "پنل من" } })).toContain('href="/inbox"');
  });

  it("hub: a page without `back` leads to /home as «خانه»", async () => {
    const html = await header("hub");
    expect(html).toMatch(/<a[^>]*href="\/home"/);
    expect(html).toContain("خانه");
  });

  it("hub: an explicit `back` wins; `back={false}` (Home) draws none", async () => {
    const own = await header("hub", { back: { href: "/inbox", label: "پنل من" } });
    expect(own).toContain('href="/inbox"');
    expect(own).not.toContain('href="/home"');
    expect(await header("hub", { back: false })).not.toContain("<a");
    expect(await header("classic", { back: false })).not.toContain("<a");
  });

  it("a `hideTitle` header is visually gone on phones in both layouts — the hub's back pill is in the top bar, not in it", async () => {
    expect(await header("classic", { hideTitle: true })).toContain("max-lg:sr-only");
    const hub = await header("hub", { hideTitle: true });
    expect(hub).toContain("max-lg:sr-only");
    // The pill is outside the (clipped) header, so it still shows.
    expect(hub.slice(0, hub.indexOf("<header"))).toContain('href="/home"');
  });
});

// Owner, 2026-10-06 (docs/mockups/class-page-v3 screen 6): inner pages carry the way back in the TOP BAR's start
// slot — a white pill with an arrow and the destination's name — and the bell + profile sit together at the end;
// Home keeps profile start, bell end. The page declares the target once (`PageHeader` `back`); the pill is a fixed
// layer over the bar's start slot (`TopBarBack`) and the bar reacts to its `data-topbar-back` marker with `:has()`.
describe("top bar «برگشت» (hub)", () => {
  /** The fixed layer `PageHeader` renders before its <header>. */
  const layerOf = (html: string) => html.slice(0, html.indexOf("<header"));

  it("pageBack: hub → always a bar pill (default «خانه» → /home), Home (`false`) none; classic → body link only when given", () => {
    expect(pageBack(undefined, "hub")).toEqual({ href: "/home", label: "خانه", place: "bar" });
    expect(pageBack({ href: "/inbox", label: "پنل من" }, "hub")).toEqual({ href: "/inbox", label: "پنل من", place: "bar" });
    expect(pageBack(false, "hub")).toBeNull();
    expect(pageBack(undefined, "classic")).toBeNull();
    expect(pageBack({ href: "/admin/staff", label: "کارکنان" }, "classic")).toEqual({ href: "/admin/staff", label: "کارکنان", place: "body" });
    expect(pageBack(false, "classic")).toBeNull();
  });

  it("the pill is drawn in a fixed layer over the bar's start slot, never inside the page header", async () => {
    const html = await header("hub", { back: { href: "/admin/classes", label: "کلاس‌ها" } });
    const layer = layerOf(html);
    expect(layer).toContain('data-topbar-back=""');
    const wrap = layer.match(/^<div data-topbar-back="" class="([^"]*)"/)?.[1].split(" ") ?? [];
    for (const c of ["fixed", "inset-x-0", "top-0", "z-20", "pointer-events-none", "pt-[env(safe-area-inset-top)]", "animate-none!", "print:hidden"]) expect(wrap).toContain(c);
    // The same box as the bar's control row (AppShell): the content column, 56 px / 64 px from lg.
    const box = layer.match(/<div class="([^"]*)"/)?.[1] ?? "";
    for (const c of ["mx-auto", "max-w-content", "px-4", "lg:px-8", "h-14", "lg:h-16"]) expect(box).toContain(c);
    // The page body draws no second back link.
    const body = html.slice(html.indexOf("<header"));
    expect(body).not.toContain("<a");
    expect(body).not.toContain("کلاس‌ها");
  });

  it("the pill: a white 44 px pill with shadow-1, an ArrowRight before the destination's name, primary-700 semibold", async () => {
    const layer = layerOf(await header("hub", { back: { href: "/inbox", label: "پنل من" } }));
    const link = layer.match(/<a [^>]*class="([^"]*)"/)?.[1].split(" ") ?? [];
    for (const c of ["bg-surface", "shadow-1", "rounded-full", "min-h-11", "text-primary-700", "font-semibold", "pointer-events-auto", "pressable"]) expect(link).toContain(c);
    expect(layer).toMatch(/<a [^>]*href="\/inbox"/);
    expect(layer).toContain("lucide-arrow-right");
    expect(layer.indexOf("lucide-arrow-right")).toBeLessThan(layer.indexOf("پنل من"));
    // A long name truncates instead of running under the bell and the profile.
    expect(link).toContain("max-w-[calc(100%-7rem)]");
    expect(layer).toContain('<span class="truncate">پنل من</span>');
  });

  it("classic keeps the back link as a row of the page header, and no top-bar layer", async () => {
    const html = await header("classic", { back: { href: "/inbox", label: "پنل من" } });
    expect(html).not.toContain("data-topbar-back");
    expect(html).toMatch(/^<header/);
    expect(html).toContain("[grid-area:back]");
  });

  it("the bar: profile at the start unless a back pill is on the page, then bell + profile together at the end", async () => {
    const html = await shell("hub");
    // The shell column is the `:has()` group: it holds both the bar and <main>, where the page's pill lives.
    expect(html).toMatch(/<div class="group\/shell [^"]*flex-col/);
    const bar = topBar(html);
    const profiles = [...bar.matchAll(/<a [^>]*href="\/more"[^>]*>/g)].map((m) => m[0]);
    expect(profiles).toHaveLength(2);
    const [start, end] = profiles;
    expect(start).toContain("group-has-[[data-topbar-back]]/shell:hidden");
    expect(start).not.toMatch(/class="[^"]*(?<![:\w-])hidden /);
    expect(end).toMatch(/class="[^"]*(?<![:\w-])hidden /);
    expect(end).toContain("group-has-[[data-topbar-back]]/shell:grid");
    // RTL order start → end: [profile (Home)] … [bell][profile (inner pages)], the end pair pushed to the end.
    const bell = bar.indexOf('href="/notifications"');
    expect(bar.indexOf(start)).toBeLessThan(bell);
    expect(bar.indexOf(end)).toBeGreaterThan(bell);
    expect(bar).toMatch(/<div class="ms-auto flex items-center gap-1\.5">/);
  });
});

describe("classic Home greeting", () => {
  it("the classic phone banner still carries the bell (hub Home draws `HubGreeting` instead — tests/unit/hub-home.test.ts)", () => {
    const html = renderToStaticMarkup(createElement(SchoolBanner, { firstName: "سارا" }));
    expect(html).toContain('href="/notifications"');
    expect(html).toContain("سارا");
  });
});
