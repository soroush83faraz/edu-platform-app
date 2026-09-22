// Pure attendance math shared by the services, the pages and the client roster: the four statuses with their
// Persian labels and tones, the tally / percentage helpers of every summary and report, and the Tehran calendar
// arithmetic the roll call needs (today's ISO date, the Saturday-start weekday of a date, «is this in the
// future?»). No I/O and no Date-dependent globals — every function takes `now`, so the unit tests pin a fixed
// Tehran instant. Iran has had no DST since 1401, so Asia/Tehran is a fixed +03:30 and the arithmetic stays exact
// (the same constant `src/lib/timetable.ts` and `src/lib/format.ts` use).
import { formatNumberFa } from "@/lib/format";
import type { Weekday } from "@/lib/timetable";

/** The four marks of a roll call. `late` IS presence (the student is in class, only late). */
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "حاضر",
  absent: "غایب",
  late: "تأخیر",
  excused: "موجه",
};

/** One letter for the dense report grid (a date column per student). */
export const ATTENDANCE_SHORT: Record<AttendanceStatus, string> = {
  present: "ح",
  absent: "غ",
  late: "ت",
  excused: "م",
};

/** The `Chip` tone of each status — success / danger / warning / neutral, the product's four semantic tones. */
export const ATTENDANCE_TONES: Record<AttendanceStatus, "success" | "danger" | "warning" | "neutral"> = {
  present: "success",
  absent: "danger",
  late: "warning",
  excused: "neutral",
};

export function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(v);
}

export type AttendanceCounts = Record<AttendanceStatus, number>;

export function emptyCounts(): AttendanceCounts {
  return { present: 0, absent: 0, late: 0, excused: 0 };
}

/** Counts of a list of marks (anything unknown is ignored — a row can only hold the four CHECKed values). */
export function tally(statuses: readonly string[]): AttendanceCounts {
  const out = emptyCounts();
  for (const s of statuses) if (isAttendanceStatus(s)) out[s] += 1;
  return out;
}

export function totalOf(c: AttendanceCounts): number {
  return c.present + c.absent + c.late + c.excused;
}

/** Percent of a part of the whole, rounded to a whole number; 0 when nothing was recorded. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/**
 * «درصد غیبت» — UNEXCUSED absence over every recorded roll call. `excused` is an absence the school accepted, so
 * it is NOT counted here (it stays visible as its own number); `late` is presence.
 */
export function absencePercent(c: AttendanceCounts): number {
  return percentOf(c.absent, totalOf(c));
}

/** «درصد حضور» — present + late over every recorded roll call (a late student was in class). */
export function presencePercent(c: AttendanceCounts): number {
  return percentOf(c.present + c.late, totalOf(c));
}

/** «۹۲٪» — the percentage as the UI prints it (Persian digits). */
export function formatPercentFa(p: number): string {
  return `${formatNumberFa(p)}٪`;
}

/** «۳ غایب، ۱ تأخیر» — the non-present part of a tally, empty string when everybody was present. */
export function summaryLineFa(c: AttendanceCounts): string {
  const parts: string[] = [];
  if (c.absent > 0) parts.push(`${formatNumberFa(c.absent)} غایب`);
  if (c.late > 0) parts.push(`${formatNumberFa(c.late)} تأخیر`);
  if (c.excused > 0) parts.push(`${formatNumberFa(c.excused)} موجه`);
  return parts.join("، ");
}

// ---------------------------------------------------------------------------------------------------------------
// Tehran calendar arithmetic over ISO `YYYY-MM-DD` (the shape of a PostgreSQL `date`)
// ---------------------------------------------------------------------------------------------------------------

const TEHRAN_OFFSET_MIN = 3 * 60 + 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → the epoch day number of that calendar day; NaN when malformed. */
export function isoToEpochDay(iso: string): number {
  const m = ISO_RE.exec(iso.trim());
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return Number.NaN;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Round-trip guard: Date.UTC rolls 2026-02-31 over into March.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return Number.NaN;
  return Math.floor(t / DAY_MS);
}

export function epochDayToIso(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Today in Tehran as `YYYY-MM-DD` — the date a roll call is «today» for. */
export function tehranToday(now = new Date()): string {
  return epochDayToIso(Math.floor((now.getTime() + TEHRAN_OFFSET_MIN * 60_000) / DAY_MS));
}

/** `YYYY-MM-DD` + `n` days (n may be negative). Returns the input unchanged when it is not an ISO date. */
export function addDaysIso(iso: string, n: number): string {
  const day = isoToEpochDay(iso);
  return Number.isNaN(day) ? iso : epochDayToIso(day + n);
}

/** Whole days from `from` to `to` (`to − from`); NaN when either side is malformed. */
export function daysBetweenIso(from: string, to: string): number {
  return isoToEpochDay(to) - isoToEpochDay(from);
}

/** Saturday-start weekday (0 = شنبه … 6 = جمعه) of an ISO date; null when malformed. */
export function weekdayOfIso(iso: string): Weekday | null {
  const day = isoToEpochDay(iso);
  if (Number.isNaN(day)) return null;
  // 1970-01-01 was a Thursday: JS weekday (Sunday = 0) of epoch day d is (d + 4) % 7; Saturday-start = (js + 1) % 7.
  const js = (((day + 4) % 7) + 7) % 7;
  return ((js + 1) % 7) as Weekday;
}

/** True when `iso` is a valid date after today in Tehran — a roll call may never be taken for it. */
export function isFutureIso(iso: string, now = new Date()): boolean {
  const day = isoToEpochDay(iso);
  if (Number.isNaN(day)) return false;
  return day > isoToEpochDay(tehranToday(now));
}

export function isValidIsoDate(iso: string): boolean {
  return !Number.isNaN(isoToEpochDay(iso));
}

/** The Saturday-start school days (شنبه…پنجشنبه) of the closed range `[from, to]`, oldest first. */
export function schoolDaysBetween(from: string, to: string): string[] {
  const a = isoToEpochDay(from);
  const b = isoToEpochDay(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const out: string[] = [];
  for (let d = a; d <= b; d++) {
    const iso = epochDayToIso(d);
    const wd = weekdayOfIso(iso);
    if (wd !== null && wd <= 5) out.push(iso);
  }
  return out;
}
