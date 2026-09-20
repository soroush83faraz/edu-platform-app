import type { Metadata } from "next";
import { Suspense } from "react";
import { Fab } from "@/components/Fab";
import { AdminSection } from "@/components/home/AdminSection";
import { SectionSkeleton } from "@/components/home/HomeSkeletons";
import { StudentSection } from "@/components/home/StudentSection";
import { TeacherSection } from "@/components/home/TeacherSection";
import { HeroSkeleton, TodayHero } from "@/components/home/TodayHero";
import { InstallPrompt } from "@/components/shell/InstallPrompt";
import { requireContext } from "@/lib/ctx";
import { formatJalaliLong } from "@/lib/format";
import { canAtAnyScope } from "@/modules/iam/can";
import { hatsQuery } from "@/modules/iam/hats";
import type { Permission } from "@/modules/iam/permissions";

export const metadata: Metadata = { title: "خانه | سامانهٴ مدرسه" };

/**
 * Home is summary-first: the greeting and the hero («امروز چه کنم؟») fill the first phone viewport; then one section
 * per hat the person wears (student, teacher, admin — stacked, never a switcher) and Home ends there — the product
 * map lives on /roadmap, reached from «بیشتر». Every section streams in its own <Suspense> with a skeleton of the
 * same shape; `reveal-stagger` lets each block rise in as it lands (greeting, hero, then the sections).
 */
export default async function HomePage() {
  const ctx = await requireContext(); // the (app) layout already redirected anonymous visitors
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);

  return (
    <div className="reveal-stagger flex flex-col gap-7 px-4 pt-5 pb-8 md:pt-8">
      <section className="flex flex-col px-1">
        <h2 className="text-xl font-bold text-text">
          سلام، <bdi>{ctx.firstName}</bdi>
        </h2>
        <p className="text-sm text-text-muted">
          {formatJalaliLong()}
          {ctx.schoolName ? <span className="text-text-faint"> · {ctx.schoolName}</span> : null}
        </p>
      </section>

      {has("workspace.work_item.read") ? (
        <Suspense fallback={<HeroSkeleton />}>
          <TodayHero />
        </Suspense>
      ) : null}

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <RoleSections />
      </Suspense>

      <InstallPrompt />
    </div>
  );
}

/** Resolves the hats, then streams one section per hat (each with its own skeleton). */
async function RoleSections() {
  const hats = await hatsQuery();
  if (!hats.ok) return null;
  const { isStudent, studentClass, teachingOfferings, adminScope } = hats.data;
  return (
    <>
      {isStudent ? (
        <Suspense fallback={<SectionSkeleton rows={5} />}>
          <StudentSection classGroupName={studentClass?.classGroupName ?? null} />
        </Suspense>
      ) : null}
      {teachingOfferings.length > 0 ? (
        <>
          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <TeacherSection offerings={teachingOfferings} />
          </Suspense>
          <Fab />
        </>
      ) : null}
      {adminScope ? (
        <Suspense fallback={<SectionSkeleton rows={2} />}>
          <AdminSection />
        </Suspense>
      ) : null}
    </>
  );
}
