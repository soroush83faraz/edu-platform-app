"use client";

import { CalendarDays, ChevronDown, ChevronLeft, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { useIsDesktop } from "@/components/admin/ResponsiveModal";
import { controlClass } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  WEEKDAY_LABELS_FA,
  WEEKDAY_NAMES_FA,
  dateKey,
  formatJalaliDay,
  formatJalaliDayLong,
  formatJalaliDayWithWeekday,
  monthGrid,
  monthOf,
  parseJalaliDay,
  quickDates,
  tehranToday,
  weekColumn,
} from "@/lib/jalali-grid";
import { addDays, addMonths } from "date-fns-jalali";

export interface JalaliDatePickerProps {
  /** The DTO string «۱۴۰۵/۰۷/۰۵» (Persian digits) or "" for no date. */
  value: string;
  onChange: (value: string) => void;
  /** `field` (default): a read-only control that opens the calendar (popover from `md`, bottom sheet on phones); `inline`: the calendar itself, for a modal that IS the picker. */
  variant?: "field" | "inline";
  id?: string;
  placeholder?: string;
  /** Days before this wall-clock day cannot be picked (the extend dialog passes today). */
  minDate?: Date;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}

/**
 * The product's one date control (Design v2): no typing — a Jalali month grid with شنبه…جمعه columns, today
 * outlined, the pick filled persian-blue, past days muted, the Friday column sunken; quick chips for the dates a
 * teacher reaches for; 44 px cells; arrows move a day/week (RTL-aware), Enter picks, Esc closes.
 */
