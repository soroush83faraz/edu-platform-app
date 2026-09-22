"use client";

import { CalendarDays, CalendarRange } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { sessionStates, WEEKDAY_LABELS, type PeriodLike, type Weekday } from "@/lib/timetable";
import { DayChips } from "./DayChips";
import { SessionCard } from "./SessionCard";
import type { DayView, SessionSecondary } from "./types";
import { WeekOverview } from "./WeekOverview";

export interface TimetableViewProps {
  days: DayView[];
  periods: readonly (PeriodLike & { label: string })[];
  today: Weekday;
  /** Minutes since Tehran midnight when the page was rendered. */
  nowMinutes: number;
  currentPeriodNo: number | null;
  secondary: SessionSecondary;
  /** The empty-day line, e.g. «امروز زنگی ندارید.» */
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Day chips + the selected day's sessions, or the compact week table behind the «کل هفته» toggle. Today is
 * selected on load; switching a day re-keys the list so it rises in again (a short, answered motion).
 */
export function TimetableView({ days, periods, today, nowMinutes, currentPeriodNo, secondary, emptyTitle = "این روز زنگی ندارید.", emptyDescription }: TimetableViewProps) {
  const [selected, setSelected] = useState<Weekday>(today);
  const [week, setWeek] = useState(false);
  const counts = Object.fromEntries(days.map((d) => [d.weekday, d.sessions.length])) as Partial<Record<Weekday, number>>;
  const day = days.find((d) => d.weekday === selected);
  const sessions = day?.sessions ?? [];
  const states = sessionStates(sessions, selected === today, nowMinutes);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="px-1 text-sm text-text-muted">{week ? "همهٴ هفته در یک نگاه" : selected === today ? "امروز" : WEEKDAY_LABELS[selected]}</p>
        <button
          type="button"
          onClick={() => setWeek((w) => !w)}
          aria-pressed={week}
          className={cn(
            "pressable inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm",
            week ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line bg-surface text-text-muted hover:border-line-strong",
          )}
        >
          {week ? <CalendarDays className="size-4" aria-hidden /> : <CalendarRange className="size-4" aria-hidden />}
          {week ? "یک روز" : "کل هفته"}
        </button>
      </div>
      {!week ? <DayChips selected={selected} today={today} counts={counts} onSelect={setSelected} /> : null}

      {week ? (
        <WeekOverview days={days} periods={periods} today={today} currentPeriodNo={currentPeriodNo} secondary={secondary} className="reveal" />
      ) : sessions.length === 0 ? (
        <EmptyState key={selected} title={emptyTitle} description={emptyDescription} className="reveal rounded-card bg-surface py-10 shadow-1" />
      ) : (
        <ul key={selected} className="reveal-rows flex flex-col gap-2">
          {sessions.map((s, i) => (
            <SessionCard key={`${s.offeringId}-${s.periodNo}`} session={s} state={states[i]} secondary={secondary} />
          ))}
        </ul>
      )}
    </div>
  );
}
