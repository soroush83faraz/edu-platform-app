import { Suspense } from "react";
import { TwoColumn } from "@/components/layout/TwoColumn";
import type { Ctx } from "@/lib/ctx";
import { audienceOf, emptyOpenCopy } from "@/lib/empty-copy";
import { workItemVoice, workItemWords } from "@/lib/work-item-words";
import { canAtAnyScope } from "@/modules/iam/can";
import { getMyTimetable, resolveHomeTiles } from "../home-data";
import { CardSkeleton } from "../HomeSkeletons";
import { NearbyCard } from "../NearbyCard";
import { DashboardTiles, MyClassesCompact } from "./DashboardTiles";
import { FollowUp } from "./FollowUp";
import { TodaySessions } from "./TodaySessions";
import { WeekProgress } from "./WeekProgress";

/**
 * Home from `lg:` (phones keep the tile grid untouched): a dashboard of the person's OWN work. The board follows
 * the personal hats — teaching first, then the student profile — NOT the nav role: a principal who also teaches
 * gets the teaching board here and the management overview on /admin, because each thing has exactly one home
 * (docs/decisions.md). Every panel streams behind its own skeleton; the reads shared with the phone grid (hats,
 * tiles, timetable) are cached per request in `home-data.ts`.
 *
 * Every board opens the same way (owner, nav round 2026-09-27): the tiles, and UNDER them the «تکالیف نزدیک» /
 * «تسک‌های نزدیک» card, full width of that column — the card's «همهٴ …» link is the کارتابل's one door now that
 * the nav has no «پنل من», so every role that reads work items gets it, on phones (`HomeGrid`) and here alike.
 * That work column is the main one (7 tracks, the start/right side); the role panels sit in the wide aside (5).
 *
 * - Teacher — main: tiles, «تکالیف نزدیک», «نیاز به پیگیری» (the tasks I gave, least complete first, n/m);
 *   aside: «امروز تدریس دارم» (today's sessions across classes), «کلاس‌های من» compact.
 * - Student — main: tiles, «تکالیف نزدیک»; aside: «امروز» (today's زنگ‌ها, the ringing one live), «این هفته»
 *   (done/total of the week's due items). «فوری‌ها» left: it listed the same overdue/today rows the card now
 *   leads with, twice on one screen.
 * - Everyone else, admins included: one column — the tiles, then the card, full width.
 */
export async function HomeDashboard({ ctx }: { ctx: Ctx }) {
  const home = await resolveHomeTiles(ctx);
  const canReadWork = canAtAnyScope(ctx.assignments, "workspace.work_item.read");
  const words = workItemWords(workItemVoice(ctx.assignments));
  const nearby = canReadWork ? (
    <Suspense fallback={<CardSkeleton rows={5} />}>
      <NearbyCard words={words} empty={emptyOpenCopy(audienceOf(ctx.assignments), canAtAnyScope(ctx.assignments, "workspace.work_item.create"))} />
    </Suspense>
  ) : null;

  if (home.isTeacher) {
    return (
      <TwoColumn
        asideWidth="wide"
        main={
          <>
            <DashboardTiles home={home} />
            {nearby}
            <Suspense fallback={<CardSkeleton rows={4} />}>
              <FollowUp />
            </Suspense>
          </>
        }
        aside={
          <>
            <Suspense fallback={<CardSkeleton rows={3} />}>
              <TeacherToday />
            </Suspense>
            <MyClassesCompact offerings={home.hats?.teachingOfferings ?? []} />
          </>
        }
      />
    );
  }

  if (home.isStudent) {
    return (
      <TwoColumn
        asideWidth="wide"
        main={
          <>
            <DashboardTiles home={home} />
            {nearby}
          </>
        }
        aside={
          <>
            <Suspense fallback={<CardSkeleton rows={4} />}>
              <StudentToday />
            </Suspense>
            <Suspense fallback={<CardSkeleton rows={1} />}>
              <WeekProgress />
            </Suspense>
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <DashboardTiles home={home} full />
      {nearby}
    </div>
  );
}

/** The student's today, from the cached personal timetable read. */
async function StudentToday() {
  const tt = await getMyTimetable();
  const student = tt?.student ?? null;
  const sessions = student?.days.find((d) => d.weekday === tt?.today)?.sessions ?? [];
  const hasTimetable = student ? student.days.some((d) => d.sessions.length > 0) : false;
  return <TodaySessions sessions={sessions} today={tt?.today ?? 0} nowMinutes={tt?.nowMinutes ?? 0} secondary="teacher" weekHref="/my-class" hasTimetable={hasTimetable} />;
}

/** «امروز تدریس دارم»: the teacher's sessions across classes today. */
async function TeacherToday() {
  const tt = await getMyTimetable();
  const teacher = tt?.teacher ?? null;
  const sessions = teacher?.days.find((d) => d.weekday === tt?.today)?.sessions ?? [];
  const hasTimetable = (teacher?.sessions ?? 0) > 0;
  return <TodaySessions title="امروز تدریس دارم" sessions={sessions} today={tt?.today ?? 0} nowMinutes={tt?.nowMinutes ?? 0} secondary="class" weekHref="/classes" hasTimetable={hasTimetable} />;
}