export function JalaliDatePicker({ value, onChange, variant = "field", id, placeholder = "انتخاب تاریخ", minDate, disabled, ...aria }: JalaliDatePickerProps) {
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const selected = useMemo(() => (value ? parseJalaliDay(value) : null), [value]);

  const pick = (date: Date) => {
    onChange(formatJalaliDay(date));
    setOpen(false);
  };

  if (variant === "inline") {
    return <Calendar selected={selected} onPick={(d) => onChange(formatJalaliDay(d))} minDate={minDate} />;
  }

  const label = selected ? formatJalaliDayWithWeekday(selected) : placeholder;
  const trigger = (
    <button
      type="button"
      id={id}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-describedby={aria["aria-describedby"]}
      aria-label={aria["aria-label"] ? `${aria["aria-label"]}: ${label}` : undefined}
      onClick={() => setOpen(true)}
      className={cn(controlClass, "flex items-center gap-2.5 text-start", selected ? "pe-12" : "pe-10", !selected && "text-muted-foreground", aria["aria-invalid"] && "border-destructive ring-3 ring-destructive/20")}
    >
      <CalendarDays className="size-5 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {!selected ? <ChevronDown className="pointer-events-none absolute end-3.5 size-4 text-muted-foreground" aria-hidden /> : null}
    </button>
  );
  const clear = selected ? (
    <button
      type="button"
      onClick={() => onChange("")}
      disabled={disabled}
      aria-label="پاک کردن تاریخ"
      className="pressable absolute end-0.5 top-1/2 inline-grid size-10 -translate-y-1/2 place-items-center rounded-lg text-text-muted hover:bg-surface-sunken hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
    >
      <X className="size-4" aria-hidden />
    </button>
  ) : null;

  if (desktop) {
    return (
      <div className="relative">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          {clear}
          <PopoverContent className="w-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
            <Calendar selected={selected} onPick={pick} minDate={minDate} autoFocus />
          </PopoverContent>
        </Popover>
      </div>
    );
  }
  return (
    <div className="relative">
      {trigger}
      {clear}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-card pb-[max(env(safe-area-inset-bottom),1rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetHeader className="pb-0">
            <SheetTitle className="text-lg">تاریخ مهلت</SheetTitle>
            <SheetDescription className="sr-only">یک روز را از تقویم انتخاب کنید.</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <Calendar selected={selected} onPick={pick} minDate={minDate} autoFocus />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// the calendar itself
// ---------------------------------------------------------------------------------------------------------------

interface CalendarProps {
  selected: Date | null;
  onPick: (date: Date) => void;
  minDate?: Date;
  /** Move focus into the grid (the selected day, else today) once mounted — for the popover/sheet. */
  autoFocus?: boolean;
  className?: string;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function Calendar({ selected, onPick, minDate, autoFocus = false, className }: CalendarProps) {
  const today = useMemo(() => tehranToday(), []);
  const todayKey = dateKey(today);
  const min = minDate ? startOfDay(minDate) : null;
  const chips = useMemo(() => quickDates(), []);
  const headingId = useId();

  const [view, setView] = useState(() => monthOf(selected ?? today));
  const grid = useMemo(() => monthGrid(view.year, view.month), [view]);
  // The one focusable cell (roving tabindex): the selection when it is on screen, else today, else the 1st.
  const [focusKey, setFocusKey] = useState<string>(() => (selected ? dateKey(selected) : todayKey));
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(autoFocus ? focusKey : null);

  const inView = (key: string) => grid.cells.some((c) => c.key === key);
  const rovingKey = inView(focusKey) ? focusKey : grid.cells[0].key;

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-key="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    el?.focus();
  });

  const isDisabled = (d: Date) => min !== null && startOfDay(d) < min;

  const moveTo = (date: Date) => {
    const key = dateKey(date);
    setFocusKey(key);
    pendingFocus.current = key;
    const m = monthOf(date);
    if (m.year !== view.year || m.month !== view.month) setView(m);
  };
  const shiftMonth = (delta: number) => {
    const first = grid.cells[0].date;
    const next = monthOf(first, delta);
    setView(next);
    setFocusKey(dateKey(monthGrid(next.year, next.month).cells[0].date));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = (e.target as HTMLElement).dataset.key;
    if (!current) return;
    const date = grid.cells.find((c) => c.key === current)?.date;
    if (!date) return;
    // RTL grid: the arrow that points to the visual right (ArrowRight) goes to the EARLIER day.
    const steps: Record<string, number> = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in steps) {
      e.preventDefault();
      moveTo(addDays(date, steps[e.key]));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isDisabled(date)) onPick(date);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(addDays(date, -weekColumn(date)));
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(addDays(date, 6 - weekColumn(date)));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      moveTo(addMonths(date, e.key === "PageUp" ? -1 : 1));
    }
  };

  const selectedKey = selected ? dateKey(selected) : null;

  return (
    // One 22rem box, centred in whatever holds it (an auto-width popover, a full-width sheet, the extend modal) so
    // the quick chips, the month header and the seven columns all sit on the same left and right edges.
    <div className={cn("mx-auto flex w-[22rem] max-w-full flex-col gap-3", className)}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${chips.length}, minmax(0, 1fr))` }} role="group" aria-label="انتخاب سریع">
        {chips.map((q) => {
          const active = selectedKey === q.key;
          const off = isDisabled(q.date);
          return (
            <button
              key={q.key}
              type="button"
              disabled={off}
              onClick={() => onPick(q.date)}
              aria-pressed={active}
              aria-label={`${q.label}، ${formatJalaliDayLong(q.date)}`}
              className={cn(
                "pressable min-h-10 truncate rounded-full border px-2 text-sm transition-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
                active ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line bg-surface text-text-muted hover:border-line-strong hover:text-text",
              )}
            >
              {q.label}
            </button>
          );
        })}
      </div>

      {/* Seven columns like the grid below it: each arrow sits exactly over the outer column, the month over the middle five. */}
      <div className="grid grid-cols-7 items-center">
        <MonthButton label="ماه قبل" onClick={() => shiftMonth(-1)} />
        <h3 id={headingId} className="col-span-5 text-center text-row font-semibold text-text" aria-live="polite">
          {grid.title}
        </h3>
        <MonthButton label="ماه بعد" onClick={() => shiftMonth(1)} mirror />
      </div>

      <div ref={gridRef} role="grid" aria-labelledby={headingId} onKeyDown={onKeyDown} className="grid grid-cols-7">
        <div role="row" className="contents">
          {WEEKDAY_LABELS_FA.map((l, i) => (
            <div key={l} role="columnheader" aria-label={WEEKDAY_NAMES_FA[i]} className={cn("grid h-8 place-items-center text-meta font-medium text-text-muted", i === 6 && "rounded-t-lg bg-surface-sunken")}>
              {l}
            </div>
          ))}
        </div>
        {grid.weeks.map((week, wi) => (
          <div key={wi} role="row" className="contents">
            {week.map((cell, ci) => {
              const column = cn(ci === 6 && "bg-surface-sunken", ci === 6 && wi === grid.weeks.length - 1 && "rounded-b-lg");
              if (!cell) return <div key={`b${wi}${ci}`} role="gridcell" aria-hidden className={cn("h-11", column)} />;
              const isSelected = cell.key === selectedKey;
              const isToday = cell.key === todayKey;
              const past = startOfDay(cell.date) < startOfDay(today);
              const off = isDisabled(cell.date);
              return (
                <div key={cell.key} role="gridcell" aria-selected={isSelected} className={cn("grid h-11 place-items-center", column)}>
                  <button
                    type="button"
                    data-key={cell.key}
                    tabIndex={cell.key === rovingKey ? 0 : -1}
                    disabled={off}
                    onClick={() => onPick(cell.date)}
                    onFocus={() => setFocusKey(cell.key)}
                    aria-label={`${formatJalaliDayLong(cell.date)}${isToday ? "، امروز" : ""}`}
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "pressable grid size-11 place-items-center rounded-lg text-base tabular outline-none transition-base focus-visible:ring-3 focus-visible:ring-ring/50",
                      isSelected ? "bg-primary-600 font-semibold text-white" : past ? "text-text-faint hover:bg-primary-50" : "text-text hover:bg-primary-50",
                      isToday && !isSelected && "ring-1 ring-inset ring-primary-600 font-semibold text-primary-700",
                      off && "cursor-not-allowed opacity-35 hover:bg-transparent",
                    )}
                  >
                    {cell.label}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-meta text-text-muted">
        امروز: <span className="tabular text-text">{formatJalaliDayLong(today)}</span>
      </p>
    </div>
  );
}

function MonthButton({ label, onClick, mirror = false }: { label: string; onClick: () => void; mirror?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="pressable grid size-11 justify-self-center place-items-center rounded-lg text-text-muted outline-none transition-base hover:bg-surface-sunken hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft className={cn("size-5", mirror ? "ltr:-scale-x-100" : "rtl:-scale-x-100")} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
