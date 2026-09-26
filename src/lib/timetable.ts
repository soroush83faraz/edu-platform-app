// Pure timetable math shared by the services, the pages and the client components: the Saturday-start weekday of
// a Tehran instant, «which زنگ is ringing now», the next session of a subject, and the Persian labels. No I/O, no
// Date-dependent globals — every function takes `now` so the unit tests pin a fixed Tehran time.
import { formatNumberFa, toFaDigits } from "@/lib/format";

/** 0 = شنبه … 6 = جمعه (the DB CHECK allows 6; the UI offers شنبه…پنج‌شنبه). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS: readonly string[] = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];
/** Two-letter chips for the compact week overview. */
export const WEEKDAY_SHORT: readonly string[] = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
/** The school week the product shows: شنبه…پنج‌شنبه. */
export const SCHOOL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5];

const ORDINALS = ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم", "هفتم", "هشتم", "نهم", "دهم", "یازدهم", "دوازدهم"];

/** «زنگ سوم» — the default label of period 3 (also what `createSchool` seeds). */
export function periodLabel(periodNo: number): string {
  return `زنگ ${ORDINALS[periodNo - 1] ?? formatNumberFa(periodNo)}`;
}

export interface PeriodLike {
  periodNo: number;
  /** `HH:mm` (a PG `time` arrives as `HH:mm:ss`; both parse). */
  startsAt: string;
  endsAt: string;
}

/** The six default زنگ‌ها of a new school (docs/admin.md «زنگ‌بندی»). */
export const DEFAULT_PERIODS: ReadonlyArray<PeriodLike & { label: string }> = [
  { periodNo: 1, label: "زنگ اول", startsAt: "08:00", endsAt: "08:45" },
  { periodNo: 2, label: "زنگ دوم", startsAt: "08:55", endsAt: "09:40" },
  { periodNo: 3, label: "زنگ سوم", startsAt: "10:00", endsAt: "10:45" },
  { periodNo: 4, label: "زنگ چهارم", startsAt: "10:55", endsAt: "11:40" },
  { periodNo: 5, label: "زنگ پنجم", startsAt: "12:00", endsAt: "12:45" },
  { periodNo: 6, label: "زنگ ششم", startsAt: "12:55", endsAt: "13:40" },
];

export const MAX_PERIODS = 12;

const TEHRAN_OFFSET_MIN = 3 * 60 + 30;
const DAY_MIN = 24 * 60;

/** `HH:mm` or `HH:mm:ss` → minutes since midnight; NaN when malformed. */
export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
  if (!m) return Number.NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return Number.NaN;
  return hh * 60 + mm;
}

