// The pure attendance math (src/lib/attendance.ts): the tally, the two percentages the product prints, and the
// Tehran calendar arithmetic a roll call depends on — today's date, the Saturday-start weekday of a date, «is
// this in the future?» and the school days of a range. Every function takes `now`, so the clock is pinned here.
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  absencePercent,
  addDaysIso,
  daysBetweenIso,
  emptyCounts,
  formatPercentFa,
  isAttendanceStatus,
  isFutureIso,
  isValidIsoDate,
  isoToEpochDay,
  percentOf,
  presencePercent,
  schoolDaysBetween,
  summaryLineFa,
  tally,
  tehranToday,
  totalOf,
  weekdayOfIso,
} from "@/lib/attendance";

describe("statuses", () => {
  it("are the four the CHECK constraint allows, each with a Persian label", () => {
    expect([...ATTENDANCE_STATUSES]).toEqual(["present", "absent", "late", "excused"]);
    for (const s of ATTENDANCE_STATUSES) expect(ATTENDANCE_LABELS[s].length).toBeGreaterThan(0);
    expect(isAttendanceStatus("late")).toBe(true);
    expect(isAttendanceStatus("sick")).toBe(false);
    expect(isAttendanceStatus(3)).toBe(false);
  });
});

describe("tally / percentages", () => {
  it("counts the four marks and ignores anything else", () => {
    expect(tally(["present", "present", "absent", "late", "excused", "unknown"])).toEqual({ present: 2, absent: 1, late: 1, excused: 1 });
    expect(tally([])).toEqual(emptyCounts());
    expect(totalOf({ present: 2, absent: 1, late: 1, excused: 1 })).toBe(5);
  });

  it("«درصد غیبت» is UNEXCUSED absence only; «درصد حضور» counts a late student as present", () => {
    const c = { present: 20, absent: 3, late: 2, excused: 0 };
    expect(absencePercent(c)).toBe(12); // 3 / 25
    expect(presencePercent(c)).toBe(88); // 22 / 25
    const withExcused = { present: 20, absent: 0, late: 0, excused: 5 };
    expect(absencePercent(withExcused)).toBe(0);
    expect(presencePercent(withExcused)).toBe(80);
  });

  it("an empty tally is 0 %, never NaN, and percentages round to whole numbers", () => {
    expect(absencePercent(emptyCounts())).toBe(0);
    expect(presencePercent(emptyCounts())).toBe(0);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(5, 0)).toBe(0);
  });

  it("renders Persian digits and names only the marks that happened", () => {
    expect(formatPercentFa(92)).toBe("۹۲٪");
    expect(summaryLineFa({ present: 25, absent: 0, late: 0, excused: 0 })).toBe("");
    expect(summaryLineFa({ present: 20, absent: 3, late: 1, excused: 2 })).toBe("۳ غایب، ۱ تأخیر، ۲ موجه");
  });
});

describe("Tehran calendar", () => {
  it("«today» flips at midnight Tehran (+03:30), not at UTC midnight", () => {
    // 2026-09-22 20:45 UTC is already 2026-09-23 00:15 in Tehran.
    expect(tehranToday(new Date("2026-09-22T20:45:00Z"))).toBe("2026-09-23");
    expect(tehranToday(new Date("2026-09-22T20:15:00Z"))).toBe("2026-09-22");
    expect(tehranToday(new Date("2026-09-22T08:35:00Z"))).toBe("2026-09-22");
  });

  it("weekdays are Saturday-start: 2026-09-22 is a سه‌شنبه (3)", () => {
    expect(weekdayOfIso("2026-09-22")).toBe(3);
    expect(weekdayOfIso("2026-09-19")).toBe(0); // شنبه
    expect(weekdayOfIso("2026-09-25")).toBe(6); // جمعه
    expect(weekdayOfIso("not-a-date")).toBeNull();
  });

  it("validates ISO dates and rejects rolled-over ones", () => {
    expect(isValidIsoDate("2026-09-22")).toBe(true);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("1405/07/01")).toBe(false);
    expect(Number.isNaN(isoToEpochDay("2026-9-2"))).toBe(true);
  });

  it("adds days across a month border and measures a range", () => {
    expect(addDaysIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("bad", 3)).toBe("bad");
    expect(daysBetweenIso("2026-09-01", "2026-09-22")).toBe(21);
  });

  it("only a date after the Tehran today is «future»", () => {
    const now = new Date("2026-09-22T08:35:00Z");
    expect(isFutureIso("2026-09-23", now)).toBe(true);
    expect(isFutureIso("2026-09-22", now)).toBe(false);
    expect(isFutureIso("2026-09-21", now)).toBe(false);
    // 23:30 Tehran on the 22nd: the 23rd is still the future.
    expect(isFutureIso("2026-09-23", new Date("2026-09-22T20:00:00Z"))).toBe(true);
    expect(isFutureIso("nonsense", now)).toBe(false);
  });

  it("school days of a range skip جمعه and keep the order", () => {
    const days = schoolDaysBetween("2026-09-19", "2026-09-26");
    expect(days).toEqual(["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-26"]);
    expect(days.every((d) => weekdayOfIso(d) !== 6)).toBe(true);
    expect(schoolDaysBetween("2026-09-26", "2026-09-19")).toEqual([]);
  });
});
