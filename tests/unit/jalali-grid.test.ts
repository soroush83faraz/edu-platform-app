// Jalali month grids, quick-chip dates in Tehran time and the 5-minute time wheel — pure, no I/O.
import { describe, expect, it } from "vitest";
import {
  defaultTimeMinutes,
  formatHm,
  formatJalaliDay,
  formatJalaliDayWithWeekday,
  monthGrid,
  monthOf,
  parseHm,
  parseJalaliDay,
  quickDates,
  snapMinutes,
  tehranToday,
  weekColumn,
} from "@/lib/jalali-grid";

// 2026-09-20 is a Sunday (۲۹ شهریور ۱۴۰۵). 12:00 Tehran = 08:30 UTC.
const NOW = new Date("2026-09-20T08:30:00Z");

describe("monthGrid", () => {
  it("مهر ۱۴۰۵: 30 days, the 1st is a Wednesday (column 4 of a Saturday-start week), five rows", () => {
    const g = monthGrid(1405, 6);
    expect(g.title).toBe("مهر ۱۴۰۵");
    expect(g.daysInMonth).toBe(30);
    expect(g.leading).toBe(4);
    expect(g.weeks).toHaveLength(5);
    expect(g.weeks[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(g.weeks[0][4]?.label).toBe("۱");
    expect(g.cells[4].key).toBe("1405/07/05");
    // ۵ مهر ۱۴۰۵ = 2026-09-27, a Sunday.
    expect(g.cells[4].date.getFullYear()).toBe(2026);
    expect(g.cells[4].date.getMonth()).toBe(8);
    expect(g.cells[4].date.getDate()).toBe(27);
    // Fridays fall in the last column only.
    for (const week of g.weeks) for (const [i, cell] of week.entries()) if (cell) expect(cell.isFriday).toBe(i === 6);
    // 4 + 30 = 34 cells: the last row is padded with one blank to a full week.
    expect(g.weeks[4].filter((c) => c === null)).toHaveLength(1);
  });

  it("اسفند: 29 days in ۱۴۰۵, 30 in the leap year ۱۴۰۳; فروردین is always 31", () => {
    expect(monthGrid(1405, 11).daysInMonth).toBe(29);
    expect(monthGrid(1403, 11).daysInMonth).toBe(30);
    expect(monthGrid(1405, 0).daysInMonth).toBe(31);
    expect(monthGrid(1403, 11).title).toBe("اسفند ۱۴۰۳");
  });

  it("monthOf steps across the year boundary", () => {
    const esfand = parseJalaliDay("۱۴۰۵/۱۲/۱۵")!;
    expect(monthOf(esfand)).toEqual({ year: 1405, month: 11 });
    expect(monthOf(esfand, 1)).toEqual({ year: 1406, month: 0 });
    expect(monthOf(esfand, -12)).toEqual({ year: 1404, month: 11 });
  });
});

describe("day strings", () => {
  it("parses the DTO string in Persian or ASCII digits and formats it back with the weekday", () => {
    const d = parseJalaliDay("۱۴۰۵/۰۷/۰۵")!;
    expect(formatJalaliDay(d)).toBe("۱۴۰۵/۰۷/۰۵");
    expect(formatJalaliDayWithWeekday(d)).toBe("یک‌شنبه ۱۴۰۵/۰۷/۰۵");
    expect(weekColumn(d)).toBe(1);
    expect(parseJalaliDay("1405/7/5")?.getTime()).toBe(d.getTime());
    expect(parseJalaliDay("۱۴۰۵/۱۲/۳۰")).toBeNull(); // ۱۴۰۵ is not a leap year
    expect(parseJalaliDay("۱۴۰۳/۱۲/۳۰")).not.toBeNull();
    expect(parseJalaliDay("فردا")).toBeNull();
  });
});

describe("quickDates (Tehran)", () => {
  it("Sunday ۲۹ شهریور: امروز, فردا, آخر هفته = the coming Friday (۳ مهر), هفتهٴ بعد = +7 (۵ مهر — شهریور has 31 days)", () => {
    expect(formatJalaliDay(tehranToday(NOW))).toBe("۱۴۰۵/۰۶/۲۹");
    const q = quickDates(NOW);
    expect(q.map((x) => x.label)).toEqual(["امروز", "فردا", "آخر هفته", "هفتهٴ بعد"]);
    expect(q.map((x) => x.key)).toEqual(["1405/06/29", "1405/06/30", "1405/07/03", "1405/07/05"]);
  });

  it("just before Tehran midnight is still today; after it, tomorrow", () => {
    expect(quickDates(new Date("2026-09-20T20:29:00Z"))[0].key).toBe("1405/06/29");
    expect(quickDates(new Date("2026-09-20T20:30:00Z"))[0].key).toBe("1405/06/30");
  });

  it("on a Thursday «آخر هفته» collapses into «فردا»; on a Friday it is the next Friday and «هفتهٴ بعد» collapses into it", () => {
    const thursday = quickDates(new Date("2026-09-24T08:30:00Z"));
    expect(thursday.map((x) => x.label)).toEqual(["امروز", "فردا", "هفتهٴ بعد"]);
    const friday = quickDates(new Date("2026-09-25T08:30:00Z"));
    expect(friday.map((x) => x.label)).toEqual(["امروز", "فردا", "آخر هفته"]);
    expect(friday[2].key).toBe("1405/07/10");
  });
});

describe("time wheel", () => {
  it("snaps to 5-minute steps and clamps at 23:55", () => {
    expect(snapMinutes(parseHm("23:59")!)).toBe(23 * 60 + 55);
    expect(snapMinutes(parseHm("14:23")!)).toBe(14 * 60 + 25);
    expect(snapMinutes(parseHm("14:22")!)).toBe(14 * 60 + 20);
    expect(snapMinutes(0)).toBe(0);
    expect(formatHm(snapMinutes(parseHm("۰۸:۰۷")!))).toBe("08:05");
  });
  it("parses Persian digits and rejects bad times; the default is now rounded UP to the next step", () => {
    expect(parseHm("۱۸:۳۰")).toBe(18 * 60 + 30);
    expect(parseHm("25:00")).toBeNull();
    expect(parseHm("9:5")).toBeNull();
    expect(formatHm(defaultTimeMinutes(NOW))).toBe("12:00");
    expect(formatHm(defaultTimeMinutes(new Date("2026-09-20T08:31:00Z")))).toBe("12:05");
    expect(formatHm(defaultTimeMinutes(new Date("2026-09-20T20:28:00Z")))).toBe("23:55");
  });
});
