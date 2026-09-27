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
type Shell = { schoolName: string | null; yearName: string | null; termName: string | null; schools: { id: string; name: string }[] };
const shell = vi.hoisted(() => ({ value: { schoolName: "دبستان نمونه", yearName: null, termName: null, schools: [] } as Shell }));
vi.mock("@/lib/ctx", () => ({ requireContext: async () => ctx }));
vi.mock("@/lib/shell-context", () => ({ getShellContext: async () => shell.value }));
vi.mock("@/modules/workspace/queries", () => ({
  homeOpenItemsQuery: vi.fn(async () => ({ ok: true, data: [] })),
  listInboxQuery: vi.fn(async () => ({ ok: true, data: { rows: [] } })),
  inboxSummaryQuery: vi.fn(async () => ({ ok: true, data: { overdue: 2, dueToday: 0, unread: 0, unreadNotifications: 0 } })),
}));
const resolveHomeTiles = vi.hoisted(() => vi.fn());
vi.mock("@/components/home/home-data", () => ({ resolveHomeTiles, getMyTimetable: vi.fn(async () => null), getNearbyItems: vi.fn(async () => []) }));

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
const { formatJalaliWeekdayDate } = await import("@/lib/format");
type Ctx = import("@/lib/ctx").Ctx;

const TILE = { code: "placeholder", labelFa: "نمونه", href: "/placeholder", icon: () => null, role: "everyone" };
const homeFor = (hat: "teacher" | "student" | "admin") => ({ tiles: [TILE], hats: { teachingOfferings: [] }, isTeacher: hat === "teacher", isStudent: hat === "student", variant: "hub" });

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
  it("one white card: «سلام، <name>», today's weekday and date, and the school as a muted meta line", async () => {
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه" }));
    expect(html.match(/^<header class="([^"]*)"/)?.[1].split(" ")).toContain("surface-work");
    expect(html).toContain("سلام، <bdi>سارا</bdi>");
    expect(html).toContain(formatJalaliWeekdayDate());
    expect(html).toMatch(/<p class="text-meta text-text-muted"><bdi>دبستان نمونه<\/bdi><\/p>/);
    // Static: not a link, no hover.
    expect(html).not.toContain("<a");
    expect(html).not.toContain("hover:");
  });

  it("an admin over several schools is introduced by the organization, as in the shell", async () => {
    shell.value = { ...shell.value, schoolName: null, schools: [{ id: "a", name: "الف" }, { id: "b", name: "ب" }] };
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: "دبستان نمونه", orgName: "سازمان نمونه" }));
    expect(html).toContain("<bdi>سازمان نمونه</bdi>");
    expect(html).not.toContain("دبستان نمونه");
  });

  it("no school on the session falls back to the organization", async () => {
    const html = renderToStaticMarkup(await HubGreeting({ firstName: "سارا", schoolName: null, orgName: "سازمان نمونه" }));
    expect(html).toContain("<bdi>سازمان نمونه</bdi>");
  });
});
