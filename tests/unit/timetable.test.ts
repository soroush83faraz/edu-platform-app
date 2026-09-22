// Pure timetable math (src/lib/timetable): the Saturday-start Tehran weekday and minutes, «which زنگ rings now»,
// the next session of a subject across the week, the day-chip labels, the bell-schedule validator and the
// per-session states of the student/teacher day view — all pinned to fixed instants (Asia/Tehran = UTC+03:30).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIODS,
  SCHOOL_WEEKDAYS,
  WEEKDAY_LABELS,
  currentPeriodOf,
  formatSessionFa,
  formatTimeRangeFa,
  nextSessionOf,
  periodLabel,
  sessionStates,
  tehranClock,
  timeToMinutes,
  validatePeriods,
} from "@/lib/timetable";

// 2026-09-22 is a Tuesday (سه‌شنبه = 3). 08:35 UTC = 12:05 Tehran.
const TUE_1205 = new Date("2026-09-22T08:35:00Z");

describe("tehranClock", () => {
  it("maps an instant to the Saturday-start weekday and Tehran minutes", () => {
    expect(tehranClock(TUE_1205)).toEqual({ weekday: 3, minutes: 12 * 60 + 5 });
    // 22:00 UTC Tuesday = 01:30 Wednesday Tehran → چهارشنبه, 90 minutes.
    expect(tehranClock(new Date("2026-09-22T22:00:00Z"))).toEqual({ weekday: 4, minutes: 90 });
    // Friday and Saturday: 2026-09-25 is a Friday (6), 2026-09-26 a Saturday (0).
    expect(tehranClock(new Date("2026-09-25T06:00:00Z")).weekday).toBe(6);
    expect(tehranClock(new Date("2026-09-26T06:00:00Z")).weekday).toBe(0);
  });
});

describe("currentPeriodOf", () => {
  it("finds the ringing زنگ and the next one from the default bell schedule", () => {
    expect(currentPeriodOf(DEFAULT_PERIODS, 12 * 60 + 5)).toEqual({ currentPeriodNo: 5, nextPeriodNo: 6 });
    // In the break between زنگ اول and دوم: nothing rings, دوم is next.
    expect(currentPeriodOf(DEFAULT_PERIODS, 8 * 60 + 50)).toEqual({ currentPeriodNo: null, nextPeriodNo: 2 });
    // Before school and after the last زنگ.
    expect(currentPeriodOf(DEFAULT_PERIODS, 7 * 60)).toEqual({ currentPeriodNo: null, nextPeriodNo: 1 });
    expect(currentPeriodOf(DEFAULT_PERIODS, 14 * 60)).toEqual({ currentPeriodNo: null, nextPeriodNo: null });
    // The end bound is exclusive: 08:45 is the break, not زنگ اول.
    expect(currentPeriodOf(DEFAULT_PERIODS, 8 * 60 + 45).currentPeriodNo).toBeNull();
    // Unsorted input and `HH:mm:ss` (a PG time) both work.
    expect(currentPeriodOf([{ periodNo: 2, startsAt: "08:55:00", endsAt: "09:40:00" }, { periodNo: 1, startsAt: "08:00:00", endsAt: "08:45:00" }], 9 * 60)).toEqual({ currentPeriodNo: 2, nextPeriodNo: null });
  });
});

describe("nextSessionOf", () => {
  const slots = [
    { weekday: 1, periodNo: 5 }, // یکشنبه ۱۲:۰۰
    { weekday: 3, periodNo: 5 }, // سه‌شنبه ۱۲:۰۰ — ringing at TUE_1205
    { weekday: 3, periodNo: 2 }, // سه‌شنبه ۰۸:۵۵ — over
    { weekday: 4, periodNo: 1 }, // چهارشنبه ۰۸:۰۰
  ];
  it("a session ringing now is the next one (daysAhead 0); after it ends the next day's session follows", () => {
    expect(nextSessionOf(slots, DEFAULT_PERIODS, TUE_1205)).toMatchObject({ weekday: 3, periodNo: 5, daysAhead: 0 });
    const tue1300 = new Date("2026-09-22T09:30:00Z");
    expect(nextSessionOf(slots, DEFAULT_PERIODS, tue1300)).toMatchObject({ weekday: 4, periodNo: 1, daysAhead: 1 });
  });
  it("wraps around the week: on Thursday evening the next session is یکشنبه (3 days ahead)", () => {
    const thu1500 = new Date("2026-09-24T11:30:00Z");
    expect(nextSessionOf(slots, DEFAULT_PERIODS, thu1500)).toMatchObject({ weekday: 1, periodNo: 5, daysAhead: 3 });
  });
  it("null without slots or with slots whose زنگ no longer exists", () => {
    expect(nextSessionOf([], DEFAULT_PERIODS, TUE_1205)).toBeNull();
    expect(nextSessionOf([{ weekday: 0, periodNo: 9 }], DEFAULT_PERIODS, TUE_1205)).toBeNull();
  });
});

