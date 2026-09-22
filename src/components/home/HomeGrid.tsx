import { Suspense } from "react";
import type { Ctx } from "@/lib/ctx";
import { HOME_UPCOMING } from "@/lib/modules-registry";
import { canAtAnyScope } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";
import { resolveHomeTiles } from "./home-data";
import { CardSkeleton } from "./HomeSkeletons";
import { NearbyCard } from "./NearbyCard";
import { Tile } from "./Tile";

/**
 * The grid is the page: the person's OWN live tiles first (only what the nav lacks — ordered by role relevance,
 * staggered 30 ms each), then the muted «به‌زودی» tiles from the product map, then «کارهای نزدیک». An admin's
 * single tile here is «مدیریت» — the door to the management hub; the sections and counters live on /admin
 * (docs/decisions.md «one home per destination»).
 */
export async function HomeGrid({ ctx }: { ctx: Ctx }) {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  // Shared with the desktop dashboard (`home-data.ts`, React cache): hats and tiles read once.
  const { tiles } = await resolveHomeTiles(ctx);

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

      <section
        aria-labelledby="upcoming-heading"
        className="flex flex-col gap-2.5"
      >
        <h3
          id="upcoming-heading"
          className="px-1 text-sm font-semibold text-text-muted"
        >
          به‌زودی
        </h3>
        <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
          {HOME_UPCOMING.map((m) => (
            <Tile
              key={m.code}
              href={`/roadmap#${m.code}`}
              label={m.labelFa}
              icon={m.icon}
              muted
            />
          ))}
        </ul>
      </section>

      {has("workspace.work_item.read") ? (
        <Suspense fallback={<CardSkeleton rows={5} />}>
          <NearbyCard />
        </Suspense>
      ) : null}
    </>
  );
}
