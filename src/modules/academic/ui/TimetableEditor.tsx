"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { WeekTimetable } from "@/components/timetable/WeekTimetable";
import type { DayView } from "@/components/timetable/types";
import { toast } from "sonner";
import { cn } from "cn";
import { SelectNative } from "@/components/ui/select-native";
import { formatTimeRangeFa, SCHOOL_WEEKDAYS, WEEKDAY_LABELS, type Weekday } from "@/lib/timetable";
import { setTimetableSlotAction } from "../actions";
import type { ClassTimetable } from "../service";

type Cell = { offeringId: string; room: string | null; teacherName: string | null };
type Grid = Record<string, Cell>;
const keyOf = (weekday: number, periodNo: number) => `${weekday}:${periodNo}`;

/**
 * The class timetable editor: weekdays as columns, زنگ‌ها as rows with their times, one native select per cell
 * («— خالی —» clears). A change saves immediately through the server action — optimistic, with a tick on the
 * cell, a toast on failure (the cell rolls back) and a yellow warning when the teacher is already booked in
 * another class at the same زنگ (allowed, flagged). The whole week at every width (owner: no day-at-a-time view):
 * on phones the table scrolls sideways inside its box with the زنگ column sticky. A caller who may only look gets
 * the product's shared `WeekTimetable` instead of disabled selects.
 */
export function TimetableEditor({ data, today, currentPeriodNo }: { data: ClassTimetable; today: Weekday; currentPeriodNo: number | null }) {
  const { classGroup, periods, offerings, canEdit } = data;
  const [grid, setGrid] = useState<Grid>(() => Object.fromEntries(data.slots.map((s) => [keyOf(s.weekday, s.periodNo), { offeringId: s.offeringId, room: s.room, teacherName: s.teacherName }])));
  const [saved, setSaved] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  const teacherOf = new Map(offerings.map((o) => [o.id, o.teacherName]));

  const change = (weekday: number, periodNo: number, offeringId: string) => {
    const key = keyOf(weekday, periodNo);
    const before = grid[key];
    setGrid((g) => {
      const next = { ...g };
      if (offeringId) next[key] = { offeringId, room: before?.room ?? null, teacherName: teacherOf.get(offeringId) ?? null };
      else delete next[key];
      return next;
    });
    setWarnings((w) => {
      const next = { ...w };
      delete next[key];
      return next;
    });
    start(async () => {
      const r = await setTimetableSlotAction({ classGroupId: classGroup.id, weekday, periodNo, classOfferingId: offeringId || null, room: before?.room ?? null });
      if (!r.ok) {
        setGrid((g) => {
          const next = { ...g };
          if (before) next[key] = before;
          else delete next[key];
          return next;
        });
        toast.error(r.message);
        return;
      }
      setSaved(key);
      window.setTimeout(() => setSaved((s) => (s === key ? null : s)), 1200);
      if (r.data.warning) {
        setWarnings((w) => ({ ...w, [key]: r.data.warning! }));
        toast.warning(r.data.warning);
      }
    });
  };

  if (periods.length === 0) {
    return <p className="rounded-card border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm text-text">این مدرسه هنوز زنگ‌بندی ندارد؛ اول زنگ‌ها را در صفحهٴ مدرسه تعریف کنید.</p>;
  }
  if (offerings.length === 0) {
    return <p className="rounded-card border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm text-text">این کلاس ارائهٴ درسی ندارد؛ اول از «ارائهٴ درس‌ها» درس و دبیر اضافه کنید.</p>;
  }
  if (!canEdit) {
    const byPeriod = new Map(periods.map((p) => [p.periodNo, p]));
    const days: DayView[] = SCHOOL_WEEKDAYS.map((weekday) => ({
      weekday,
      sessions: data.slots
        .filter((s) => s.weekday === weekday && byPeriod.has(s.periodNo))
        .map((s) => {
          const p = byPeriod.get(s.periodNo)!;
          return { ...s, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt };
        }),
    }));
    return (
      <div className="flex flex-col gap-3">
        <WeekTimetable days={days} periods={periods} today={today} currentPeriodNo={currentPeriodNo} secondary="teacher" />
        <p className="px-1 text-meta text-text-muted">شما این برنامه را فقط می‌بینید؛ تنظیم آن با مدیر یا معاون همین مدرسه است.</p>
      </div>
    );
  }

  const renderCell = (weekday: number, periodNo: number) => {
    const key = keyOf(weekday, periodNo);
    const cell = grid[key];
    const warning = warnings[key];
    return (
      <div className="flex flex-col gap-1">
        <div className="relative">
          <SelectNative
            aria-label={`${WEEKDAY_LABELS[weekday]}، زنگ ${periodNo}`}
            value={cell?.offeringId ?? ""}
            disabled={!canEdit}
            onChange={(e) => change(weekday, periodNo, e.target.value)}
            className={cn("h-11 w-full text-sm", cell ? "bg-surface font-medium text-text" : "bg-surface-sunken text-text-faint", warning && "border-warning")}
          >
            <option value="">— خالی —</option>
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.subjectName}
              </option>
            ))}
          </SelectNative>
          {saved === key ? (
            <span className="reveal-pop pointer-events-none absolute -top-1.5 -end-1.5 inline-flex size-5 items-center justify-center rounded-full bg-success text-white" aria-label="ذخیره شد">
              <Check className="size-3" strokeWidth={3} aria-hidden />
            </span>
          ) : null}
        </div>
        {cell ? <span className="truncate px-1 text-[11px] leading-4 text-text-faint">{cell.teacherName ?? "بدون دبیر"}</span> : null}
        {warning ? (
          <span className="flex items-start gap-1 px-1 text-[11px] leading-4 break-words text-warning-text">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {warning}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="surface-work -mx-4 overflow-x-auto overscroll-x-contain rounded-none lg:mx-0 lg:rounded-card">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 z-10 w-24 bg-surface px-3 py-2 text-start text-meta font-medium text-text-faint">
                زنگ
              </th>
              {SCHOOL_WEEKDAYS.map((d) => (
                <th key={d} scope="col" className={cn("min-w-36 px-1.5 py-2 text-center text-sm font-semibold", d === today ? "rounded-t-lg bg-info-soft text-primary-800" : "text-text")}>
                  {WEEKDAY_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={p.periodNo}>
                <th scope="row" className={cn("sticky start-0 z-10 bg-surface px-3 py-2 text-start align-top font-normal", i > 0 && "border-t border-line/70")}>
                  <span className="block text-sm text-text">{p.label}</span>
                  <bdi dir="ltr" className="tabular block text-xs text-text-faint">
                    {formatTimeRangeFa(p.startsAt, p.endsAt)}
                  </bdi>
                </th>
                {SCHOOL_WEEKDAYS.map((d) => (
                  <td key={d} className={cn("px-1.5 py-2 align-top", i > 0 && "border-t border-line/70", d === today && "bg-info-soft/40")}>
                    {renderCell(d, p.periodNo)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