/** `HH:mm:ss` / `HH:mm` → `HH:mm` (ASCII) — the wire form of a period bound. */
export function normalizeTime(t: string): string {
  const min = timeToMinutes(t);
  if (Number.isNaN(min)) return t;
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** «۰۸:۰۰» — Persian digits; render inside `<bdi dir="ltr">`. */
export function formatTimeFa(t: string): string {
  return toFaDigits(normalizeTime(t));
}

/** «۰۸:۰۰–۰۸:۴۵» (en dash, LTR-safe inside `<bdi>`). */
export function formatTimeRangeFa(startsAt: string, endsAt: string): string {
  return `${formatTimeFa(startsAt)}–${formatTimeFa(endsAt)}`;
}

export interface TehranClock {
  /** Saturday-start weekday of the Tehran calendar day containing `now`. */
  weekday: Weekday;
  /** Minutes since Tehran midnight. */
  minutes: number;
}

/** Iran has no DST since 1401: Asia/Tehran is a fixed +03:30, so the arithmetic stays pure (like `tehranDayBounds`). */
export function tehranClock(now: Date): TehranClock {
  const shifted = Math.floor(now.getTime() / 60_000) + TEHRAN_OFFSET_MIN;
  const dayIndex = Math.floor(shifted / DAY_MIN);
  const minutes = ((shifted % DAY_MIN) + DAY_MIN) % DAY_MIN;
  // 1970-01-01 was a Thursday: JS weekday (Sunday = 0) of epoch day d is (d + 4) % 7; Saturday-start = (js + 1) % 7.
  const js = (((dayIndex + 4) % 7) + 7) % 7;
  return { weekday: ((js + 1) % 7) as Weekday, minutes };
}

/** Minutes since Tehran midnight WITH the seconds as a fraction (12:05:30 → 725.5) — the live progress clock. */
export function tehranMinutesPrecise(now: Date): number {
  const shifted = now.getTime() / 60_000 + TEHRAN_OFFSET_MIN;
  return ((shifted % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/**
 * How far a زنگ has run at `nowMinutes` (fractional minutes are fine): 0 at the bell, → 1 at its end; null outside
 * [startsAt, endsAt) or when the bounds are malformed — the progress bar exists only while the زنگ rings.
 */
export function periodProgress(p: { startsAt: string; endsAt: string }, nowMinutes: number): number | null {
  const s = timeToMinutes(p.startsAt);
  const e = timeToMinutes(p.endsAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  if (nowMinutes < s || nowMinutes >= e) return null;
  return (nowMinutes - s) / (e - s);
}

export interface CurrentPeriod {
  /** The زنگ whose [starts, ends) contains `minutes`, else null. */
  currentPeriodNo: number | null;
  /** The first زنگ that starts after `minutes` (or after the current one), else null — the day is over. */
  nextPeriodNo: number | null;
}

/** Which period is ringing at `minutes` and which comes next. Periods may arrive unsorted. */
export function currentPeriodOf(periods: readonly PeriodLike[], minutes: number): CurrentPeriod {
  const sorted = [...periods].sort((a, b) => a.periodNo - b.periodNo);
  let currentPeriodNo: number | null = null;
  let nextPeriodNo: number | null = null;
  for (const p of sorted) {
    const s = timeToMinutes(p.startsAt);
    const e = timeToMinutes(p.endsAt);
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (minutes >= s && minutes < e) currentPeriodNo = p.periodNo;
    else if (s > minutes && nextPeriodNo === null) nextPeriodNo = p.periodNo;
  }
  return { currentPeriodNo, nextPeriodNo };
}

export interface SessionRef {
  weekday: number;
  periodNo: number;
}

/**
 * The next occurrence of any of `slots` at or after `now` in the Saturday-start week: today's sessions that have
 * not ended yet first (a session ringing now counts), then later weekdays, wrapping to next week. Null when the
 * offering has no slots or none of them has a known period.
 */
export function nextSessionOf<T extends SessionRef>(slots: readonly T[], periods: readonly PeriodLike[], now: Date): (T & { daysAhead: number }) | null {
  const clock = tehranClock(now);
  const endOf = new Map(periods.map((p) => [p.periodNo, timeToMinutes(p.endsAt)]));
  const startOf = new Map(periods.map((p) => [p.periodNo, timeToMinutes(p.startsAt)]));
  let best: (T & { daysAhead: number }) | null = null;
  let bestKey = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    const end = endOf.get(s.periodNo);
    const start = startOf.get(s.periodNo);
    if (end === undefined || start === undefined || Number.isNaN(end) || Number.isNaN(start)) continue;
    let daysAhead = (s.weekday - clock.weekday + 7) % 7;
    if (daysAhead === 0 && end <= clock.minutes) daysAhead = 7;
    const key = daysAhead * DAY_MIN + start;
    if (key < bestKey) {
      bestKey = key;
      best = { ...s, daysAhead };
    }
  }
  return best;
}

/** «سه‌شنبه، زنگ سوم ۱۰:۰۰–۱۰:۴۵» / «امروز، زنگ سوم …» / «فردا، …». */
export function formatSessionFa(s: { weekday: number; label: string; startsAt: string; endsAt: string; daysAhead?: number }): string {
  const day = s.daysAhead === 0 ? "امروز" : s.daysAhead === 1 ? "فردا" : WEEKDAY_LABELS[s.weekday] ?? "";
  return `${day}، ${s.label} ${formatTimeRangeFa(s.startsAt, s.endsAt)}`;
}

export type SessionState = "past" | "current" | "next" | "later";

/**
 * Past / ringing / next / later for the sessions of ONE day (in period order), decided from their bell times.
 * Only today has a live state: on any other day everything is `later`. «بعدی» marks the first session that has
 * not started yet.
 */
export function sessionStates(sessions: readonly PeriodLike[], isToday: boolean, nowMinutes: number): SessionState[] {
  if (!isToday) return sessions.map(() => "later");
  let nextMarked = false;
  return sessions.map((s) => {
    const start = timeToMinutes(s.startsAt);
    const end = timeToMinutes(s.endsAt);
    if (nowMinutes >= start && nowMinutes < end) return "current";
    if (end <= nowMinutes) return "past";
    if (!nextMarked) {
      nextMarked = true;
      return "next";
    }
    return "later";
  });
}

/** A gap between two rows of a day at least this long reads as «زنگ تفریح» (the 5–10 minute changeovers do not). */
export const BREAK_MIN_MINUTES = 15;

export type AgendaRow<T> =
  | { kind: "session"; periodNo: number; label: string; startsAt: string; endsAt: string; sessions: T[] }
  | { kind: "free"; periodNo: number; label: string; startsAt: string; endsAt: string }
  | { kind: "break"; startsAt: string; endsAt: string };

/**
 * One school day as the phone list reads it: the bell schedule from the first occupied زنگ to the last — occupied
 * زنگ‌ها carry their sessions, empty ones in between are `free`, and a gap of ≥ `BREAK_MIN_MINUTES` between two rows
 * is a `break`. Leading/trailing empty زنگ‌ها are dropped (a day that ends at زنگ سوم is not three «آزاد» rows
 * longer). A session whose period is not in `periods` (another school's bell, for a teacher) keeps its own times.
 */
export function dayAgenda<T extends PeriodLike & { label: string }>(
  periods: readonly (PeriodLike & { label: string })[],
  sessions: readonly T[],
): AgendaRow<T>[] {
  const byPeriod = new Map<number, T[]>();
  for (const s of sessions) byPeriod.set(s.periodNo, [...(byPeriod.get(s.periodNo) ?? []), s]);
  const known = new Map(periods.map((p) => [p.periodNo, p]));
  const numbers = [...new Set([...periods.map((p) => p.periodNo), ...byPeriod.keys()])].sort((a, b) => a - b);
  const occupied = numbers.filter((n) => byPeriod.has(n));
  if (occupied.length === 0) return [];
  const first = occupied[0]!;
  const last = occupied[occupied.length - 1]!;

  const rows: AgendaRow<T>[] = [];
  let prevEnd: string | null = null;
  for (const n of numbers) {
    if (n < first || n > last) continue;
    const own = byPeriod.get(n);
    const bell = known.get(n) ?? own![0]!;
    const { label, startsAt, endsAt } = own ? own[0]! : bell;
    if (prevEnd !== null && timeToMinutes(startsAt) - timeToMinutes(prevEnd) >= BREAK_MIN_MINUTES) {
      rows.push({ kind: "break", startsAt: prevEnd, endsAt: startsAt });
    }
    rows.push(own ? { kind: "session", periodNo: n, label, startsAt, endsAt, sessions: own } : { kind: "free", periodNo: n, label, startsAt, endsAt });
    prevEnd = endsAt;
  }
  return rows;
}

export interface PeriodInput {
  periodNo: number;
  label: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Validates a whole bell schedule: 1–12 rows, period numbers 1..n without gaps, `HH:mm` bounds with start < end,
 * and no overlap between consecutive periods. Returns the Persian message of the FIRST problem, else null.
 */
export function validatePeriods(periods: readonly PeriodInput[]): string | null {
  if (periods.length === 0) return "دست‌کم یک زنگ لازم است.";
  if (periods.length > MAX_PERIODS) return `حداکثر ${formatNumberFa(MAX_PERIODS)} زنگ ممکن است.`;
  const sorted = [...periods].sort((a, b) => a.periodNo - b.periodNo);
  let prevEnd = -1;
  for (const [i, p] of sorted.entries()) {
    if (p.periodNo !== i + 1) return "شمارهٴ زنگ‌ها باید از ۱ و پشت سر هم باشد.";
    if (!p.label.trim()) return `نام زنگ ${formatNumberFa(p.periodNo)} را وارد کنید.`;
    const s = timeToMinutes(p.startsAt);
    const e = timeToMinutes(p.endsAt);
    if (Number.isNaN(s) || Number.isNaN(e)) return `ساعت زنگ ${formatNumberFa(p.periodNo)} را به شکل ۰۸:۰۰ وارد کنید.`;
    if (s >= e) return `پایان زنگ ${formatNumberFa(p.periodNo)} باید بعد از شروع آن باشد.`;
    if (s < prevEnd) return `زنگ ${formatNumberFa(p.periodNo)} با زنگ قبلی هم‌پوشانی دارد.`;
    prevEnd = e;
  }
  return null;
}
