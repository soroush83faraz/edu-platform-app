"use client";

import { cn } from "cn";
import { formatNumberFa } from "@/lib/format";
import { SCHOOL_WEEKDAYS, WEEKDAY_LABELS, type Weekday } from "@/lib/timetable";

/**
 * The week ruler: six chips شنبه…پنجشنبه, one per school day. The selected day is the filled persian-blue chip;
 * today carries a small dot under its name so it stays findable when another day is selected. Each chip shows
 * the day's session count under the name (a quiet number, no chip). 44 px tall, equal widths — the whole strip
 * fits a 390 px phone; on wider screens the chips keep their width and align to the start.
 */
export function DayChips({ selected, today, counts, onSelect, className }: { selected: Weekday; today: Weekday; counts?: Partial<Record<Weekday, number>>; onSelect: (d: Weekday) => void; className?: string }) {
  return (
    <div role="tablist" aria-label="روز هفته" className={cn("grid grid-cols-6 gap-1 rounded-2xl bg-neutral-200/60 p-1", className)}>
      {SCHOOL_WEEKDAYS.map((d) => {
        const active = d === selected;
        const isToday = d === today;
        const n = counts?.[d];
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${WEEKDAY_LABELS[d]}${isToday ? "، امروز" : ""}${n !== undefined ? `، ${formatNumberFa(n)} زنگ` : ""}`}
            onClick={() => onSelect(d)}
            className={cn(
              "pressable relative flex h-12 flex-col items-center justify-center rounded-xl leading-none",
              active ? "bg-primary-600 font-semibold text-white shadow-1" : "text-text-muted hover:bg-surface/70 hover:text-text",
            )}
          >
            <span className="text-[11px] sm:text-sm">{WEEKDAY_LABELS[d]}</span>
            {n !== undefined ? <span className={cn("tabular mt-1 text-[11px] leading-none", active ? "text-white/80" : "text-text-faint")}>{n > 0 ? formatNumberFa(n) : "—"}</span> : null}
            {isToday ? <span aria-hidden className={cn("absolute bottom-1 size-1.5 rounded-full", active ? "bg-warning" : "bg-primary-600")} /> : null}
          </button>
        );
      })}
    </div>
  );
}
