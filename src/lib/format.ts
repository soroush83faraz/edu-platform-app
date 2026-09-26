// Presentation helpers: Persian digits and Tehran-local dates. Storage stays UTC; only rendering is localized.
// Iran has had no DST since 1401 (2022), so Asia/Tehran is a FIXED +03:30 — bucket math uses that constant and
// stays pure (unit-tested), while wall-clock formatting goes through Intl / date-fns-jalali.
import { format, parse } from "date-fns-jalali";
import { faIR } from "date-fns-jalali/locale";
import { toAsciiDigits } from "@/lib/normalize";

const faNumber = new Intl.NumberFormat("fa-IR", { useGrouping: true });

export function formatNumberFa(n: number): string {
  return faNumber.format(n);
}

/** ASCII digits → Persian digits inside any string (e.g. a formatted date). */
export function toFaDigits(s: string): string {
  return s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/**
 * Stored E.164 `+989351001016` → the national form people read and type, in Persian digits: `۰۹۳۵۱۰۰۱۰۱۶`.
 * Anything that is not an Iranian E.164 mobile comes back with its digits converted only. Render it inside
 * `<bdi dir="ltr">` — it is a number, not prose.
 */
export function formatPhoneFa(e164: string): string {
  const m = /^\+98(9\d{9})$/.exec(e164.trim());
  return toFaDigits(m ? `0${m[1]}` : e164.trim());
}

/** `+98935…` → `0935…` (ASCII, leading zero) for CSV / plain-text exports; other identifiers unchanged. */
export function phoneToNational(e164: string): string {
  const m = /^\+98(9\d{9})$/.exec(e164.trim());
  return m ? `0${m[1]}` : e164;
}

/**
 * A login identifier as shown on slips and lists: a phone becomes `۰۹۳۵…` (Persian digits); a generated username
 * such as `alk-14051001` is a Latin code and stays exactly as typed at login.
 */
export function formatLoginIdentifierFa(id: string): string {
  return /^\+98/.test(id) ? formatPhoneFa(id) : id;
}

/** A Date whose LOCAL fields equal the current wall-clock time in Asia/Tehran (the server runs in UTC). */
export function tehranNow(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return new Date(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** e.g. «یک‌شنبه ۲۹ شهریور ۱۴۰۵». */
export function formatJalaliLong(date = tehranNow()): string {
  return toFaDigits(format(date, "EEEE d MMMM yyyy", { locale: faIR }));
}

/** «۵ مهر» (same year) or «۵ مهر ۱۴۰۶». `instant` is a UTC instant; rendered in Tehran. */
export function formatJalaliShort(instant: Date, now = new Date()): string {
  const d = tehranNow(instant);
  const sameYear = format(d, "yyyy") === format(tehranNow(now), "yyyy");
  return toFaDigits(format(d, sameYear ? "d MMMM" : "d MMMM yyyy", { locale: faIR }));
}

/** «پنج‌شنبه ۲ مهر ۱۴۰۵، ۲۳:۵۹». */
export function formatJalaliDateTime(instant: Date): string {
  return toFaDigits(format(tehranNow(instant), "EEEE d MMMM yyyy، HH:mm", { locale: faIR }));
}

/** «۱۴۰۵/۰۷/۰۲» — the shape the due-date input expects. */
export function formatJalaliNumeric(instant: Date): string {
  return toFaDigits(format(tehranNow(instant), "yyyy/MM/dd"));
}

// ---------------------------------------------------------------------------------------------------------------
// Tehran day math (pure). Saturday-start weeks.
// ---------------------------------------------------------------------------------------------------------------

export const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Instant of 00:00 Tehran of the day containing `now`. */
export function tehranDayStart(now: Date): Date {
  const shifted = now.getTime() + TEHRAN_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - TEHRAN_OFFSET_MS);
}

/** Whole Tehran days from `a`'s day to `b`'s day (b − a); 0 = same day, 1 = tomorrow, −1 = yesterday. */
export function tehranDayDiff(a: Date, b: Date): number {
  return Math.round((tehranDayStart(b).getTime() - tehranDayStart(a).getTime()) / DAY_MS);
}

export interface DayBounds {
  /** 00:00 today (Tehran). */
  todayStart: Date;
  /** 00:00 tomorrow (Tehran) — exclusive end of today. */
  todayEnd: Date;
  /** 00:00 of next Saturday (Tehran) — exclusive end of this Saturday-start week. */
  weekEnd: Date;
}

export function tehranDayBounds(now = new Date()): DayBounds {
  const todayStart = tehranDayStart(now);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);
  // JS weekday of the Tehran day: epoch day 0 (1970-01-01) was a Thursday (4). Saturday = 6.
  const epochDay = Math.floor((todayStart.getTime() + TEHRAN_OFFSET_MS) / DAY_MS);
  const weekday = (epochDay + 4) % 7;
  const daysSinceSaturday = (weekday + 1) % 7;
  const weekEnd = new Date(todayStart.getTime() + (7 - daysSinceSaturday) * DAY_MS);
  return { todayStart, todayEnd, weekEnd };
}

export type Bucket = "overdue" | "today" | "week" | "later" | "none";

/** The inbox bucket of a due date. `isOpen=false` (done/cancelled) never reads as overdue. */
export function bucketFor(dueAt: Date | null, bounds: DayBounds, isOpen = true): Bucket {
  if (!dueAt) return "none";
  const t = dueAt.getTime();
  if (t < bounds.todayStart.getTime()) return isOpen ? "overdue" : "today";
  if (t < bounds.todayEnd.getTime()) return "today";
  if (t < bounds.weekEnd.getTime()) return "week";
  return "later";
}

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "سررسیده",
  today: "امروز",
  week: "این هفته",
  later: "بعداً",
  none: "بدون مهلت",
};

