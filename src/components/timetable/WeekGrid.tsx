"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/Chip";
import { SubjectIcon, subjectHueClasses } from "@/components/SubjectStamp";
import { CrossFade } from "@/components/motion/CrossFade";
import { emptyDayCopy, type TimetablePerspective } from "@/lib/empty-copy";
import { formatNumberFa } from "@/lib/format";
import { cellSubjectLabel } from "@/lib/subject-stamp";
import { CALENDAR_WEEKDAYS, currentPeriodOf, defaultWeekCell, formatTimeRangeFa, FRIDAY, timeToMinutes, WEEKDAY_LABELS, weekRows, type PeriodLike, type WeekCell, type Weekday } from "@/lib/timetable";
import { PeriodProgress } from "./PeriodProgress";
import type { DayView, SessionSecondary } from "./types";

export interface WeekGridProps {
  days: DayView[];
  periods: readonly (PeriodLike & { label: string })[];
  /** The live Tehran clock (weekday + fractional minutes). */
  today: Weekday;
  nowMinutes: number;
  secondary: SessionSecondary;
  /** Whose week, for the empty-day line of the details card (`emptyDayCopy`). */
  perspective: TimetablePerspective;
  /** Day of the month of شنبه … جمعه (Persian digits), drawn under each column's name; omitted for a template week. */
  weekDays?: readonly string[];
  /** The dates are the week that starts tomorrow (`schoolWeekOf` on جمعه): no column is today while it is still جمعه. */
  comingWeek?: boolean;
}

/**
 * The phone face of the timetable (< md), drawn like a calendar month (owner 2026-09-27): seven EQUAL columns
 * شنبه … جمعه (the FULL day name, the day of the month under it, today filled in the brand blue) and one row per
 * زنگ with its number in a narrow start column — the whole week at once, no sideways scroll at 360 px. جمعه is a
 * day like any other in width, header style and cell style — it never reads as an add-on (owner 2026-09-27,
 * follow-up: "Friday should be there, but empty, not squeezed in the corner"); when the school has no lessons on
 * جمعه its cells are plain EMPTY cells (the same faint outline as a free period on any other day) and tapping one
 * still reads «جمعه تعطیل است.» in the details card. A school with جمعه lessons renders them like any other day's,
 * unchanged. Each lesson is a rounded square in its درس's «مُهر درس» hue with the درس's NAME on one or two lines
 * (`cellSubjectLabel`, owner 2026-09-27: not the stamp's letters; a دبیر's cell adds the class under it); a زنگ
 * تفریح is a wider gap between two rows. The ringing cell wears the brand ring and the live progress bar; today's
 * finished cells dim. Tapping a cell selects it (ink ring) and the card under the grid reads it in full — the
 * درس (beside its `SubjectIcon`), the دبیر or the class, the day, the زنگ, the time — and opens the درس page.
 *
 * Width at 360 px (measured in Vazirmatn): 328 px content − 2 × 4 px padding = 320 px; a 16 px start column and
 * 7 gaps × 3 px leave 283 px for 7 equal columns → 40.4 px each (42.8 at 375). The names are `text-cell` (11 px,
 * 600) on one line: the widest, «چهارشنبه» (41.1 px), overhangs 0.7 px into the 3 px gap — no clipping. Cells are
 * 56 px tall (≥ 44 px targets) with no side padding; a lesson name line keeps its seven-letter budget
 * (`cellSubjectLabel`, unchanged — already computed for a ~40 px column, widest kept lines «هدیه‌های» 41.6,
 * «آزمایشگاه» 41.5, «جغرافیای» 40.1 px).
 */
