import { Suspense } from "react";
import type { Ctx } from "@/lib/ctx";
import { workItemVoice, workItemWords } from "@/lib/work-item-words";
import { canAtAnyScope } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";
import { resolveHomeTiles } from "./home-data";
import { CardSkeleton } from "./HomeSkeletons";
import { NearbyCard } from "./NearbyCard";
import { Tile } from "./Tile";

/**
 * The grid is the page: the person's live tiles (the role tiles, then the admin's structure tiles), then
 * «تکالیف نزدیک». Nothing «به‌زودی» here — what is coming lives on «بیشتر ← نقشهٴ راه» (UX review 2026-09-27). Every tile is the ONE door to its destination (docs/decisions.md «one home per destination»):
 * the people sections and the counters live on /admin, which the nav itself opens; the structure pages live here.
 */
export async function HomeGrid({ ctx }: { ctx: Ctx }) {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  // Shared with the desktop dashboard (`home-data.ts`, React cache): hats and tiles read once.
  const { tiles } = await resolveHomeTiles(ctx);
  const words = workItemWords(workItemVoice(ctx.assignments));

  return (
    <>
      {tiles.length > 0 ? (
        <nav aria-label="بخش‌ها">
          <ul className="reveal-grid grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {tiles.map((t) => (
              <Tile key={t.code} href={t.href} label={t.labelFa} icon={t.icon} shade={t.shade} mirror={t.mirror} />
            ))}
          </ul>
        </nav>
      ) : null}


      {has("workspace.work_item.read") ? (
        <Suspense fallback={<CardSkeleton rows={5} />}>
          <NearbyCard words={words} />
        </Suspense>
      ) : null}
    </>
  );
}
