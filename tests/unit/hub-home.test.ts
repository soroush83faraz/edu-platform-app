// Home in the «hub» layout — everyone's since the owner adopted it (2026-09-27, docs/decisions-pending/home-hub.md):
// ONE greeting card (name, Jalali weekday + date, the school as a muted meta line) on every size, then the tiles —
// no «امروز» sentence (TodayStrip), no «تکالیف نزدیک» card («پنل من» is a tile), no second bell, no back link.
// The page and the async Server Components are called directly (the real `getUiVariant()`, so this is the DEFAULT
// Home) and their element trees walked; the reads are mocked.
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({
  firstName: "سارا",
  lastName: "احمدی",
  orgName: "سازمان نمونه",
  schoolName: "دبستان نمونه",
  assignments: [{ roleCode: "x", roleId: "r", scopeType: "school", scopeId: "s", permissions: ["workspace.work_item.read", "workspace.work_item.create"] }],
}));
type Shell = { orgScoped?: boolean; orgName?: string | null; schoolName: string | null; yearName: string | null; termName: string | null; schools: { id: string; name: string }[] };
const shell = vi.hoisted(() => ({ value: { schoolName: "دبستان نمونه", yearName: null, termName: null, schools: [] } as Shell }));
vi.mock("@/lib/ctx", () => ({ requireContext: async () => ctx }));
vi.mock("@/lib/shell-context", () => ({ getShellContext: async () => shell.value }));
vi.mock("@/modules/workspace/queries", () => ({
  homeOpenItemsQuery: vi.fn(async () => ({ ok: true, data: [] })),
  listInboxQuery: vi.fn(async () => ({ ok: true, data: { rows: [] } })),
  inboxSummaryQuery: vi.fn(async () => ({ ok: true, data: { overdue: 2, dueToday: 0, unread: 0, unreadNotifications: 0 } })),
}));
const resolveHomeTiles = vi.hoisted(() => vi.fn());
vi.mock("@/components/home/home-data", () => ({ resolveHomeTiles, getMyTimetable: vi.fn(async () => null), getNearbyItems: vi.fn(async () => []), getMyClass: vi.fn(async () => null) }));

const { default: HomePage } = await import("@/app/(app)/home/page");
const { HubGreeting } = await import("@/components/home/HubGreeting");
const { HomeGrid } = await import("@/components/home/HomeGrid");
const { HomeDashboard } = await import("@/components/home/dashboard/HomeDashboard");
const { DashboardTiles } = await import("@/components/home/dashboard/DashboardTiles");
const { NearbyCard } = await import("@/components/home/NearbyCard");
const { TodayStrip } = await import("@/components/home/TodayStrip");
const { SchoolBanner } = await import("@/components/home/SchoolBanner");
const { NotificationsBell } = await import("@/components/home/NotificationsBell");
const { PageHeader } = await import("@/components/layout/PageHeader");
const { TwoColumn } = await import("@/components/layout/TwoColumn");
const { UpcomingTiles } = await import("@/components/home/UpcomingTiles");
const { HomeCourses } = await import("@/components/home/HomeCourses");
const { formatJalaliWeekdayDate } = await import("@/lib/format");
const { upcomingTilesFor } = await import("@/lib/modules-registry");
type Ctx = import("@/lib/ctx").Ctx;
/** A school-scoped hat (the ctx above) and the organization admin's hat — organization-scoped `iam.admin.access`. */
const schoolHat = ctx.assignments as unknown as Ctx["assignments"];
const orgHat = [{ roleCode: "org_admin", roleId: "r", scopeType: "organization", scopeId: "o", permissions: ["iam.admin.access"] }] as unknown as Ctx["assignments"];

const TILE = { code: "placeholder", labelFa: "نمونه", href: "/placeholder", icon: () => null, role: "everyone" };
const hatsOf = (hat: "teacher" | "student" | "admin") => ({ isStudent: hat === "student", isTeacher: hat === "teacher", isAdmin: hat === "admin" });
const homeFor = (hat: "teacher" | "student" | "admin") => ({
  tiles: [TILE],
  upcoming: upcomingTilesFor(hatsOf(hat)),
  hats: { teachingOfferings: [] },
  isTeacher: hat === "teacher",
  isStudent: hat === "student",
  variant: "hub",
});