export function WeekGrid({ days, periods, today, nowMinutes, secondary, perspective, weekDays, comingWeek = false }: WeekGridProps) {
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));
  const all = days.flatMap((d) => d.sessions);
  const rows = weekRows(periods, all);
  const { currentPeriodNo } = currentPeriodOf(rows, nowMinutes);
  const [picked, setPicked] = useState<WeekCell | null>(null);
  const pick = picked ?? defaultWeekCell(days, rows, today, nowMinutes);
  // The column that is today — none on the جمعه that shows the coming week.
  const liveDay: Weekday | null = comingWeek && today === FRIDAY ? null : today;
  // جمعه is a holiday unless the school's week has lessons on it.
  const fridayOff = (byDay.get(FRIDAY) ?? []).length === 0;
  const isHoliday = (d: Weekday) => d === FRIDAY && fridayOff;

  const cellSessions = (d: Weekday, periodNo: number) => (byDay.get(d) ?? []).filter((s) => s.periodNo === periodNo);
  // «بعدی»: today's first session that has not started yet.
  const nextToday =
    liveDay === null ? null : (rows.find((r) => timeToMinutes(r.startsAt) > nowMinutes && cellSessions(liveDay, r.periodNo).length > 0)?.periodNo ?? null);

  const pickedRow = pick ? rows.find((r) => r.periodNo === pick.periodNo) : undefined;
  const pickedSessions = pick ? cellSessions(pick.weekday, pick.periodNo) : [];
  const pickedIsNow = pick !== null && pick.weekday === liveDay && pick.periodNo === currentPeriodNo;
  const pickedIsNext = pick !== null && pick.weekday === liveDay && pick.periodNo === nextToday;
  const pickedHoliday = pick !== null && isHoliday(pick.weekday);

  return (
    <div className="surface-work flex flex-col p-1">
      <div role="group" aria-label="برنامهٴ هفتگی" className="grid grid-cols-[1rem_repeat(7,minmax(0,1fr))] gap-0.75">
        {/* The headers are for the eye; every cell button speaks its own day and زنگ. جمعه reads like any other day. */}
        <div aria-hidden className="contents">
          <span />
          {CALENDAR_WEEKDAYS.map((d, i) => {
            const isToday = d === liveDay;
            return (
              <span
                key={d}
                className={cn(
                  "flex h-12 min-w-0 flex-col items-center justify-center rounded-stamp-lg",
                  isToday ? "bg-primary-600 text-white" : "text-text",
                )}
              >
                <span className="text-cell font-semibold whitespace-nowrap">{WEEKDAY_LABELS[d]}</span>
                {weekDays?.[i] ? (
                  <span className={cn("tabular text-meta leading-4", isToday ? "text-white/80" : "text-text-faint")}>{weekDays[i]}</span>
                ) : null}
              </span>
            );
          })}
        </div>

        {rows.map((r) => (
          <div key={r.periodNo} className="contents">
            {r.afterBreak ? <span aria-hidden className="col-span-8 h-1" /> : null}
            <span aria-hidden className="tabular grid place-items-center text-row font-semibold text-text-muted">
              {formatNumberFa(r.periodNo)}
            </span>
            {CALENDAR_WEEKDAYS.map((d) => {
              const selected = pick?.weekday === d && pick.periodNo === r.periodNo;
              const holiday = isHoliday(d);
              const here = cellSessions(d, r.periodNo);
              const s = here[0];
              const isNow = d === liveDay && r.periodNo === currentPeriodNo;
              const past = d === liveDay && timeToMinutes(r.endsAt) <= nowMinutes;
              const names = here.map((x) => x.subjectName).join("، ");
              return (
                <button
                  key={d}
                  type="button"
                  data-holiday={holiday ? "" : undefined}
                  aria-pressed={selected}
                  aria-current={isNow && s ? "time" : undefined}
                  aria-label={`${WEEKDAY_LABELS[d]}${d === liveDay ? " (امروز)" : ""}، ${r.label}، ${holiday ? "تعطیل" : s ? names : "آزاد"}`}
                  onClick={() => setPicked({ weekday: d, periodNo: r.periodNo })}
                  className={cn(
                    "pressable relative flex h-14 min-w-0 flex-col items-center justify-center overflow-hidden rounded-stamp-lg text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    s ? cn(subjectHueClasses(s.subjectId), "ring-1 ring-inset") : "ring-1 ring-inset ring-line/70",
                    s && past && !selected && "opacity-60",
                    selected && (s ? "shadow-1 ring-2 ring-current" : "ring-2 ring-text-faint"),
                    isNow && "ring-2 ring-primary-600",
                  )}
                >
                  {s ? (
                    <>
                      {cellSubjectLabel(s.subjectName).map((line, i) => (
                        <span key={i} className="block max-w-full truncate text-cell font-semibold">
                          {line}
                        </span>
                      ))}
                      {secondary === "class" ? (
                        <bdi className="block max-w-full truncate text-cell opacity-80">{here.length > 1 ? `${formatNumberFa(here.length)} کلاس` : s.classGroupName}</bdi>
                      ) : null}
                    </>
                  ) : null}
                  {isNow && s ? <PeriodProgress startsAt={r.startsAt} endsAt={r.endsAt} nowMinutes={nowMinutes} className="inset-x-2 bottom-1" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {pick && pickedRow ? (
        <div className="mt-2 border-t border-line/70 pt-1.5" aria-live="polite">
          <CrossFade swapKey={`${pick.weekday}-${pick.periodNo}`}>
            <p className="flex items-center justify-between gap-2 px-2 py-1 text-meta text-text-muted">
              <span>
                {WEEKDAY_LABELS[pick.weekday]}
                {pick.weekday === liveDay ? "، امروز" : ""}
                {pickedHoliday ? null : ` · ${pickedRow.label}`}
              </span>
              {pickedHoliday ? null : (
                <bdi dir="ltr" className="tabular">
                  {formatTimeRangeFa(pickedRow.startsAt, pickedRow.endsAt)}
                </bdi>
              )}
            </p>
            {pickedHoliday ? (
              <p className="px-2 pt-1 pb-3 text-sm text-text-muted">جمعه تعطیل است.</p>
            ) : pickedSessions.length === 0 ? (
              <p className="px-2 pt-1 pb-3 text-sm text-text-muted">
                {(byDay.get(pick.weekday) ?? []).length === 0
                  ? emptyDayCopy(WEEKDAY_LABELS[pick.weekday], perspective)
                  : `${pickedRow.label} آزاد است.`}
              </p>
            ) : (
              <ul>
                {pickedSessions.map((s) => (
                  <li key={s.offeringId}>
                    <Link prefetch={false} href={`/subjects/${s.offeringId}`} className="pressable flex min-h-16 items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-sunken">
                      <SubjectIcon subjectId={s.subjectId} name={s.subjectName} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-row font-semibold text-text">
                          <bdi>{s.subjectName}</bdi>
                        </span>
                        <span className="truncate text-meta text-text-muted">
                          <bdi>{secondary === "class" ? `کلاس ${s.classGroupName}` : (s.teacherName ?? "دبیر هنوز مشخص نشده")}</bdi>
                          {s.room ? (
                            <>
                              {" · "}
                              <bdi>{s.room}</bdi>
                            </>
                          ) : null}
                        </span>
                      </span>
                      {pickedIsNow ? <Chip tone="primary">الان</Chip> : pickedIsNext ? <Chip tone="neutral">بعدی</Chip> : null}
                      <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CrossFade>
        </div>
      ) : null}
    </div>
  );
}