describe("labels", () => {
  it("day chips read شنبه…پنجشنبه in Saturday-start order", () => {
    expect(SCHOOL_WEEKDAYS.map((d) => WEEKDAY_LABELS[d])).toEqual(["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه"]);
  });
  it("period labels, time ranges and the next-session line use Persian digits and ordinals", () => {
    expect(periodLabel(3)).toBe("زنگ سوم");
    expect(periodLabel(12)).toBe("زنگ دوازدهم");
    expect(formatTimeRangeFa("10:00", "10:45:00")).toBe("۱۰:۰۰–۱۰:۴۵");
    expect(formatSessionFa({ weekday: 3, label: "زنگ سوم", startsAt: "10:00", endsAt: "10:45" })).toBe("سه‌شنبه، زنگ سوم ۱۰:۰۰–۱۰:۴۵");
    expect(formatSessionFa({ weekday: 3, label: "زنگ سوم", startsAt: "10:00", endsAt: "10:45", daysAhead: 0 })).toBe("امروز، زنگ سوم ۱۰:۰۰–۱۰:۴۵");
    expect(formatSessionFa({ weekday: 4, label: "زنگ اول", startsAt: "08:00", endsAt: "08:45", daysAhead: 1 })).toBe("فردا، زنگ اول ۰۸:۰۰–۰۸:۴۵");
  });
  it("timeToMinutes rejects malformed times", () => {
    expect(timeToMinutes("8:05")).toBe(485);
    expect(timeToMinutes("24:00")).toBeNaN();
    expect(timeToMinutes("abc")).toBeNaN();
  });
});

describe("sessionStates", () => {
  const day = [
    { periodNo: 1, startsAt: "08:00", endsAt: "08:45" },
    { periodNo: 3, startsAt: "10:00", endsAt: "10:45" },
    { periodNo: 5, startsAt: "12:00", endsAt: "12:45" },
    { periodNo: 6, startsAt: "12:55", endsAt: "13:40" },
  ];
  it("today: past, ringing, next, later — only the first upcoming one is «بعدی»", () => {
    expect(sessionStates(day, true, 12 * 60 + 5)).toEqual(["past", "past", "current", "next"]);
    expect(sessionStates(day, true, 9 * 60)).toEqual(["past", "next", "later", "later"]);
    expect(sessionStates(day, true, 15 * 60)).toEqual(["past", "past", "past", "past"]);
  });
  it("another day: everything is later", () => {
    expect(sessionStates(day, false, 12 * 60 + 5)).toEqual(["later", "later", "later", "later"]);
  });
});

describe("validatePeriods", () => {
  const ok = DEFAULT_PERIODS.map((p) => ({ ...p }));
  it("accepts the default schedule and rejects gaps, overlaps, bad times and empty names", () => {
    expect(validatePeriods(ok)).toBeNull();
    expect(validatePeriods([])).toBe("دست‌کم یک زنگ لازم است.");
    expect(validatePeriods([{ periodNo: 2, label: "زنگ دوم", startsAt: "08:00", endsAt: "08:45" }])).toBe("شمارهٴ زنگ‌ها باید از ۱ و پشت سر هم باشد.");
    expect(validatePeriods([{ periodNo: 1, label: "  ", startsAt: "08:00", endsAt: "08:45" }])).toBe("نام زنگ ۱ را وارد کنید.");
    expect(validatePeriods([{ periodNo: 1, label: "زنگ اول", startsAt: "8", endsAt: "08:45" }])).toBe("ساعت زنگ ۱ را به شکل ۰۸:۰۰ وارد کنید.");
    expect(validatePeriods([{ periodNo: 1, label: "زنگ اول", startsAt: "09:00", endsAt: "08:45" }])).toBe("پایان زنگ ۱ باید بعد از شروع آن باشد.");
    expect(
      validatePeriods([
        { periodNo: 1, label: "زنگ اول", startsAt: "08:00", endsAt: "08:45" },
        { periodNo: 2, label: "زنگ دوم", startsAt: "08:40", endsAt: "09:25" },
      ]),
    ).toBe("زنگ ۲ با زنگ قبلی هم‌پوشانی دارد.");
    expect(validatePeriods(Array.from({ length: 13 }, (_, i) => ({ periodNo: i + 1, label: "x", startsAt: "08:00", endsAt: "08:10" })))).toBe("حداکثر ۱۲ زنگ ممکن است.");
  });
});