/** The elements of one component type in a tree (same walk as `types`). */
function elementsOf(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    for (const n of node) elementsOf(n, type, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, ReactNode>>;
  if (el.type === type) out.push(el as ReactElement<Record<string, unknown>>);
  for (const key of ["main", "aside", "children"]) elementsOf(el.props[key], type, out);
  return out;
}

/** Component types in tree order; host elements by tag. Walks `children`, and TwoColumn's `main` / `aside`. */
function types(node: ReactNode, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const n of node) types(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, ReactNode>>;
  if (el.type !== Fragment) out.push(el.type);
  for (const key of ["main", "aside", "children"]) types(el.props[key], out);
  return out;
}

beforeEach(() => {
  resolveHomeTiles.mockReset();
  shell.value = { schoolName: "دبستان نمونه", yearName: null, termName: null, schools: [] };
});

describe("hub Home (the default)", () => {
  it("opens with the greeting card, then the tiles — no «امروز» sentence, no classic banner or header, no second bell", async () => {
    const page = (await HomePage()) as ReactElement<Record<string, ReactNode>>;
    const order = types(page);
    expect(order.indexOf(HubGreeting)).toBeGreaterThan(-1);
    expect(order.indexOf(HomeGrid)).toBeGreaterThan(order.indexOf(HubGreeting));
    expect(order.indexOf(HomeDashboard)).toBeGreaterThan(order.indexOf(HubGreeting));
    // «درس‌های من» follows the tiles, on every size (owner, 2026-09-27).
    expect(order.indexOf(HomeCourses)).toBeGreaterThan(order.indexOf(HomeGrid));
    expect(order.indexOf(HomeCourses)).toBeGreaterThan(order.indexOf(HomeDashboard));
    for (const gone of [TodayStrip, SchoolBanner, PageHeader, NotificationsBell, NearbyCard]) expect(order).not.toContain(gone);
  });

  it("the tiles stand alone: no «تکالیف نزدیک» card under them, on phones or on the desktop board, for any hat", async () => {
    for (const hat of ["teacher", "student", "admin"] as const) {
      resolveHomeTiles.mockResolvedValue(homeFor(hat));
      const grid = types(await HomeGrid({ ctx: ctx as unknown as Ctx }));
      expect(grid).toContain("nav");
      expect(grid).not.toContain(NearbyCard);
      const board = (await HomeDashboard({ ctx: ctx as unknown as Ctx })) as ReactElement<Record<string, ReactNode>>;
      const all = types(board);
      expect(all).toContain(DashboardTiles);
      expect(all).not.toContain(NearbyCard);
      expect(board.type === TwoColumn).toBe(hat !== "admin"); // the role panels stay beside the tiles
    }
  });
});

describe("the hub greeting card", () => {
  it("one blue brand card: the hero gradient, the hero radius, white text — «سلام، <name>», today's date, the school", async () => {
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه", assignments: schoolHat }));
    const header = html.match(/^<header class="([^"]*)"/)?.[1].split(" ") ?? [];
    for (const c of ["bg-hero", "rounded-hero", "text-white", "overflow-hidden"]) expect(header).toContain(c);
    expect(header).not.toContain("surface-work");
    expect(html).toMatch(/<h2 class="text-title font-bold text-white">سلام، <bdi>سارا<\/bdi><\/h2>/);
    expect(html).toContain(formatJalaliWeekdayDate());
    expect(html).toMatch(/<p class="text-meta text-white"><bdi>دبستان نمونه<\/bdi><\/p>/);
    // Contrast: every text line is PURE white — white/80 (or the muted on-hero tint) falls under 4.5:1 on the
    // gradient's light end (#0B6FD1), where the RTL text sits.
    expect(html).not.toMatch(/text-white\/(?!20)|text-on-hero-muted|text-text-muted/);
    // The decoration: the faint «دانینو» mark in still rings, hidden from assistive tech, white only — no glow.
    expect(html).toMatch(/<div aria-hidden="true" class="pointer-events-none absolute/);
    expect(html).toContain("<circle");
    expect(html).not.toMatch(/glow|blur|drop-shadow|shadow-(?!1)/);
    // Static: not a link, no hover.
    expect(html).not.toContain("<a");
    expect(html).not.toContain("hover:");
  });

  it("an admin over several schools is introduced by the organization, as in the shell", async () => {
    shell.value = { ...shell.value, schoolName: null, schools: [{ id: "a", name: "الف" }, { id: "b", name: "ب" }] };
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه", assignments: schoolHat }));
    expect(html).toContain("<bdi>سازمان نمونه</bdi>");
    expect(html).not.toContain("دبستان نمونه");
  });

  it("the ORGANIZATION admin reads «مدیر سازمان · <organization>» — never the school or branch, even with one school (owner, 2026-09-27)", async () => {
    // One school in the organization: the shell reports the organization scope, no school name.
    shell.value = { orgScoped: true, orgName: "سازمان نمونه", schoolName: null, yearName: "۱۴۰۵-۱۴۰۶", termName: null, schools: [] };
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه — شعبهٴ یک", orgName: "سازمان نمونه", assignments: orgHat }));
    expect(html).toMatch(/<p class="text-meta text-white">مدیر سازمان · <bdi>سازمان نمونه<\/bdi><\/p>/);
    expect(html).not.toContain("دبستان نمونه");
    // The session alone says so too: a failed shell read (empty context) never falls back to the primary school.
    shell.value = { schoolName: null, yearName: null, termName: null, schools: [] };
    const fallback = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه", assignments: orgHat }));
    expect(fallback).toContain("مدیر سازمان · <bdi>سازمان نمونه</bdi>");
    expect(fallback).not.toContain("دبستان نمونه");
  });

  it("an organization admin who also teaches: the organization still wins in the greeting", async () => {
    shell.value = { orgScoped: true, orgName: "سازمان نمونه", schoolName: null, yearName: null, termName: null, schools: [] };
    const teaching = [...orgHat, { roleCode: "teacher", roleId: "t", scopeType: "class_offering", scopeId: "o1", permissions: ["workspace.work_item.read"] }] as unknown as Ctx["assignments"];
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه", assignments: teaching }));
    expect(html).toContain("مدیر سازمان · <bdi>سازمان نمونه</bdi>");
    expect(html).not.toContain("دبستان نمونه");
  });

  it("a principal keeps their school, with no «مدیر سازمان» prefix", async () => {
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه", assignments: schoolHat }));
    expect(html).toMatch(/<p class="text-meta text-white"><bdi>دبستان نمونه<\/bdi><\/p>/);
    expect(html).not.toContain("مدیر سازمان");
    expect(html).not.toContain("سازمان نمونه");
  });

  it("no school on the session falls back to the organization", async () => {
    shell.value = { schoolName: null, yearName: null, termName: null, schools: [] };
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: null, orgName: "سازمان نمونه", assignments: schoolHat }));
    expect(html).toContain("<bdi>سازمان نمونه</bdi>");
  });
});

