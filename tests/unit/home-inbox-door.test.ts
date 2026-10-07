// The کارتابل's ONE door (owner, nav round 2026-09-27): no «پنل من» nav cell and no tile — it opens from the
// «همهٴ …» link of Home's «تکالیف نزدیک» / «تسک‌های نزدیک» card, which sits UNDER the tiles for every hat that reads
// work items, on phones (`HomeGrid`) and on the desktop dashboard (`HomeDashboard`) alike. The async Server
// Components are called directly and their element trees walked (no DB: the reads are mocked); the card itself is
// rendered to static markup.
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/workspace/queries", () => ({
  homeOpenItemsQuery: vi.fn(async () => ({ ok: true, data: [] })),
  listInboxQuery: vi.fn(async () => ({ ok: true, data: { rows: [] } })),
}));
const resolveHomeTiles = vi.fn();
vi.mock("@/components/home/home-data", () => ({ resolveHomeTiles, getHats: vi.fn(async () => null), getMyTimetable: vi.fn(async () => null), getNearbyItems: vi.fn(async () => []) }));

const { NearbyCard } = await import("@/components/home/NearbyCard");
const { HomeGrid } = await import("@/components/home/HomeGrid");
const { HomeDashboard } = await import("@/components/home/dashboard/HomeDashboard");
const { DashboardTiles } = await import("@/components/home/dashboard/DashboardTiles");
const { TwoColumn } = await import("@/components/layout/TwoColumn");
const { workItemWords } = await import("@/lib/work-item-words");
type Ctx = import("@/lib/ctx").Ctx;

const READ = ["workspace.work_item.read", "workspace.work_item.create"];
const ctxWith = (permissions: string[]) =>
  ({ firstName: "سارا", assignments: [{ roleCode: "x", roleId: "r", scopeType: "school", scopeId: "s", permissions }] }) as unknown as Ctx;

// A generic stand-in tile (the registry no longer has a «new-item» tile — this fixture only exercises the
// grid/dashboard's own layout, never the real HOME_TILES content).
const TILE = { code: "placeholder", labelFa: "نمونه", href: "/placeholder", icon: () => null, role: "everyone" };
function homeFor(hat: "teacher" | "student" | "admin") {
  return { tiles: [TILE], hats: { teachingOfferings: [] }, isTeacher: hat === "teacher", isStudent: hat === "student" };
}

/** Component types in tree order (skeleton fallbacks skipped); host elements are recorded by tag, the `<nav>` included. */
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

beforeEach(() => resolveHomeTiles.mockReset());

describe("the «تکالیف نزدیک» card", () => {
  it("links to the کارتابل with «همهٴ …» in the reader's own word", async () => {
    const empty = { title: "تکلیفی در انتظار شما نیست", description: "—" };
    const assignment = renderToStaticMarkup(await NearbyCard({ words: workItemWords("assignment"), empty }));
    expect(assignment).toMatch(/<a[^>]*href="\/inbox"[^>]*>همهٴ تکالیف/);
    expect(assignment).toContain("تکالیف نزدیک");
    const task = renderToStaticMarkup(await NearbyCard({ words: workItemWords("task"), empty }));
    expect(task).toMatch(/<a[^>]*href="\/inbox"[^>]*>همهٴ تسک‌ها/);
  });
});

describe("Home carries the card under the tiles for every hat", () => {
  it("phones (`HomeGrid`): the tile grid, then the card", async () => {
    for (const hat of ["teacher", "student", "admin"] as const) {
      resolveHomeTiles.mockResolvedValue(homeFor(hat));
      const order = types(await HomeGrid({ ctx: ctxWith(READ) }));
      expect(order.indexOf("nav")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(NearbyCard)).toBeGreaterThan(order.indexOf("nav"));
    }
  });

  it("desktop (`HomeDashboard`): the card sits in the tiles' own column, right under them — teacher, student, admin", async () => {
    for (const hat of ["teacher", "student", "admin"] as const) {
      resolveHomeTiles.mockResolvedValue(homeFor(hat));
      const board = (await HomeDashboard({ ctx: ctxWith(READ) })) as ReactElement<Record<string, ReactNode>>;
      // Teacher and student: a TwoColumn whose MAIN column is the work column; everyone else: one column.
      const work = board.type === TwoColumn ? board.props.main : board.props.children;
      const order = types(work);
      expect(order[0]).toBe(DashboardTiles);
      expect(order.indexOf(NearbyCard)).toBeGreaterThan(0);
      expect(order.filter((t) => t === NearbyCard)).toHaveLength(1);
      if (board.type === TwoColumn) expect(types(board.props.aside)).not.toContain(NearbyCard);
      expect(board.type === TwoColumn).toBe(hat !== "admin");
    }
  });

  it("no work permission, no card (and no dead door)", async () => {
    resolveHomeTiles.mockResolvedValue(homeFor("admin"));
    expect(types(await HomeDashboard({ ctx: ctxWith([]) }))).not.toContain(NearbyCard);
    expect(types(await HomeGrid({ ctx: ctxWith([]) }))).not.toContain(NearbyCard);
  });
});