/** «امروز» / «فردا» / «دیروز» / «۲ روز دیگر» / «۳ روز گذشته» / beyond a week: «۵ مهر». */
export function formatRelativeDayFa(dueAt: Date, now = new Date()): string {
  const diff = tehranDayDiff(now, dueAt);
  if (diff === 0) return "امروز";
  if (diff === 1) return "فردا";
  if (diff === -1) return "دیروز";
  if (diff > 1 && diff <= 7) return `${formatNumberFa(diff)} روز دیگر`;
  if (diff < -1 && diff >= -7) return `${formatNumberFa(-diff)} روز گذشته`;
  return formatJalaliShort(dueAt, now);
}

/** «ساعت ۲۲» on the hour, «ساعت ۱۰:۳۰» otherwise (Tehran wall clock). */
function formatClockFa(instant: Date): string {
  const d = tehranNow(instant);
  const h = formatNumberFa(d.getHours());
  return d.getMinutes() === 0 ? `ساعت ${h}` : `ساعت ${toFaDigits(format(d, "H:mm"))}`;
}

/** 23:59 Tehran — the default due time of a date-only deadline («پایان روز»). */
function isEndOfDay(instant: Date): boolean {
  const d = tehranNow(instant);
  return d.getHours() === 23 && d.getMinutes() === 59;
}

/**
 * The deadline as a row's meta reads it: «تا پایان امروز» / «تا ساعت ۱۰ امروز» / «تا فردا» / «تا پنج‌شنبه» (the
 * next six days by weekday name) / «تا ۱۵ مهر»; once past (`open`): «دیروز گذشت» / «۳ روز پیش گذشت» / «۵ مهر
 * گذشت». A closed item past its due reads «مهلت دیروز» / «مهلت ۵ مهر» (nothing is late any more).
 */
export function formatDueFa(dueAt: Date, now = new Date(), open = true): string {
  const diff = tehranDayDiff(now, dueAt);
  if (diff === 0) return isEndOfDay(dueAt) ? "تا پایان امروز" : `تا ${formatClockFa(dueAt)} امروز`;
  if (diff === 1) return "تا فردا";
  if (diff > 1 && diff < 7) return `تا ${format(tehranNow(dueAt), "EEEE", { locale: faIR })}`;
  if (diff >= 7) return `تا ${formatJalaliShort(dueAt, now)}`;
  if (!open) return diff === -1 ? "مهلت دیروز" : `مهلت ${formatJalaliShort(dueAt, now)}`;
  if (diff === -1) return "دیروز گذشت";
  if (diff >= -7) return `${formatNumberFa(-diff)} روز پیش گذشت`;
  return `${formatJalaliShort(dueAt, now)} گذشت`;
}

