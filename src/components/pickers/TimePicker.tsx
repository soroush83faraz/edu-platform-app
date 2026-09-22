"use client";

import { useId } from "react";
import { cn } from "cn";
import { SelectNative } from "@/components/ui/select-native";
import { MINUTE_STEP, defaultTimeMinutes, formatHm, parseHm, snapMinutes } from "@/lib/jalali-grid";
import { toFaDigits } from "@/lib/format";

export interface TimePickerProps {
  /** ASCII `HH:mm` (the DTO shape) or "" = end of the day (۲۳:۵۹). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const two = (n: number) => toFaDigits(String(n).padStart(2, "0"));

/**
 * «ساعت مشخص» — off by default (the due is the end of the day); on, two native selects (hour 0–23, minute in
 * 5-minute steps): the OS wheel on phones, a short list on desktop — no typing, no invalid time possible.
 * A value that is not on the 5-minute grid (an existing ۲۳:۵۹) snaps to the nearest step when the toggle is on.
 */
export function TimePicker({ value, onChange, disabled, ...aria }: TimePickerProps) {
  const ids = useId();
  const minutes = value ? parseHm(value) : null;
  const on = minutes !== null;
  const snapped = on ? snapMinutes(minutes) : null;
  const hour = snapped === null ? 0 : Math.floor(snapped / 60);
  const minute = snapped === null ? 0 : snapped % 60;

  const toggle = (next: boolean) => onChange(next ? formatHm(defaultTimeMinutes()) : "");

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-line bg-surface p-3", disabled && "opacity-50")}>
      <label htmlFor={`${ids}-toggle`} className="flex min-h-8 cursor-pointer items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text">ساعت مشخص</span>
          <span className="text-meta text-text-muted">{on ? `تا ساعت ${two(hour)}:${two(minute)}` : "خاموش: تا پایان روز (۲۳:۵۹)"}</span>
        </span>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            id={`${ids}-toggle`}
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={on}
            disabled={disabled}
            onChange={(e) => toggle(e.target.checked)}
            aria-describedby={aria["aria-describedby"]}
          />
          <span
            aria-hidden
            className="block h-7 w-12 rounded-full bg-neutral-300 transition-base peer-checked:bg-primary-600 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 after:absolute after:top-0.5 after:start-0.5 after:size-6 after:rounded-full after:bg-white after:shadow-sm after:transition-base peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5"
          />
        </span>
      </label>

      {on ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-hour`} className="text-meta font-medium text-text-muted">
              ساعت
            </label>
            <SelectNative id={`${ids}-hour`} value={hour} disabled={disabled} className="tabular text-center" onChange={(e) => onChange(formatHm(Number(e.target.value) * 60 + minute))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {two(h)}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-minute`} className="text-meta font-medium text-text-muted">
              دقیقه
            </label>
            <SelectNative id={`${ids}-minute`} value={minute} disabled={disabled} className="tabular text-center" onChange={(e) => onChange(formatHm(hour * 60 + Number(e.target.value)))}>
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {two(m)}
                </option>
              ))}
            </SelectNative>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** «۱۸:۳۰» or «۲۳:۵۹» for a summary line. */
export function formatTimeFa(value: string): string {
  const m = value ? parseHm(value) : null;
  const t = m === null ? 23 * 60 + 59 : m;
  return `${two(Math.floor(t / 60))}:${two(t % 60)}`;
}
