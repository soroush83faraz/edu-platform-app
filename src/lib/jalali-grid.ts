// Pure Jalali calendar math for the date/time pickers — no React, no I/O, unit-tested. Every Date here is a
// "Tehran wall-clock" Date: its LOCAL fields equal the Tehran wall clock (built with `tehranNow` or `newDate` from
// date-fns-jalali), never a UTC instant. The pickers exchange the DTO string `۱۴۰۵/۰۷/۰۵` (Persian digits) with the
// form so the create/extend actions keep parsing it with `parseJalaliToInstant`.
import { addDays, addMonths, format, getDate, getDay, getDaysInMonth, getMonth, getYear, newDate, parse } from "date-fns-jalali";
import { faIR } from "date-fns-jalali/locale";
import { tehranNow, toFaDigits } from "@/lib/format";
import { toAsciiDigits } from "@/lib/normalize";

/** شنبه … جمعه — Saturday-start weeks (the product's week everywhere). */
export const WEEKDAY_LABELS_FA = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;
/** Spelled as the date-fns-jalali `faIR` locale spells them (نیم‌فاصله in یک‌شنبه / سه‌شنبه / پنج‌شنبه) so field and summary agree. */
export const WEEKDAY_NAMES_FA = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"] as const;

/** Column of a Saturday-start week: JS `getDay` 6 (Saturday) → 0, 0 (Sunday) → 1 … 5 (Friday) → 6. */
export function weekColumn(date: Date): number {
  return (getDay(date) + 1) % 7;
}

export interface MonthCell {
  date: Date;
  /** 1-based day of the Jalali month. */
  day: number;
  /** Persian digits. */
  label: string;
  /** ISO-like key for React and equality: `1405/07/05` (ASCII). */
  key: string;
  isFriday: boolean;
}

export interface MonthGrid {
  year: number;
  /** 0-based Jalali month (0 = فروردین). */
  month: number;
  /** «مهر ۱۴۰۵». */
  title: string;
  daysInMonth: number;
  /** Blank cells before the first day (Saturday-start). */
  leading: number;
  cells: MonthCell[];
  /** `leading + cells` padded to whole weeks: `null` = a blank cell. */
  weeks: (MonthCell | null)[][];
}

export function dateKey(date: Date): string {
  return format(date, "yyyy/MM/dd");
}

/** The 6-or-fewer-week grid of one Jalali month; اسفند has 29 or 30 days by the calendar's own leap rule. */
export function monthGrid(year: number, month: number): MonthGrid {
  const first = newDate(year, month, 1);
  const daysInMonth = getDaysInMonth(first);
  const leading = weekColumn(first);
  const cells: MonthCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = newDate(year, month, day);
    cells.push({ date, day, label: toFaDigits(String(day)), key: dateKey(date), isFriday: getDay(date) === 5 });
  }
  const flat: (MonthCell | null)[] = [...Array<null>(leading).fill(null), ...cells];
  while (flat.length % 7 !== 0) flat.push(null);
  const weeks: (MonthCell | null)[][] = [];
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7));
  return { year, month, title: toFaDigits(format(first, "MMMM yyyy", { locale: faIR })), daysInMonth, leading, cells, weeks };
}

/** The grid holding `date`, or the month `delta` months away from it. */
export function monthOf(date: Date, delta = 0): { year: number; month: number } {
  const d = delta === 0 ? date : addMonths(date, delta);
  return { year: getYear(d), month: getMonth(d) };
}

/** `۱۴۰۵/۰۷/۰۵` (any digits, `/` or `-`) → the wall-clock Date of that Jalali day at 00:00, or null. */
export function parseJalaliDay(input: string): Date | null {
  const s = toAsciiDigits(input.trim()).replace(/-/g, "/");
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return null;
  const parsed = parse(s, "yyyy/M/d", newDate(1400, 0, 1));
  if (Number.isNaN(parsed.getTime())) return null;
  if (format(parsed, "yyyy/M/d") !== s.replace(/\/0+(\d)/g, "/$1")) return null;
  return parsed;
}

/** A wall-clock day → the DTO string `۱۴۰۵/۰۷/۰۵`. */
export function formatJalaliDay(date: Date): string {
  return toFaDigits(dateKey(date));
}

/** «سه‌شنبه ۱۴۰۵/۰۷/۰۵» — what the closed field shows. */
export function formatJalaliDayWithWeekday(date: Date): string {
  return `${WEEKDAY_NAMES_FA[weekColumn(date)]} ${formatJalaliDay(date)}`;
}

/** «سه‌شنبه ۵ مهر» — the compact summary line. */
export function formatJalaliDayLong(date: Date): string {
  return toFaDigits(format(date, "EEEE d MMMM", { locale: faIR }));
}

export interface QuickDate {
  label: string;
  date: Date;
  key: string;
}

/**
 * The quick chips, in Tehran time: امروز, فردا, هفتهٴ بعد (+7), آخر هفته (the coming Friday — tomorrow on a
 * Thursday, the NEXT Friday when today is Friday, so the chip is never a duplicate of «امروز»).
 */
export function quickDates(now = new Date()): QuickDate[] {
  const day = tehranToday(now);
  const col = weekColumn(day); // 0 = شنبه … 6 = جمعه
  const toFriday = col === 6 ? 7 : 6 - col;
  const out: QuickDate[] = [
    { label: "امروز", date: day, key: dateKey(day) },
    { label: "فردا", date: addDays(day, 1), key: dateKey(addDays(day, 1)) },
    { label: "آخر هفته", date: addDays(day, toFriday), key: dateKey(addDays(day, toFriday)) },
    { label: "هفتهٴ بعد", date: addDays(day, 7), key: dateKey(addDays(day, 7)) },
  ];
  // A Thursday's «آخر هفته» is «فردا»: keep the one label people reach for first.
  const seen = new Set<string>();
  return out.filter((q) => (seen.has(q.key) ? false : (seen.add(q.key), true)));
}

/** Today as a wall-clock day (00:00), Tehran. */
export function tehranToday(now = new Date()): Date {
  const t = tehranNow(now);
  return newDate(getYear(t), getMonth(t), getDate(t));
}

// ---------------------------------------------------------------------------------------------------------------
// time
// ---------------------------------------------------------------------------------------------------------------

export const MINUTE_STEP = 5;

/** Minutes-of-day snapped to the nearest `step` (23:59 → 23:55, 14:23 → 14:25), clamped to the day. */
export function snapMinutes(minutesOfDay: number, step = MINUTE_STEP): number {
  const max = 24 * 60 - step;
  const snapped = Math.round(minutesOfDay / step) * step;
  return Math.min(Math.max(snapped, 0), max);
}

/** `HH:mm` (any digits) → minutes of day, or null. */
export function parseHm(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(toAsciiDigits(time.trim()));
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Minutes of day → ASCII `HH:mm` (the DTO shape). */
export function formatHm(minutesOfDay: number): string {
  const hh = Math.floor(minutesOfDay / 60);
  const mm = minutesOfDay % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** The wheel's first value when the toggle turns on: the current Tehran time, snapped up to the next step. */
export function defaultTimeMinutes(now = new Date(), step = MINUTE_STEP): number {
  const t = tehranNow(now);
  const minutes = t.getHours() * 60 + t.getMinutes();
  return Math.min(Math.ceil(minutes / step) * step, 24 * 60 - step);
}