// Every admin's Home (owner, 2026-09-27: `showUpcomingOnHome`, so `resolveHomeTiles` hands the
// renderers upcoming tiles for admins only — tests/unit/home-courses.test.ts). The renderers draw whatever
// they are handed, after the live tiles, on phones and on the desktop board.
describe("the hub Home's «به‌زودی» section (owner, 2026-09-27; admins only)", () => {
  it("renders after the live tiles on phones and on the desktop board", async () => {
    for (const hat of ["teacher", "student", "admin"] as const) {
      resolveHomeTiles.mockResolvedValue(homeFor(hat));
      const grid = await HomeGrid({ ctx: ctx as unknown as Ctx });
      const order = types(grid);
      expect(order.indexOf(UpcomingTiles)).toBeGreaterThan(order.indexOf("nav"));
      expect(elementsOf(grid, UpcomingTiles)[0]?.props.tiles).toEqual(upcomingTilesFor(hatsOf(hat)));
      const board = DashboardTiles({ home: homeFor(hat) as never });
      expect(elementsOf(board, UpcomingTiles)[0]?.props).toMatchObject({ tiles: upcomingTilesFor(hatsOf(hat)), compact: true });
    }
  });

  it("per role: grey marks, a «به‌زودی» heading and pill — and no link to an unbuilt route", () => {
    for (const hat of ["teacher", "student", "admin"] as const) {
      const tiles = upcomingTilesFor(hatsOf(hat));
      expect(tiles.length).toBeGreaterThan(0);
      const html = renderToStaticMarkup(UpcomingTiles({ tiles, gridClassName: "grid" }));
      expect(html).toContain('<h2 class="text-section font-bold text-text">به‌زودی</h2>');
      for (const t of tiles) expect(html).toContain(`>${t.labelFa}</span>`);
      expect(html.match(/data-shade="grey"/g)).toHaveLength(tiles.length);
      expect(html.match(/aria-disabled="true"/g)).toHaveLength(tiles.length);
      expect(html.match(/<span class="[^"]*text-xs[^"]*">به‌زودی<\/span>/g)).toHaveLength(tiles.length);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("href");
      expect(html).not.toContain("data-shade=\"blue\"");
    }
  });

  it("nothing to show, no section", () => {
    expect(UpcomingTiles({ tiles: [], gridClassName: "grid" })).toBeNull();
  });
});
