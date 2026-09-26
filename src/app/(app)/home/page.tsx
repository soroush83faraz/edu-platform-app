import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeDashboard } from "@/components/home/dashboard/HomeDashboard";
import { HomeGrid } from "@/components/home/HomeGrid";
import { NotificationsBell } from "@/components/home/NotificationsBell";
import { DashboardSkeleton, GridSkeleton } from "@/components/home/HomeSkeletons";
import { SchoolBanner } from "@/components/home/SchoolBanner";
import { TodayStrip } from "@/components/home/TodayStrip";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { InstallPrompt } from "@/components/shell/InstallPrompt";
import { requireContext } from "@/lib/ctx";
import { isStudentOnly, workItemVoice, workItemWords } from "@/lib/work-item-words";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "خانه" };

/**
 * Home is an icon grid (product-owner decision, docs/decisions.md): the flat greeting (phones; from `lg:` the
 * compact `PageHeader` — no gradient block anywhere), the one-sentence «امروز» line (live, from the shell's summary
 * poller), then the person's live tiles and one card under them. From `lg:` the grid gives way to the per-role
 * dashboard (`HomeDashboard`: two columns, the tiles in the aside). Each streams in its own <Suspense> behind a
 * same-shape skeleton; `reveal-stagger` lets them rise in — on the first page view of a session only.
 */
export default async function HomePage() {
  const ctx = await requireContext(); // the (app) layout already redirected anonymous visitors
  return (
    <ContentWidth className="reveal-stagger pt-4 lg:pt-0">
      <PageHeader
        className="hidden lg:grid"
        title={
          <>
            سلام، <bdi>{ctx.firstName}</bdi>
          </>
        }
        // From `lg:` this header IS the greeting row (the banner is hidden), so «اعلان‌ها» — the one door that
        // left the navigation and stayed a control — rides here; the phone banner carries the other rendering.
        // «پنل من» is a TILE in the grid / dashboard aside since round 5, not a control.
        actions={<NotificationsBell />}
      />
      <SchoolBanner firstName={ctx.firstName} />
      {canAtAnyScope(ctx.assignments, "workspace.work_item.read") ? <TodayStrip noun={workItemWords(workItemVoice(ctx.assignments)).singular} student={isStudentOnly(ctx.assignments)} /> : null}
      {/* Phones and tablets: the tile grid, exactly as decided. From lg: the per-role dashboard (the reads are shared). */}
      <div className="flex flex-col gap-5 lg:hidden">
        <Suspense fallback={<GridSkeleton />}>
          <HomeGrid ctx={ctx} />
        </Suspense>
      </div>
      <div className="hidden lg:block">
        <Suspense fallback={<DashboardSkeleton />}>
          <HomeDashboard ctx={ctx} />
        </Suspense>
      </div>
      <InstallPrompt />
    </ContentWidth>
  );
}
