// Tehran day math (fixed +03:30, Saturday-start weeks) and Jalali input parsing — pure, no I/O.
import { describe, expect, it } from "vitest";
import { bucketFor, formatRelativeDayFa, parseJalaliToInstant, tehranDayBounds, tehranDayDiff, tehranDayStart } from "@/lib/format";

// 2026-09-20 is a Sunday (۲۹ شهریور ۱۴۰۵). 12:00 Tehran = 08:30 UTC.
const NOW = new Date("2026-09-20T08:30:00Z");

describe("tehranDayBounds", () => {
  it("today starts at 20:30 UTC the day before and ends 24h later; the week ends next Saturday 00:00 Tehran", () => {
    const b = tehranDayBounds(NOW);
    expect(b.todayStart.toISOString()).toBe("2026-09-19T20:30:00.000Z");
    expect(b.todayEnd.toISOString()).toBe("2026-09-20T20:30:00.000Z");
    // Sunday → Saturday 2026-09-26 00:00 Tehran = 2026-09-25 20:30 UTC.
    expect(b.weekEnd.toISOString()).toBe("2026-09-25T20:30:00.000Z");
  });

  it("just before Tehran midnight is still 'today'; just after is 'tomorrow'", () => {
    expect(tehranDayStart(new Date("2026-09-20T20:29:59Z")).toISOString()).toBe("2026-09-19T20:30:00.000Z");
    expect(tehranDayStart(new Date("2026-09-20T20:30:00Z")).toISOString()).toBe("2026-09-20T20:30:00.000Z");
  });

  it("on a Friday the week ends at tomorrow's start (Saturday)", () => {
    const friday = new Date("2026-09-25T08:30:00Z");
    const b = tehranDayBounds(friday);
    expect(b.weekEnd.getTime()).toBe(b.todayEnd.getTime());
  });

  it("on a Saturday the week is a full seven days", () => {
    const saturday = new Date("2026-09-19T08:30:00Z");
    const b = tehranDayBounds(saturday);
    expect((b.weekEnd.getTime() - b.todayStart.getTime()) / 86_400_000).toBe(7);
  });
});

describe("bucketFor", () => {
  const b = tehranDayBounds(NOW);
  it("due today 23:59 Tehran → today; yesterday 23:59 → overdue (unless closed); Thursday → week; next month → later; null → none", () => {
    expect(bucketFor(new Date("2026-09-20T20:29:00Z"), b)).toBe("today");
    expect(bucketFor(new Date("2026-09-19T20:29:00Z"), b)).toBe("overdue");
    expect(bucketFor(new Date("2026-09-19T20:29:00Z"), b, false)).toBe("today");
    expect(bucketFor(new Date("2026-09-24T20:29:00Z"), b)).toBe("week");
    expect(bucketFor(new Date("2026-09-25T20:30:00Z"), b)).toBe("later");
    expect(bucketFor(null, b)).toBe("none");
  });
});

describe("formatRelativeDayFa / tehranDayDiff", () => {
  it("امروز / فردا / دیروز / n روز دیگر / n روز گذشته / Jalali short beyond a week", () => {
    expect(formatRelativeDayFa(new Date("2026-09-20T20:29:00Z"), NOW)).toBe("امروز");
    expect(formatRelativeDayFa(new Date("2026-09-21T10:00:00Z"), NOW)).toBe("فردا");
    expect(formatRelativeDayFa(new Date("2026-09-19T10:00:00Z"), NOW)).toBe("دیروز");
    expect(formatRelativeDayFa(new Date("2026-09-24T10:00:00Z"), NOW)).toBe("۴ روز دیگر");
    expect(formatRelativeDayFa(new Date("2026-09-17T10:00:00Z"), NOW)).toBe("۳ روز گذشته");
    expect(formatRelativeDayFa(new Date("2026-10-15T10:00:00Z"), NOW)).toBe("۲۳ مهر");
    expect(tehranDayDiff(NOW, new Date("2026-09-20T20:30:00Z"))).toBe(1);
  });
});

describe("parseJalaliToInstant", () => {
  it("۱۴۰۵/۰۷/۰۵ → 2026-09-27 23:59 Tehran = 20:29 UTC; with a time; ASCII digits and dashes too", () => {
    expect(parseJalaliToInstant("۱۴۰۵/۰۷/۰۵")?.toISOString()).toBe("2026-09-27T20:29:00.000Z");
    expect(parseJalaliToInstant("۱۴۰۵/۰۷/۰۵", "۰۸:۱۵")?.toISOString()).toBe("2026-09-27T04:45:00.000Z");
    expect(parseJalaliToInstant("1405-7-5")?.toISOString()).toBe("2026-09-27T20:29:00.000Z");
    // ۲۹ شهریور ۱۴۰۵ = 2026-09-20 (today in the fixture).
    expect(parseJalaliToInstant("۱۴۰۵/۰۶/۲۹")?.toISOString()).toBe("2026-09-20T20:29:00.000Z");
  });
  it("rejects garbage, impossible days and bad times", () => {
    expect(parseJalaliToInstant("فردا")).toBeNull();
    expect(parseJalaliToInstant("۱۴۰۵/۱۳/۰۱")).toBeNull();
    expect(parseJalaliToInstant("۱۴۰۵/۰۷/۳۲")).toBeNull();
    expect(parseJalaliToInstant("۱۴۰۵/۰۷/۰۵", "25:00")).toBeNull();
  });
});