/** The distance in days, without a cutoff: «امروز» / «فردا» / «دیروز» / «۱۲ روز دیگر» / «۳ روز پیش». */
export function formatDayDistanceFa(at: Date, now = new Date()): string {
  const diff = tehranDayDiff(now, at);
  if (diff === 0) return "امروز";
  if (diff === 1) return "فردا";
  if (diff === -1) return "دیروز";
  return diff > 0 ? `${formatNumberFa(diff)} روز دیگر` : `${formatNumberFa(-diff)} روز پیش`;
}

/** The detail page's deadline: «پنج‌شنبه ۱۰ مهر، ساعت ۲۲ (۲ روز دیگر)»; a 23:59 due reads «پایان روز». */
export function formatDueLongFa(dueAt: Date, now = new Date()): string {
  const d = tehranNow(dueAt);
  const sameYear = format(d, "yyyy") === format(tehranNow(now), "yyyy");
  const day = toFaDigits(format(d, sameYear ? "EEEE d MMMM" : "EEEE d MMMM yyyy", { locale: faIR }));
  return `${day}، ${isEndOfDay(dueAt) ? "پایان روز" : formatClockFa(dueAt)} (${formatDayDistanceFa(dueAt, now)})`;
}

/** For comments/notifications: «همین حالا» / «۵ دقیقه پیش» / «۳ ساعت پیش» / «دیروز» / «۵ مهر». */
export function formatRelativeTimeFa(at: Date, now = new Date()): string {
  const sec = Math.round((now.getTime() - at.getTime()) / 1000);
  if (sec < 60) return "همین حالا";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${formatNumberFa(min)} دقیقه پیش`;
  const hours = Math.floor(min / 60);
  if (hours < 24 && tehranDayDiff(at, now) === 0) return `${formatNumberFa(hours)} ساعت پیش`;
  const days = tehranDayDiff(at, now);
  if (days === 1) return "دیروز";
  if (days <= 7) return `${formatNumberFa(days)} روز پیش`;
  return formatJalaliShort(at, now);
}

// ---------------------------------------------------------------------------------------------------------------
// Jalali input parsing
// ---------------------------------------------------------------------------------------------------------------

/**
 * `۱۴۰۵/۰۷/۰۵` (Persian or ASCII digits, `/` or `-`) → the UTC instant of that Tehran day at `HH:mm`
 * (default 23:59, the end of the day). Returns null for anything that is not a valid Jalali date.
 */
export function parseJalaliToInstant(input: string, time?: string | null): Date | null {
  const s = toAsciiDigits(input.trim()).replace(/-/g, "/");
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return null;
  const parsed = parse(s, "yyyy/M/d", new Date(2000, 0, 1));
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip guard: `parse` accepts e.g. 1405/12/31 (a 29-day Esfand) and rolls it over.
  if (format(parsed, "yyyy/M/d") !== s.replace(/\/0+(\d)/g, "/$1")) return null;
  let hh = 23;
  let mm = 59;
  if (time && time.trim() !== "") {
    const m = /^(\d{1,2}):(\d{2})$/.exec(toAsciiDigits(time.trim()));
    if (!m) return null;
    hh = Number(m[1]);
    mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
  }
  // `parsed` carries the Gregorian date in local fields; rebuild it as a Tehran wall-clock instant.
  const utcMidnight = Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), hh, mm, 0);
  return new Date(utcMidnight - TEHRAN_OFFSET_MS);
}

// ---------------------------------------------------------------------------------------------------------------
// Plain dates (DB `date` columns, ISO `YYYY-MM-DD`) ⇄ Jalali `۱۴۰۵/۰۷/۰۱`
// ---------------------------------------------------------------------------------------------------------------

/** `۱۴۰۵/۰۷/۰۱` (any digits, `/` or `-`) → ISO `2026-09-23`; null when not a valid Jalali date. */
export function jalaliToIsoDate(input: string): string | null {
  const s = toAsciiDigits(input.trim()).replace(/-/g, "/");
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return null;
  const parsed = parse(s, "yyyy/M/d", new Date(2000, 0, 1));
  if (Number.isNaN(parsed.getTime())) return null;
  if (format(parsed, "yyyy/M/d") !== s.replace(/\/0+(\d)/g, "/$1")) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO `2026-09-23` → `۱۴۰۵/۰۷/۰۱`; the input is returned unchanged when it is not an ISO date. */
export function isoDateToJalali(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return toFaDigits(format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), "yyyy/MM/dd"));
}
