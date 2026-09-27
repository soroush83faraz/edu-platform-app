"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { subjectHueClasses } from "@/components/SubjectStamp";
import type { TimetablePerspective } from "@/lib/empty-copy";
import { currentPeriodOf, formatTimeFa, SCHOOL_WEEKDAYS, WEEKDAY_LABELS, type PeriodLike, type Weekday } from "@/lib/timetable";
import { PeriodProgress } from "./PeriodProgress";
import type { DayView, SessionSecondary } from "./types";
import { useLiveClock } from "./useLiveClock";
import { WeekGrid } from "./WeekGrid";

export interface WeekTimetableProps {
  days: DayView[];
  periods: readonly (PeriodLike & { label: string })[];
  /** The server's Tehran clock at render — the first paint; the client clock takes over after mount. */
  today: Weekday;
  nowMinutes: number;
  secondary: SessionSecondary;
  /** Whose week (the empty-day wording, `emptyDayCopy`): a student's own («تو»), a دبیر's own («شما»), or a class's. */
  perspective: TimetablePerspective;
  /** Day of the month of شنبه … جمعه this week (`schoolWeekOf`), under the phone grid's day names. */
  weekDays?: readonly string[];
  /** `schoolWeekOf(...).comingWeek`: on جمعه the dates are next week's, so the phone grid marks no column as today. */
  comingWeek?: boolean;
  className?: string;
}

/**
 * The one timetable of the product, two faces from one clock. Phones (< md): `WeekGrid` — the week as a calendar
 * grid (شنبه … جمعه × زنگ‌ها, جمعه a tinted holiday column) of cells in their «مُهر درس» hue, each reading the درس name, that fits 360 px, with a details card for the tapped cell (owner
 * 2026-09-27: the day strip + list did not read at a glance). From `md:` the whole week as a table: one column per
 * school day, one row per زنگ with its times in a sticky start column; each lesson wears its درس's stamp hue and
 * reads the subject on line 1 and the teacher (student view) or the class (teacher view) on line 2, today's column
 * is tinted, the ringing cell carries the brand ring and the live progress bar (no legend under it, owner 2026-09-27). Every lesson opens
 * its subject page. «now» comes from `useLiveClock`, so a page left open follows the bell.
 */
export function WeekTimetable({ days, periods, today: serverToday, nowMinutes: serverMinutes, secondary, perspective, weekDays, comingWeek, className }: WeekTimetableProps) {
  const clock = useLiveClock({ weekday: serverToday, minutes: serverMinutes });
  const today = clock.weekday;
  const { currentPeriodNo } = currentPeriodOf(periods, clock.minutes);
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));

  return (
    <div className={className}>
      <div className="md:hidden">
        <WeekGrid days={days} periods={periods} today={today} nowMinutes={clock.minutes} secondary={secondary} perspective={perspective} weekDays={weekDays} comingWeek={comingWeek} />
      </div>
      <div className="hidden md:block">
        <div className="surface-work overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[38rem] border-separate border-spacing-0 text-meta">
            <thead>
              <tr>
                <th scope="col" className="sticky start-0 z-10 w-24 bg-surface px-2 py-2 text-start font-medium text-text-faint">
                  زنگ
                </th>
                {SCHOOL_WEEKDAYS.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    data-today={d === today ? "" : undefined}
                    className={cn("min-w-22 px-1 py-2 text-center font-semibold", d === today ? "rounded-t-lg bg-info-soft text-primary-800" : "text-text-muted")}
                  >
                    {WEEKDAY_LABELS[d]}
                    {d === today ? <span className="sr-only"> (امروز)</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={p.periodNo}>
                  <th scope="row" className={cn("sticky start-0 z-10 bg-surface px-2 py-1.5 text-start font-normal", i > 0 && "border-t border-line/70")}>
                    <span className="block text-text">{p.label}</span>
                    <bdi dir="ltr" className="tabular block text-meta whitespace-nowrap text-text-faint">
                      {formatTimeFa(p.startsAt)}–{formatTimeFa(p.endsAt)}
                    </bdi>
                  </th>
                  {SCHOOL_WEEKDAYS.map((d) => {
                    const cellSessions = (byDay.get(d) ?? []).filter((s) => s.periodNo === p.periodNo);
                    const now = d === today && p.periodNo === currentPeriodNo;
                    return (
                      <td key={d} className={cn("h-14 px-0.5 py-1 align-top", i > 0 && "border-t border-line/70", d === today && "bg-info-soft/60")}>
                        {cellSessions.length === 0 ? null : (
                          <ul className="flex flex-col gap-0.5">
                            {cellSessions.map((s) => (
                              <li key={s.offeringId}>
                                <Link
                                  href={`/subjects/${s.offeringId}`}
                                  aria-current={now ? "true" : undefined}
                                  className={cn(
                                    "pressable relative flex min-h-12 flex-col justify-center rounded-md px-1.5 py-1 text-center ring-1 ring-inset",
                                    // The درس's stamp hue (as on the phone grid); the ringing cell adds the brand ring and keeps room
                                    // at its bottom edge for the progress bar.
                                    subjectHueClasses(s.subjectId),
                                    now && "pb-2.5 ring-2 ring-primary-600",
                                  )}
                                >
                                  <bdi className="line-clamp-1 text-sm font-semibold">{s.subjectName}</bdi>
                                  <bdi className="line-clamp-1 text-meta opacity-80">{secondary === "class" ? `کلاس ${s.classGroupName}` : (s.teacherName ?? "بدون دبیر")}</bdi>
                                  {now ? <span className="sr-only"> (الان)</span> : null}
                                  {now ? <PeriodProgress startsAt={p.startsAt} endsAt={p.endsAt} nowMinutes={clock.minutes} className="inset-x-1.5 bottom-1" /> : null}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
