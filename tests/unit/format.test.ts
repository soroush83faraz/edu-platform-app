// Tehran day math (fixed +03:30, Saturday-start weeks) and Jalali input parsing — pure, no I/O.
import { describe, expect, it } from "vitest";
import { bucketFor, formatDayDistanceFa, formatDueFa, formatDueLongFa, formatRelativeDayFa, parseJalaliToInstant, tehranDayBounds, tehranDayDiff, tehranDayStart } from "@/lib/format";

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

describe("formatDueFa / formatDueLongFa", () => {
  // NOW = Sunday 12:00 Tehran. 20:29 UTC = 23:59 Tehran.
  it("row meta: today (end of day or a clock time), tomorrow, the weekday within six days, a date beyond", () => {
    expect(formatDueFa(new Date("2026-09-20T20:29:00Z"), NOW)).toBe("تا پایان امروز");
    expect(formatDueFa(new Date("2026-09-20T14:30:00Z"), NOW)).toBe("تا ساعت ۱۸ امروز");
    expect(formatDueFa(new Date("2026-09-20T15:00:00Z"), NOW)).toBe("تا ساعت ۱۸:۳۰ امروز");
    expect(formatDueFa(new Date("2026-09-21T20:29:00Z"), NOW)).toBe("تا فردا");
    expect(formatDueFa(new Date("2026-09-24T20:29:00Z"), NOW)).toBe("تا پنج‌شنبه");
    expect(formatDueFa(new Date("2026-09-26T10:00:00Z"), NOW)).toBe("تا شنبه");
    expect(formatDueFa(new Date("2026-09-27T10:00:00Z"), NOW)).toBe("تا ۵ مهر");
  });
  it("past due: open items «… گذشت»; closed items only name the deadline", () => {
    expect(formatDueFa(new Date("2026-09-19T20:29:00Z"), NOW)).toBe("دیروز گذشت");
    expect(formatDueFa(new Date("2026-09-17T10:00:00Z"), NOW)).toBe("۳ روز پیش گذشت");
    expect(formatDueFa(new Date("2026-09-01T10:00:00Z"), NOW)).toBe("۱۰ شهریور گذشت");
    expect(formatDueFa(new Date("2026-09-19T20:29:00Z"), NOW, false)).toBe("مهلت دیروز");
    expect(formatDueFa(new Date("2026-09-17T10:00:00Z"), NOW, false)).toBe("مهلت ۲۶ شهریور");
  });
  it("detail line: weekday + Jalali date, clock or «پایان روز», the distance in days", () => {
    expect(formatDueLongFa(new Date("2026-10-01T18:30:00Z"), NOW)).toBe("پنج‌شنبه ۹ مهر، ساعت ۲۲ (۱۱ روز دیگر)");
    expect(formatDueLongFa(new Date("2026-09-22T20:29:00Z"), NOW)).toBe("سه‌شنبه ۳۱ شهریور، پایان روز (۲ روز دیگر)");
    expect(formatDueLongFa(new Date("2026-09-19T20:29:00Z"), NOW)).toBe("شنبه ۲۸ شهریور، پایان روز (دیروز)");
    expect(formatDayDistanceFa(new Date("2026-09-15T10:00:00Z"), NOW)).toBe("۵ روز پیش");
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

describe("phones and identifiers", () => {
  it("E.164 → national Persian digits; non-phones keep their text; CSV keeps ASCII with a leading 0", async () => {
    const { formatPhoneFa, phoneToNational, formatLoginIdentifierFa } = await import("@/lib/format");
    expect(formatPhoneFa("+989351001016")).toBe("۰۹۳۵۱۰۰۱۰۱۶");
    expect(formatPhoneFa("09351001016")).toBe("۰۹۳۵۱۰۰۱۰۱۶");
    expect(phoneToNational("+989351001016")).toBe("09351001016");
    expect(phoneToNational("alk-14051001")).toBe("alk-14051001");
    expect(formatLoginIdentifierFa("+989351001016")).toBe("۰۹۳۵۱۰۰۱۰۱۶");
    expect(formatLoginIdentifierFa("alk-14051001")).toBe("alk-14051001");
  });
});
