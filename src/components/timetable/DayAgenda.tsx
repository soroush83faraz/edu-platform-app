"use client";

import Link from "next/link";
import { useRef } from "react";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { formatNumberFa } from "@/lib/format";
import { dayAgenda, formatTimeFa, SCHOOL_WEEKDAYS, sessionStates, WEEKDAY_LABELS, WEEKDAY_SHORT, type PeriodLike, type Weekday } from "@/lib/timetable";
import { PeriodProgress } from "./PeriodProgress";
import type { DayView, SessionSecondary } from "./types";

export interface DayAgendaProps {
  days: DayView[];
  periods: readonly (PeriodLike & { label: string })[];
  /** The live Tehran clock (weekday + fractional minutes). */
  today: Weekday;
  nowMinutes: number;
  selected: Weekday;
  onSelect: (day: Weekday) => void;
  secondary: SessionSecondary;
  /** `self` — «کلاس نداری» (the viewer's own week); `class` — an admin looking at a class («زنگی ثبت نشده»). */
  perspective: "self" | "class";
}

/** A horizontal swipe must travel this far and be clearly more horizontal than vertical to switch the day. */
const SWIPE_MIN_PX = 56;

/**
 * The phone face of the timetable (< md): six day buttons that fit the width (the short letter, today ringed, the
 * number of زنگ‌ها under it), then the chosen day as one vertical list — the start/end times in an LTR column, the
 * subject, the teacher (students) or the class (teachers) with the زنگ label. Past rows dim, the first one still
 * to come reads «بعدی», the ringing one is `primary-50` with «الان» and the live progress bar along its bottom
 * edge. Empty زنگ‌ها inside the day and the long breaks are thin quiet dividers, not cards. A horizontal swipe on
 * the list moves to the neighbouring day (RTL: a swipe towards the end side — rightwards — goes forward).
 */
export function DayAgenda({ days, periods, today, nowMinutes, selected, onSelect, secondary, perspective }: DayAgendaProps) {
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));
  const sessions = byDay.get(selected) ?? [];
  const rows = dayAgenda(periods, sessions);
  const isToday = selected === today;
  const sessionRows = rows.filter((r) => r.kind === "session");
  const states = sessionStates(sessionRows, isToday, nowMinutes);
  const stateOf = new Map(sessionRows.map((r, i) => [r.periodNo, states[i]!]));
  const count = sessions.length;

  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const step = (dir: 1 | -1) => {
    const i = SCHOOL_WEEKDAYS.indexOf(selected);
    const next = SCHOOL_WEEKDAYS[i + dir];
    if (next !== undefined) onSelect(next);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div role="group" aria-label="روزهای هفته" className="surface-panel grid grid-cols-6 gap-1 p-1">
        {SCHOOL_WEEKDAYS.map((d) => {
          const n = byDay.get(d)?.length ?? 0;
          const active = d === selected;
          const isTodayChip = d === today;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={active}
              aria-current={isTodayChip ? "date" : undefined}
              aria-label={`${WEEKDAY_LABELS[d]}${isTodayChip ? "، امروز" : ""}، ${n > 0 ? `${formatNumberFa(n)} زنگ` : "بدون کلاس"}`}
              onClick={() => onSelect(d)}
              className={cn(
                "pressable flex min-h-14 flex-col items-center justify-center rounded-xl transition-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-primary-600 text-white" : "text-text hover:bg-surface",
                isTodayChip && !active && "ring-1 ring-inset ring-primary-600 text-primary-700",
              )}
            >
              <span className={cn("text-row font-semibold", !active && n === 0 && "text-text-faint")}>{WEEKDAY_SHORT[d]}</span>
              <span aria-hidden className={cn("tabular text-meta", active ? "text-white/80" : "text-text-muted", n === 0 && "invisible")}>
                {formatNumberFa(n)} زنگ
              </span>
            </button>
          );
        })}
      </div>

      <section
        aria-label={WEEKDAY_LABELS[selected]}
        className="surface-work touch-pan-y overflow-hidden"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          swiped.current = false;
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          swiped.current = true;
          // RTL: the following day sits on the left; dragging the list rightwards brings it in.
          step(dx > 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onClickCapture={(e) => {
          // A swipe that ends over a row must not also open it.
          if (swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          }
        }}
      >
        <header className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
          <h4 className="text-row font-semibold text-text">{WEEKDAY_LABELS[selected]}</h4>
          <p className="text-meta text-text-muted">
            {isToday ? "امروز" : null}
            {isToday && count > 0 ? " · " : null}
            {count > 0 ? <span className="tabular">{formatNumberFa(count)} زنگ</span> : null}
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="px-4 pt-2 pb-5 text-sm text-text-muted">
            {perspective === "class" ? `${WEEKDAY_LABELS[selected]} زنگی ثبت نشده.` : `${WEEKDAY_LABELS[selected]} کلاس نداری.`}
          </p>
        ) : (
          <ol className="pb-1">
            {rows.map((row, i) => {
              if (row.kind === "break") {
                return (
                  <li key={`b${row.startsAt}`} className="flex items-center gap-3 px-4 py-1 text-meta text-text-faint">
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    زنگ تفریح
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </li>
                );
              }
              if (row.kind === "free") {
                return (
                  <li key={`f${row.periodNo}`} className="flex items-center gap-3 px-4 py-1 text-meta text-text-faint">
                    <bdi dir="ltr" className="tabular w-11 shrink-0 text-start">
                      {formatTimeFa(row.startsAt)}
                    </bdi>
                    <span>{row.label} · آزاد</span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </li>
                );
              }
              const state = stateOf.get(row.periodNo) ?? "later";
              const current = state === "current";
              const prev = rows[i - 1];
              return row.sessions.map((s, j) => (
                <li key={`${s.offeringId}-${row.periodNo}`} className={cn((j > 0 || prev?.kind === "session") && "border-t border-line/70")}>
                  <Link
                    href={`/subjects/${s.offeringId}`}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "pressable relative flex min-h-16 items-center gap-3 px-4 py-2.5 hover:bg-surface-sunken",
                      current && "bg-primary-50 hover:bg-primary-50",
                      state === "past" && "opacity-60",
                    )}
                  >
                    <span className="flex w-11 shrink-0 flex-col">
                      <bdi dir="ltr" className={cn("tabular text-start text-meta font-medium", current ? "text-primary-800" : "text-text")}>
                        {formatTimeFa(row.startsAt)}
                      </bdi>
                      <bdi dir="ltr" className="tabular text-start text-meta text-text-faint">
                        {formatTimeFa(row.endsAt)}
                      </bdi>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("truncate text-row font-semibold", current ? "text-primary-900" : "text-text")}>
                        <bdi>{s.subjectName}</bdi>
                      </span>
                      <span className={cn("truncate text-meta", current ? "text-primary-800/80" : "text-text-muted")}>
                        <bdi>{secondary === "class" ? `کلاس ${s.classGroupName}` : (s.teacherName ?? "دبیر هنوز مشخص نشده")}</bdi>
                        <span className="text-text-faint"> · {row.label}</span>
                      </span>
                    </span>
                    {current ? <Chip tone="primary">الان</Chip> : state === "next" ? <Chip tone="neutral">بعدی</Chip> : null}
                    {current ? <PeriodProgress startsAt={row.startsAt} endsAt={row.endsAt} nowMinutes={nowMinutes} className="inset-x-4" /> : null}
                  </Link>
                </li>
              ));
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
