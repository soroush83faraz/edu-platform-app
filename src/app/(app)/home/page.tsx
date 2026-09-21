import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeGrid } from "@/components/home/HomeGrid";
import { GridSkeleton } from "@/components/home/HomeSkeletons";
import { SchoolBanner } from "@/components/home/SchoolBanner";
import { TodayStrip } from "@/components/home/TodayStrip";
import { InstallPrompt } from "@/components/shell/InstallPrompt";
import { requireContext } from "@/lib/ctx";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "خانه | سامانهٴ مدرسه" };

/**
 * Home is an icon grid (product-owner decision, docs/decisions.md): the school banner, the one-line «امروز» strip
 * (live, from the shell's summary poller), then the tiles — live ones by role, muted «به‌زودی» ones from the
 * product map — and one card under them. The grid streams in its own <Suspense> behind a same-shape skeleton;
 * `reveal-stagger` lets banner, strip and grid rise in as they land.
 */
export default async function HomePage() {
  const ctx = await requireContext(); // the (app) layout already redirected anonymous visitors
  return (
    <div className="reveal-stagger flex flex-col gap-5 px-4 pt-4 pb-8 md:pt-8">
      <SchoolBanner schoolName={ctx.schoolName ?? ctx.orgName} firstName={ctx.firstName} />
      {canAtAnyScope(ctx.assignments, "workspace.work_item.read") ? <TodayStrip /> : null}
      <Suspense fallback={<GridSkeleton />}>
        <HomeGrid ctx={ctx} />
      </Suspense>
      <InstallPrompt />
    </div>
  );
}
