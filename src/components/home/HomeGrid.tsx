import { Suspense } from "react";
import type { Ctx } from "@/lib/ctx";
import { audienceOf, emptyOpenCopy } from "@/lib/empty-copy";
import { workItemVoice, workItemWords } from "@/lib/work-item-words";
import { canAtAnyScope } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";
import { resolveHomeTiles } from "./home-data";
import { CardSkeleton } from "./HomeSkeletons";
import { NearbyCard } from "./NearbyCard";
import { Tile } from "./Tile";
import { UpcomingTiles } from "./UpcomingTiles";

const GRID = "reveal-grid grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7";

/**
 * The grid is the page: the person's live tiles (the role tiles, then the admin's structure tiles), then
 * «تکالیف نزدیک», whose «همهٴ …» link opens the کارتابل. Every tile is the ONE door to its destination (docs/decisions.md «one home per destination»):
 * the people sections and the counters live on /admin, which the nav itself opens; the structure pages live here.
 * In the «hub» layout (everyone's now) there is no nav, and `resolveHomeTiles` returns `HUB_TILES` instead — every
 * former nav destination is then a tile (docs/decisions-pending/home-hub-tiles.md) — and no card under them, but the
 * person's grey «به‌زودی» tiles in their own section (`UpcomingTiles`, owner 2026-09-27; never doors).
 */
export async function HomeGrid({ ctx }: { ctx: Ctx }) {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  // Shared with the desktop dashboard (`home-data.ts`, React cache): hats and tiles read once.
  const { tiles, upcoming, variant } = await resolveHomeTiles(ctx);
  const words = workItemWords(workItemVoice(ctx.assignments));

  return (
    <>
      {tiles.length > 0 ? (
        <nav aria-label="بخش‌ها">
          <ul className={GRID}>
            {tiles.map((t) => (
              <Tile key={t.code} href={t.href} label={t.labelFa} icon={t.icon} shade={t.shade} mirror={t.mirror} />
            ))}
          </ul>
        </nav>
      ) : null}

      <UpcomingTiles tiles={upcoming} gridClassName={GRID} />

      {/* Classic only: in the hub layout «پنل من» is a tile and Home is the tiles alone (owner, 2026-09-27). */}
      {variant !== "hub" && has("workspace.work_item.read") ? (
        <Suspense fallback={<CardSkeleton rows={5} />}>
          <NearbyCard words={words} empty={emptyOpenCopy(audienceOf(ctx.assignments), has("workspace.work_item.create"))} />
        </Suspense>
      ) : null}
    </>
  );
}
