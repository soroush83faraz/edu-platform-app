"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "cn";
import { formatTimeFa, SCHOOL_WEEKDAYS, WEEKDAY_LABELS, type PeriodLike, type Weekday } from "@/lib/timetable";
import type { DayView, SessionSecondary } from "./types";

export interface WeekTimetableProps {
  days: DayView[];
  periods: readonly (PeriodLike & { label: string })[];
  today: Weekday;
  /** The ringing زنگ (Tehran clock at render); its cell in today's column is the live one. */
  currentPeriodNo: number | null;
  secondary: SessionSecondary;
  className?: string;
}

/**
 * The one timetable view of the product (owner: the week is the only view — no day chips, no toggle): one column
 * per school day, one row per زنگ with its times in a sticky start column. Cells read the subject on line 1 and
 * the teacher (student view) or the class (teacher view) on line 2; today's column is tinted and scrolled into view
 * on phones, the ringing cell is `primary-50` with the «الان» dot. Every occupied cell opens its subject page. On
 * phones the white box runs edge to edge (`-mx-4`, square corners) and the table scrolls sideways inside it — the
 * page never scrolls horizontally. A legend line under the table names the two tints.
 */
export function WeekTimetable({ days, periods, today, currentPeriodNo, secondary, className }: WeekTimetableProps) {
  const byDay = new Map(days.map((d) => [d.weekday, d.sessions]));
  const scroller = useRef<HTMLDivElement>(null);
  const todayCell = useRef<HTMLTableCellElement>(null);
  const live = currentPeriodNo !== null && (byDay.get(today) ?? []).some((s) => s.periodNo === currentPeriodNo);

  // Bring today's column into view when the table is wider than its box (phones). Manual scrollLeft math so the
  // page itself never jumps, and so it works in RTL where scrollLeft counts negative.
  useEffect(() => {
    const box = scroller.current;
    const cell = todayCell.current;
    if (!box || !cell || box.scrollWidth <= box.clientWidth) return;
    const boxRect = box.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    box.scrollLeft += cellRect.left - boxRect.left - (boxRect.width - cellRect.width) / 2;
  }, []);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* On phones the white box runs edge to edge (square, `-mx-4`) so the whole width scrolls; from `lg:` it is the card. */}
      <div ref={scroller} className="surface-work -mx-4 overflow-x-auto overscroll-x-contain rounded-none lg:mx-0 lg:rounded-card">
        <table className="w-full min-w-[38rem] border-separate border-spacing-0 text-meta">
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 z-10 w-24 bg-surface px-2 py-2 text-start font-medium text-text-faint">
                زنگ
              </th>
              {SCHOOL_WEEKDAYS.map((d) => (
                <th
                  key={d}
                  ref={d === today ? todayCell : undefined}
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
                                  now ? "bg-primary-50 ring-1 ring-primary-600/40" : "bg-surface-sunken hover:bg-primary-50",
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
        {live ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="grid size-3 place-items-center rounded-sm bg-primary-50 ring-1 ring-primary-600/40">
              <span className="size-1.5 rounded-full bg-primary-600" />
            </span>
            الان
          </span>
        ) : null}
      </p>
    </div>
  );
}
