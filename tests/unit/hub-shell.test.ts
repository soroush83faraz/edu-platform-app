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
const { PageHeader } = await import("@/components/layout/PageHeader");
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

  it("hub: a `hideTitle` header stays visible on phones so the back link shows; classic hides it", async () => {
    expect(await header("classic", { hideTitle: true })).toContain("max-lg:sr-only");
    const hub = await header("hub", { hideTitle: true });
    expect(hub).not.toContain("max-lg:sr-only");
    expect(hub).toContain('href="/home"');
  });
});

describe("classic Home greeting", () => {
  it("the classic phone banner still carries the bell (hub Home draws `HubGreeting` instead — tests/unit/hub-home.test.ts)", () => {
    const html = renderToStaticMarkup(createElement(SchoolBanner, { firstName: "سارا" }));
    expect(html).toContain('href="/notifications"');
    expect(html).toContain("سارا");
  });
});
