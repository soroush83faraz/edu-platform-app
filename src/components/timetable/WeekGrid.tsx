"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/Chip";
import { SubjectStamp, subjectHueClasses } from "@/components/SubjectStamp";
import { CrossFade } from "@/components/motion/CrossFade";
import { emptyDayCopy, type TimetablePerspective } from "@/lib/empty-copy";
import { formatNumberFa } from "@/lib/format";
import { cellSubjectLabel } from "@/lib/subject-stamp";
import { currentPeriodOf, defaultWeekCell, formatTimeRangeFa, SCHOOL_WEEKDAYS, timeToMinutes, WEEKDAY_LABELS, WEEKDAY_SHORT, weekRows, type PeriodLike, type WeekCell, type Weekday } from "@/lib/timetable";
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
  /** Day of the month of شنبه … پنج‌شنبه (Persian digits), drawn under each column's letter; omitted for a template week. */
  weekDays?: readonly string[];
}

/**
 * The phone face of the timetable (< md), drawn like a calendar month (owner 2026-09-27): six columns for the
 * school days (the one-letter name, the day of the month under it, today filled in the brand blue) and one row per
 * زنگ with its number in a narrow start column — the whole week at once, no sideways scroll at 360 px. Each lesson
 * is a rounded square in its درس's «مُهر درس» hue with the درس's NAME on one or two lines (`cellSubjectLabel`, owner
 * 2026-09-27: not the stamp's letters; a دبیر's cell adds the class under it); an empty
 * زنگ is a faint outline; a زنگ تفریح is a wider gap between two rows. The ringing cell wears the brand ring and the
 * live progress bar; today's finished cells dim. Tapping a cell selects it (ink ring) and the card under the grid
 * reads it in full — the درس, the دبیر or the class, the day, the زنگ, the time — and opens the درس page.
 *
 * Width at 360 px: 328 px content − 2 × 6 px padding = 316 px; 26 px start column + 6 gaps × 4 px leaves 44.3 px
 * per column (46.8 px at 375), each cell 56 px tall — every cell is a ≥ 44 px target, and holds two 14 px lines of
 * the name (`text-cell`, 11 px, seven letters a line) plus the class line of a دبیر's cell.
 */
export function WeekGrid({ days, periods, today, nowMinutes, secondary, perspective, weekDays }: WeekGridProps) {
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));
  const all = days.flatMap((d) => d.sessions);
  const rows = weekRows(periods, all);
  const { currentPeriodNo } = currentPeriodOf(rows, nowMinutes);
  const [picked, setPicked] = useState<WeekCell | null>(null);
  const pick = picked ?? defaultWeekCell(days, rows, today, nowMinutes);

  const cellSessions = (d: Weekday, periodNo: number) => (byDay.get(d) ?? []).filter((s) => s.periodNo === periodNo);
  // «بعدی»: today's first session that has not started yet.
  const nextToday = rows.find((r) => timeToMinutes(r.startsAt) > nowMinutes && cellSessions(today, r.periodNo).length > 0)?.periodNo ?? null;

  const pickedRow = pick ? rows.find((r) => r.periodNo === pick.periodNo) : undefined;
  const pickedSessions = pick ? cellSessions(pick.weekday, pick.periodNo) : [];
  const pickedIsNow = pick !== null && pick.weekday === today && pick.periodNo === currentPeriodNo;
  const pickedIsNext = pick !== null && pick.weekday === today && pick.periodNo === nextToday;

  return (
    <div className="surface-work flex flex-col p-1.5">
      <div role="group" aria-label="برنامهٴ هفتگی" className="grid grid-cols-[1.625rem_repeat(6,minmax(0,1fr))] gap-1">
        {/* The headers are for the eye; every cell button speaks its own day and زنگ. */}
        <div aria-hidden className="contents">
          <span className="grid place-items-center text-meta text-text-faint">
            زنگ
          </span>
          {SCHOOL_WEEKDAYS.map((d, i) => {
            const isToday = d === today;
            return (
              <span
                key={d}
                className={cn("flex h-12 flex-col items-center justify-center rounded-stamp-lg", isToday ? "bg-primary-600 text-white" : "text-text")}
              >
                <span className="text-row leading-5 font-semibold">{WEEKDAY_SHORT[d]}</span>
                {weekDays?.[i] ? <span className={cn("tabular text-meta leading-4", isToday ? "text-white/80" : "text-text-faint")}>{weekDays[i]}</span> : null}
              </span>
            );
          })}
        </div>

        {rows.map((r) => (
          <div key={r.periodNo} className="contents">
            {r.afterBreak ? <span aria-hidden className="col-span-7 h-1" /> : null}
            <span aria-hidden className="tabular grid place-items-center text-row font-semibold text-text-muted">
              {formatNumberFa(r.periodNo)}
            </span>
            {SCHOOL_WEEKDAYS.map((d) => {
              const here = cellSessions(d, r.periodNo);
              const s = here[0];
              const isNow = d === today && r.periodNo === currentPeriodNo;
              const past = d === today && timeToMinutes(r.endsAt) <= nowMinutes;
              const selected = pick?.weekday === d && pick.periodNo === r.periodNo;
              const names = here.map((x) => x.subjectName).join("، ");
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={selected}
                  aria-current={isNow && s ? "time" : undefined}
                  aria-label={`${WEEKDAY_LABELS[d]}${d === today ? " (امروز)" : ""}، ${r.label}، ${s ? names : "آزاد"}`}
                  onClick={() => setPicked({ weekday: d, periodNo: r.periodNo })}
                  className={cn(
                    "pressable relative flex h-14 min-w-0 flex-col items-center justify-center overflow-hidden rounded-stamp-lg px-px text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
                {pick.weekday === today ? "، امروز" : ""} · {pickedRow.label}
              </span>
              <bdi dir="ltr" className="tabular">
                {formatTimeRangeFa(pickedRow.startsAt, pickedRow.endsAt)}
              </bdi>
            </p>
            {pickedSessions.length === 0 ? (
              <p className="px-2 pt-1 pb-3 text-sm text-text-muted">
                {(byDay.get(pick.weekday) ?? []).length === 0
                  ? emptyDayCopy(WEEKDAY_LABELS[pick.weekday], perspective)
                  : `${pickedRow.label} آزاد است.`}
              </p>
            ) : (
              <ul>
                {pickedSessions.map((s) => (
                  <li key={s.offeringId}>
                    <Link href={`/subjects/${s.offeringId}`} className="pressable flex min-h-16 items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-sunken">
                      <SubjectStamp subjectId={s.subjectId} name={s.subjectName} />
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
