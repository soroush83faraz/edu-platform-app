// Pure attendance generator shared by the demo seed (scripts/seed.ts) and the pilot seed (scripts/seed-pilot.ts):
// which school days to fill, which زنگ of each day carries the roll call, and what mark each student gets.
// Deterministic — the same key always yields the same mark, so a second seed run writes nothing new. Import-free
// apart from node's crypto and the shared date helpers.
import { createHash } from "node:crypto";
import { addDaysIso, tehranToday, weekdayOfIso, type AttendanceStatus } from "../src/lib/attendance";

/** Stable pseudo-random integer in [0, mod) from a key (the same trick as `hashInt` in the pilot seed). */
function hashInt(key: string, mod: number): number {
  return createHash("sha256").update(`edu-attendance:${key}`).digest().readUInt32BE(0) % mod;
}

/**
 * The realistic mix the pilot shows: ~۹۲٪ present, ~۴٪ absent, ~۲٫۵٪ late, ~۱٫۵٪ excused — spread by a hash of
 * `(student, date, period)` so one student is not absent every single day and a class is never fully absent.
 */
export function attendanceStatusFor(key: string): AttendanceStatus {
  const n = hashInt(key, 1000);
  if (n < 920) return "present";
  if (n < 960) return "absent";
  if (n < 985) return "late";
  return "excused";
}

/** Minutes of a تأخیر: 5, 10 or 15 — nothing dramatic. */
export function minutesLateFor(key: string): number {
  return [5, 10, 15][hashInt(`late:${key}`, 3)];
}

/**
 * The PAST school days (شنبه…پنج‌شنبه) of the last `days` days, today included, oldest first. Today counts —
 * a roll call for today is normal — but the future never does.
 */
export function pastSchoolDays(days: number, now = new Date()): string[] {
  const today = tehranToday(now);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = addDaysIso(today, -i);
    const wd = weekdayOfIso(iso);
    if (wd !== null && wd <= 5) out.push(iso);
  }
  return out;
}

export interface SlotRef {
  weekday: number;
  periodNo: number;
}

/**
 * The زنگ a class's roll call is taken at on a given day: the FIRST زنگ the timetable gives that class that
 * weekday (that is where a homeroom teacher takes it). Null when the class has no session that day — no roll
 * call is generated, exactly as in a real school.
 */
export function rollCallPeriod(slots: readonly SlotRef[], weekday: number): number | null {
  const ofDay = slots.filter((s) => s.weekday === weekday).map((s) => s.periodNo);
  return ofDay.length === 0 ? null : Math.min(...ofDay);
}
