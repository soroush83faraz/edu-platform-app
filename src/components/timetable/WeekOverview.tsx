import Link from "next/link";
import { cn } from "cn";
import { formatTimeFa, SCHOOL_WEEKDAYS, WEEKDAY_LABELS, WEEKDAY_SHORT, type PeriodLike, type Weekday } from "@/lib/timetable";
import type { DayView, SessionSecondary } from "./types";

/**
 * The whole week at a glance: one column per school day, one row per زنگ (times in the start column). Cells
 * carry the subject name only (the teacher/class shows on tap); today's column is tinted, the ringing cell is
 * the one filled persian-blue cell. Scrolls sideways inside its own container on narrow screens — the page never
 * scrolls horizontally.
 */
export function WeekOverview({ days, periods, today, currentPeriodNo, secondary, className }: { days: DayView[]; periods: readonly (PeriodLike & { label: string })[]; today: Weekday; currentPeriodNo: number | null; secondary: SessionSecondary; className?: string }) {
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));
  return (
    <div className={cn("overflow-x-auto rounded-card bg-surface shadow-1", className)}>
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th scope="col" className="sticky start-0 z-10 bg-surface px-2 py-2 text-start font-medium text-text-faint">
              زنگ
            </th>
            {SCHOOL_WEEKDAYS.map((d) => (
              <th key={d} scope="col" className={cn("px-1 py-2 text-center font-semibold", d === today ? "rounded-t-lg bg-info-soft text-primary-800" : "text-text-muted")}>
                <span className="sm:hidden">{WEEKDAY_SHORT[d]}</span>
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p.periodNo}>
              <th scope="row" className={cn("sticky start-0 z-10 bg-surface px-2 py-1 text-start font-normal", i > 0 && "border-t border-line/70")}>
                <span className="block text-text">{p.label}</span>
                <bdi dir="ltr" className="tabular block text-[11px] text-text-faint">
                  {formatTimeFa(p.startsAt)}–{formatTimeFa(p.endsAt)}
                </bdi>
              </th>
              {SCHOOL_WEEKDAYS.map((d) => {
                const cellSessions = (byDay.get(d) ?? []).filter((s) => s.periodNo === p.periodNo);
                const live = d === today && p.periodNo === currentPeriodNo;
                return (
                  <td key={d} className={cn("h-12 px-0.5 py-1 align-top", i > 0 && "border-t border-line/70", d === today && "bg-info-soft/60")}>
                    {cellSessions.length === 0 ? (
                      <span className="block h-full rounded-md" />
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {cellSessions.map((s) => (
                          <li key={s.offeringId}>
                            <Link
                              href={`/subjects/${s.offeringId}`}
                              className={cn(
                                "pressable flex min-h-10 flex-col justify-center rounded-md px-1.5 py-1 text-center leading-4",
                                live ? "bg-primary-600 font-semibold text-white" : "bg-surface-sunken text-text hover:bg-primary-50",
                              )}
                            >
                              <bdi className="line-clamp-2">{s.subjectName}</bdi>
                              {secondary === "class" ? <bdi className={cn("text-[10px]", live ? "text-white/80" : "text-text-faint")}>{s.classGroupName}</bdi> : null}
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
  );
}
