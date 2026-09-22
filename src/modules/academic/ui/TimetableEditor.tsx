"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
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
 * another class at the same زنگ (allowed, flagged). On phones the grid becomes one day at a time behind day
 * chips (no horizontal scroll needed for the selects); from `md` the whole week shows.
 */
export function TimetableEditor({ data }: { data: ClassTimetable }) {
  const { classGroup, periods, offerings, canEdit } = data;
  const [grid, setGrid] = useState<Grid>(() => Object.fromEntries(data.slots.map((s) => [keyOf(s.weekday, s.periodNo), { offeringId: s.offeringId, room: s.room, teacherName: s.teacherName }])));
  const [saved, setSaved] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [day, setDay] = useState<Weekday>(0);
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
      {/* phones: one day at a time */}
      <div className="flex flex-col gap-3 md:hidden">
        <div role="tablist" aria-label="روز هفته" className="grid grid-cols-6 gap-1 rounded-2xl bg-neutral-200/60 p-1">
          {SCHOOL_WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={day === d}
              onClick={() => setDay(d)}
              className={cn("pressable h-11 rounded-xl text-xs", day === d ? "bg-primary-600 font-semibold text-white shadow-1" : "text-text-muted")}
            >
              {WEEKDAY_LABELS[d]}
            </button>
          ))}
        </div>
        <ol className="flex flex-col gap-2 rounded-card bg-surface p-3 shadow-1">
          {periods.map((p) => (
            <li key={p.periodNo} className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
              <div className="flex flex-col pt-2 text-xs leading-4">
                <span className="font-medium text-text">{p.label}</span>
                <bdi dir="ltr" className="tabular text-text-faint">
                  {formatTimeRangeFa(p.startsAt, p.endsAt)}
                </bdi>
              </div>
              {renderCell(day, p.periodNo)}
            </li>
          ))}
        </ol>
      </div>

      {/* tablets and up: the whole week */}
      <div className="hidden overflow-x-auto rounded-card bg-surface shadow-1 md:block">
        <table className="w-full min-w-[64rem] table-fixed border-separate border-spacing-0">
          <thead>
            <tr>
              <th scope="col" className="w-28 px-3 py-2 text-start text-xs font-medium text-text-faint">
                زنگ
              </th>
              {SCHOOL_WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="px-1.5 py-2 text-center text-sm font-semibold text-text">
                  {WEEKDAY_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={p.periodNo}>
                <th scope="row" className={cn("px-3 py-2 text-start align-top font-normal", i > 0 && "border-t border-line/70")}>
                  <span className="block text-sm text-text">{p.label}</span>
                  <bdi dir="ltr" className="tabular block text-xs text-text-faint">
                    {formatTimeRangeFa(p.startsAt, p.endsAt)}
                  </bdi>
                </th>
                {SCHOOL_WEEKDAYS.map((d) => (
                  <td key={d} className={cn("px-1.5 py-2 align-top", i > 0 && "border-t border-line/70")}>
                    {renderCell(d, p.periodNo)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canEdit ? <p className="px-1 text-xs text-text-muted">شما این برنامه را فقط می‌بینید؛ تنظیم آن با مدیر یا معاون همین مدرسه است.</p> : null}
    </div>
  );
}
