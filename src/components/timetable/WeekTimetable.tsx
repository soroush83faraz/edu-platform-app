"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { currentPeriodOf, formatTimeFa, SCHOOL_WEEKDAYS, WEEKDAY_LABELS, type PeriodLike, type Weekday } from "@/lib/timetable";
import { DayAgenda } from "./DayAgenda";
import { PeriodProgress } from "./PeriodProgress";
import type { DayView, SessionSecondary } from "./types";
import { useLiveClock } from "./useLiveClock";

export interface WeekTimetableProps {
  days: DayView[];
  periods: readonly (PeriodLike & { label: string })[];
  /** The server's Tehran clock at render — the first paint; the client clock takes over after mount. */
  today: Weekday;
  nowMinutes: number;
  secondary: SessionSecondary;
  /** `self` (default) — the viewer's own week; `class` — an admin reading a class's week (empty-day wording). */
  perspective?: "self" | "class";
  className?: string;
}

/** The school day a phone opens on: today, or شنبه when today is not a school day (جمعه). */
function schoolDayOr(day: Weekday): Weekday {
  return SCHOOL_WEEKDAYS.includes(day) ? day : SCHOOL_WEEKDAYS[0]!;
}

/**
 * The one timetable of the product, two faces from one clock. Phones (< md): `DayAgenda` — a six-day strip that
 * fits the width and the chosen day as a vertical list (owner 2026-09-27: the week grid made students scroll
 * sideways). From `md:` the whole week: one column per school day, one row per زنگ with its times in a sticky start
 * column; cells read the subject on line 1 and the teacher (student view) or the class (teacher view) on line 2,
 * today's column is tinted, the ringing cell is `primary-50` with the «الان» dot and the live progress bar. Every
 * occupied cell/row opens its subject page. The chosen day is client state mirrored to `?day=` (shareable, no
 * navigation); «now» comes from `useLiveClock`, so a page left open follows the bell.
 */
export function WeekTimetable({ days, periods, today: serverToday, nowMinutes: serverMinutes, secondary, perspective = "self", className }: WeekTimetableProps) {
  const clock = useLiveClock({ weekday: serverToday, minutes: serverMinutes });
  const today = clock.weekday;
  const { currentPeriodNo } = currentPeriodOf(periods, clock.minutes);
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));
  const ringing = currentPeriodNo !== null && (byDay.get(today) ?? []).some((s) => s.periodNo === currentPeriodNo);

  // null = follow today (also after midnight or a dev `?today=`); a number = the viewer picked a day.
  const [picked, setPicked] = useState<Weekday | null>(null);
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("day");
    if (d === null || !/^[0-5]$/.test(d)) return;
    const id = window.setTimeout(() => setPicked(Number(d) as Weekday), 0);
    return () => window.clearTimeout(id);
  }, []);
  const selected = picked ?? schoolDayOr(today);
  const select = (day: Weekday) => {
    setPicked(day);
    const url = new URL(window.location.href);
    url.searchParams.set("day", String(day));
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className={className}>
      <div className="md:hidden">
        <DayAgenda days={days} periods={periods} today={today} nowMinutes={clock.minutes} selected={selected} onSelect={select} secondary={secondary} perspective={perspective} />
      </div>
      <div className="hidden flex-col gap-2 md:flex">
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
                                    "pressable relative flex min-h-12 flex-col justify-center rounded-md px-1.5 py-1 text-center",
                                    // The ringing cell keeps room at its bottom edge for the progress bar.
                                    now ? "bg-primary-50 pb-2.5 ring-1 ring-primary-600/40" : "bg-surface-sunken hover:bg-primary-50",
                                  )}
                                >
                                  <bdi className={cn("line-clamp-1 text-sm font-medium", now ? "text-primary-900" : "text-text")}>{s.subjectName}</bdi>
                                  <bdi className={cn("line-clamp-1 text-meta", now ? "text-primary-800/80" : "text-text-muted")}>{secondary === "class" ? `کلاس ${s.classGroupName}` : (s.teacherName ?? "بدون دبیر")}</bdi>
                                  {now ? (
                                    <span className="absolute top-1 end-1 inline-flex items-center gap-0.5 text-[0.625rem] leading-none font-semibold text-primary-700">
                                      <span aria-hidden className="size-1.5 rounded-full bg-primary-600" />
                                      الان
                                    </span>
                                  ) : null}
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
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-meta text-text-muted" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-info-soft ring-1 ring-info" />
            امروز
          </span>
          {ringing ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="grid size-3 place-items-center rounded-sm bg-primary-50 ring-1 ring-primary-600/40">
                <span className="size-1.5 rounded-full bg-primary-600" />
              </span>
              الان
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
