import { Suspense } from "react";
import { TwoColumn } from "@/components/layout/TwoColumn";
import type { Ctx } from "@/lib/ctx";
import { canAtAnyScope, navRoleFor } from "@/modules/iam/can";
import { getMyTimetable, resolveHomeTiles } from "../home-data";
import { CardSkeleton } from "../HomeSkeletons";
import { NearbyCard } from "../NearbyCard";
import { Attention } from "./Attention";
import { DashboardAside, MyClassesCompact, OnboardingCard } from "./DashboardAside";
import { FollowUp } from "./FollowUp";
import { FreshComments } from "./FreshComments";
import { StatRow } from "./StatRow";
import { TodaySessions } from "./TodaySessions";
import { UrgentItems } from "./UrgentItems";
import { WeekProgress } from "./WeekProgress";

/**
 * Home from `lg:` (phones keep the tile grid untouched): a `TwoColumn` dashboard per role — the role is the nav's
 * (`navRoleFor`: admin > teacher > student), so a teacher who is also a principal gets the admin board and keeps the
 * teaching tiles in the aside. Every panel streams behind its own skeleton; the reads shared with the phone grid
 * (hats, tiles, admin counts, timetable) are cached per request in `home-data.ts`.
 *
 * - Student — main: «امروز» (today's زنگ‌ها, the ringing one live), «فوری‌ها» (overdue + due today), «این هفته»
 *   (done/total of the week's due items); aside: the tiles (4 columns, 56 px marks), «به‌زودی» compact.
 * - Teacher — main: «نیاز به پیگیری» (the tasks I gave, least complete first, n/m), «امروز تدریس دارم» (today's
 *   sessions across classes), «نظرهای تازه» (unread comment notifications); aside: tiles, «کلاس‌های من» compact.
 * - Admin — main: «نیازمند توجه» (the fixable problems from the overview counts, each row → its fix page) and the
 *   counters as a neutral stat row; aside: tiles, (organization admin) the setup progress.
 * - No hat: the tiles and «کارهای نزدیک».
 */
export async function HomeDashboard({ ctx }: { ctx: Ctx }) {
  const home = await resolveHomeTiles(ctx);
  const role = navRoleFor(ctx.assignments);
  const canReadWork = canAtAnyScope(ctx.assignments, "workspace.work_item.read");

  if (role === "admin" && home.counts) {
    return (
      <TwoColumn
        main={
          <>
            <Attention counts={home.counts} />
            <StatRow counts={home.counts} />
          </>
        }
        aside={<DashboardAside home={home}>{home.onboarding ? <OnboardingCard progress={home.onboarding} /> : null}</DashboardAside>}
      />
    );
  }

  if (role === "teacher") {
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

  if (role === "student") {
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
