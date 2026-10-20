// notif/quiet-hours — «ساعت‌های سکوت اعلان» (setting `notif.quiet_hours`, default 22:00–07:00 Asia/Tehran; owner
// 2026-10-20): no AUTOMATIC notification (a deadline reminder, a response-time reminder, an escalation) is delivered
// inside the window — it moves to the window's end. What a person does (an answer, a new تکلیف) still notifies at
// once: the window is about the system's own nudges. Pure — every function takes the instant it reasons about.
//
// A window is `[start, end)` in Tehran wall-clock minutes; `start > end` wraps midnight (22:00–07:00), `start = end`
// is no window at all. Asia/Tehran has been UTC+03:30 all year since 2022 (src/modules/ops/cron.ts), so the wall clock
// is the instant shifted by a constant.
import { TEHRAN_OFFSET_MS } from "@/lib/format";
import type { TimeRangeValue } from "@/modules/config/settings";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Tehran wall-clock minute of the day (0 … 1439). */
export function tehranMinuteOfDay(instant: Date): number {
  const local = instant.getTime() + TEHRAN_OFFSET_MS;
  return Math.floor((((local % DAY) + DAY) % DAY) / MINUTE);
}

/** Is `instant` inside the quiet window? */
export function inQuietHours(instant: Date, range: TimeRangeValue): boolean {
  const s = minutesOf(range.start);
  const e = minutesOf(range.end);
  if (s === e) return false;
  const m = tehranMinuteOfDay(instant);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The Tehran midnight (as an instant) of the day `instant` falls on. */
function tehranDayStartMs(instant: Date): number {
  const local = instant.getTime() + TEHRAN_OFFSET_MS;
  return local - (((local % DAY) + DAY) % DAY) - TEHRAN_OFFSET_MS;
}

/** The end of the quiet window `instant` is in (the first instant after it that is not quiet); `instant` itself when not quiet. */
export function quietEnd(instant: Date, range: TimeRangeValue): Date {
  if (!inQuietHours(instant, range)) return instant;
  let t = tehranDayStartMs(instant) + minutesOf(range.end) * MINUTE;
  if (t <= instant.getTime()) t += DAY;
  return new Date(t);
}

/** The start of the quiet window `instant` is in; `instant` itself when not quiet. */
export function quietStart(instant: Date, range: TimeRangeValue): Date {
  if (!inQuietHours(instant, range)) return instant;
  let t = tehranDayStartMs(instant) + minutesOf(range.start) * MINUTE;
  if (t > instant.getTime()) t -= DAY;
  return new Date(t);
}

/**
 * When a nudge meant for `ideal` is delivered: `ideal` outside the window; inside it, at the window's end — unless
 * that end is not before `deadline` (a reminder after the deadline it reminds of is worthless), then one minute
 * before the window starts. Null when that moment is already before `now` — the reminder is dropped.
 */
export function deliveryTime(ideal: Date, deadline: Date | null, range: TimeRangeValue, now: Date): Date | null {
  if (!inQuietHours(ideal, range)) return ideal;
  const end = quietEnd(ideal, range);
  if (deadline === null || end.getTime() < deadline.getTime()) return end;
  const before = new Date(quietStart(ideal, range).getTime() - MINUTE);
  return before.getTime() >= now.getTime() - MINUTE ? before : null;
}
