import { Suspense } from "react";
import { Fab } from "@/components/Fab";
import { onboardingProgress } from "@/lib/admin/onboarding";
import { adminOverviewQuery } from "@/lib/admin/overview";
import type { Ctx } from "@/lib/ctx";
import { formatNumberFa } from "@/lib/format";
import { HOME_UPCOMING, homeTilesFor } from "@/lib/modules-registry";
import { canAtAnyScope } from "@/modules/iam/can";
import { hatsQuery } from "@/modules/iam/hats";
import type { Permission } from "@/modules/iam/permissions";
import { AdminGlance } from "./AdminGlance";
import { CardSkeleton } from "./HomeSkeletons";
import { NearbyCard } from "./NearbyCard";
import { Tile } from "./Tile";

/**
 * The grid is the page: live tiles first (only what the nav lacks — ordered by role relevance, staggered 30 ms
 * each), then the muted «به‌زودی» tiles from the product map, then ONE card — admins get «مدرسه در یک نگاه», everyone else «کارهای
 * نزدیک». Resolves the hats once; the admin overview is read only when the person has an admin scope.
 */
export async function HomeGrid({ ctx }: { ctx: Ctx }) {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  const hats = await hatsQuery();
  const isStudent = hats.ok && hats.data.isStudent;
  const isTeacher = hats.ok && hats.data.teachingOfferings.length > 0;
  const isAdmin = hats.ok && hats.data.adminScope !== null;
  const tiles = homeTilesFor({ isStudent, isTeacher, isAdmin }, has);

  // One admin read serves both the onboarding badge and the «مدرسه در یک نگاه» card.
  const counts = isAdmin
    ? await adminOverviewQuery().then((r) => (r.ok ? r.data.counts : null))
    : null;
  const onboarding = counts ? onboardingProgress(counts) : null;

  return (
    <>
      {tiles.length > 0 ? (
        <nav aria-label="بخش‌ها">
          <ul className="reveal-grid grid grid-cols-3 gap-2.5 md:grid-cols-4 lg:grid-cols-6">
            {tiles.map((t) => (
              <Tile
                key={t.code}
                href={t.href}
                label={t.labelFa}
                icon={t.icon}
                mirror={t.mirror}
              >
                {t.badge === "onboarding" &&
                onboarding &&
                onboarding.done < onboarding.total ? (
                  <span
                    className="tabular absolute -top-1.5 -end-2 inline-flex h-5 items-center rounded-full bg-warning px-1.5 text-xs font-semibold leading-none text-primary-900 ring-2 ring-surface"
                    aria-label={`${formatNumberFa(onboarding.done)} از ${formatNumberFa(onboarding.total)} گام انجام شده`}
                  >
                    {formatNumberFa(onboarding.done)}/
                    {formatNumberFa(onboarding.total)}
                  </span>
                ) : null}
              </Tile>
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
        <ul className="grid grid-cols-3 gap-2.5 md:grid-cols-4 lg:grid-cols-6">
          {HOME_UPCOMING.map((m) => (
            <Tile
              key={m.code}
              href={`/roadmap#${m.code}`}
              label={m.labelFa}
              icon={m.icon}
              muted
              tag="به‌زودی"
            />
          ))}
        </ul>
      </section>

      {counts ? (
        <AdminGlance counts={counts} />
      ) : has("workspace.work_item.read") ? (
        <Suspense fallback={<CardSkeleton rows={5} />}>
          <NearbyCard />
        </Suspense>
      ) : null}

      {has("workspace.work_item.create") ? <Fab /> : null}
    </>
  );
}
