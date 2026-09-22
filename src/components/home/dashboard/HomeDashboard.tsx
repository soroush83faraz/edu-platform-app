import { Suspense } from "react";
import { TwoColumn } from "@/components/layout/TwoColumn";
import type { Ctx } from "@/lib/ctx";
import { canAtAnyScope } from "@/modules/iam/can";
import { getMyTimetable, resolveHomeTiles } from "../home-data";
import { CardSkeleton } from "../HomeSkeletons";
import { NearbyCard } from "../NearbyCard";
import { DashboardAside, MyClassesCompact } from "./DashboardAside";
import { FollowUp } from "./FollowUp";
import { FreshComments } from "./FreshComments";
import { TodaySessions } from "./TodaySessions";
import { UrgentItems } from "./UrgentItems";
import { WeekProgress } from "./WeekProgress";

/**
 * Home from `lg:` (phones keep the tile grid untouched): a `TwoColumn` dashboard of the person's OWN work. The
 * board follows the personal hats — teaching first, then the student profile — NOT the nav role: a principal who
 * also teaches gets the teaching board here and the management overview on /admin, because each thing has exactly
 * one home (docs/decisions.md). Every panel streams behind its own skeleton; the reads shared with the phone grid
 * (hats, tiles, timetable) are cached per request in `home-data.ts`.
 *
 * - Teacher — main: «نیاز به پیگیری» (the tasks I gave, least complete first, n/m), «امروز تدریس دارم» (today's
 *   sessions across classes), «نظرهای تازه» (unread comment notifications); aside: tiles, «کلاس‌های من» compact.
 * - Student — main: «امروز» (today's زنگ‌ها, the ringing one live), «فوری‌ها» (overdue + due today), «این هفته»
 *   (done/total of the week's due items); aside: the tiles (4 columns, 56 px marks), «به‌زودی» compact.
 * - Everyone else, admins included: «کارهای نزدیک» and the tiles — the «مدیریت» tile opens the hub.
 */
export async function HomeDashboard({ ctx }: { ctx: Ctx }) {
  const home = await resolveHomeTiles(ctx);
  const canReadWork = canAtAnyScope(ctx.assignments, "workspace.work_item.read");

  if (home.isTeacher) {
    return (
      <TwoColumn
        main={
          <>
            <Suspense fallback={<CardSkeleton rows={4} />}>
              <FollowUp />
            </Suspense>
            <Suspense fallback={<CardSkeleton rows={3} />}>
              <TeacherToday />
            </Suspense>
            <Suspense fallback={<CardSkeleton rows={3} />}>
              <FreshComments />
            </Suspense>
          </>
        }
        aside={
          <DashboardAside home={home}>
            <MyClassesCompact offerings={home.hats?.teachingOfferings ?? []} />
          </DashboardAside>
        }
      />
    );
  }

  if (home.isStudent) {
    return (
      <TwoColumn
        main={
          <>
            <Suspense fallback={<CardSkeleton rows={4} />}>
              <StudentToday />
            </Suspense>
            <Suspense fallback={<CardSkeleton rows={3} />}>
              <UrgentItems />
            </Suspense>
            <Suspense fallback={<CardSkeleton rows={1} />}>
              <WeekProgress />
            </Suspense>
          </>
        }
        aside={<DashboardAside home={home} />}
      />
    );
  }

  return (
    <TwoColumn
      main={
        canReadWork ? (
          <Suspense fallback={<CardSkeleton rows={5} />}>
            <NearbyCard />
          </Suspense>
        ) : null
      }
      aside={<DashboardAside home={home} />}
    />
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
