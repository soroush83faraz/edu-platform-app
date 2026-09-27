// The phone week grid (src/components/timetable/WeekGrid): a lesson cell reads the درس's NAME (`cellSubjectLabel`,
// owner 2026-09-27), not the stamp's three letters; a دبیر's cell adds the class under it. The columns are the full
// day names شنبه … جمعه, all seven the same width (owner 2026-09-27 follow-up): جمعه is a plain empty column unless
// the school has lessons on it, never a tinted or narrower one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeekGrid } from "@/components/timetable/WeekGrid";
import type { DayView, SessionView } from "@/components/timetable/types";

const periods = [
  { periodNo: 1, label: "زنگ اول", startsAt: "07:30", endsAt: "08:15" },
  { periodNo: 2, label: "زنگ دوم", startsAt: "08:20", endsAt: "09:05" },
];
const session = (over: Partial<SessionView>): SessionView => ({
  offeringId: "o1",
  subjectId: "0190a000-0000-7000-8000-000000000001",
  subjectName: "ریاضی",
  teacherName: "خانم احمدی",
  classGroupName: "۱۰/۱",
  room: null,
  weekday: 0,
  periodNo: 1,
  label: "زنگ اول",
  startsAt: "07:30",
  endsAt: "08:15",
  ...over,
});
const days: DayView[] = [
  { weekday: 0, sessions: [session({}), session({ offeringId: "o2", subjectName: "زبان انگلیسی ۱", periodNo: 2, label: "زنگ دوم" })] },
  { weekday: 1, sessions: [session({ offeringId: "o3", subjectName: "دین و زندگی", weekday: 1 })] },
];
/** The text of the grid's cell buttons (the details card below repeats full names, so it is cut off). */
const cellsText = (secondary: "teacher" | "class") => {
  const html = renderToStaticMarkup(
    createElement(WeekGrid, { days, periods, today: 3, nowMinutes: 600, secondary, perspective: "student" }),
  );
  const grid = html.slice(0, html.indexOf('aria-live="polite"'));
  return [...grid.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/^\||\|$/g, ""));
};

describe("WeekGrid cells", () => {
  it("read the درس name on up to two lines, never the stamp letters", () => {
    const cells = cellsText("teacher").filter(Boolean);
    expect(cells).toEqual(["ریاضی", "دین و|زندگی", "زبان|انگلیسی"]);
    expect(cells.join()).not.toMatch(/ریا(?!ضی)|انگ(?!لیسی)/);
  });

  it("add the class under the name in a دبیر's week", () => {
    expect(cellsText("class").filter(Boolean)).toEqual(["ریاضی|۱۰/۱", "دین و|زندگی|۱۰/۱", "زبان|انگلیسی|۱۰/۱"]);
  });
});

const render = (props: Partial<Parameters<typeof WeekGrid>[0]> = {}) =>
  renderToStaticMarkup(createElement(WeekGrid, { days, periods, today: 3, nowMinutes: 600, secondary: "teacher", perspective: "student", ...props }));
/** The header row: each day's name and date, and whether it is the holiday / today. */
const headers = (html: string) => {
  const head = html.slice(html.indexOf('<div aria-hidden="true" class="contents">'), html.indexOf("<button"));
  return [...head.matchAll(/<span( data-holiday="")? class="([^"]*)"><span[^>]*>([^<]*)<\/span>(?:<span[^>]*>([^<]*)<\/span>)?<\/span>/g)].map((m) => ({
    name: m[3],
    date: m[4] ?? null,
    holiday: Boolean(m[1]),
    today: m[2].includes("bg-primary-600"),
  }));
};
const WEEK = ["۴", "۵", "۶", "۷", "۸", "۹", "۱۰"];

describe("WeekGrid columns", () => {
  it("name every day in full, شنبه … جمعه, with the date under it", () => {
    const h = headers(render({ weekDays: WEEK }));
    expect(h.map((x) => x.name)).toEqual(["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"]);
    expect(h.map((x) => x.date)).toEqual(WEEK);
    expect(h.map((x) => x.today)).toEqual([false, false, false, true, false, false, false]);
  });

  it("draws جمعه as a plain empty column, the same width as every other day", () => {
    const html = render();
    // All seven columns share one equal width — جمعه is never narrower.
    expect(html).toContain("grid-cols-[1rem_repeat(7,minmax(0,1fr))]");
    // The header carries no holiday tint any more.
    expect(headers(html).map((x) => x.holiday)).toEqual([false, false, false, false, false, false, false]);
    // Its cells are ordinary empty buttons (no fill, the same faint outline as any free period) that still say «تعطیل».
    const holidayCells = [...html.matchAll(/<button[^>]*data-holiday=""[^>]*aria-label="([^"]*)"[^>]*>/g)].map((m) => m[1]);
    expect(holidayCells).toEqual(["جمعه، زنگ اول، تعطیل", "جمعه، زنگ دوم، تعطیل"]);
    // No sand/warning tint class survives on either the header or the cells.
    expect(html).not.toContain("warning-soft");
    expect(html).not.toContain("warning-text");
  });

  it("render a school's جمعه lessons like any other day, in seven equal columns", () => {
    const withFriday = [...days, { weekday: 6 as const, sessions: [session({ offeringId: "o9", subjectName: "شیمی", weekday: 6 })] }];
    const html = render({ days: withFriday });
    expect(html).toContain("grid-cols-[1rem_repeat(7,minmax(0,1fr))]");
    expect(html).not.toContain("data-holiday");
    expect(html).toContain('aria-label="جمعه، زنگ اول، شیمی"');
  });

  it("mark جمعه as today, except when the dates are already the coming week", () => {
    expect(headers(render({ today: 6 })).map((x) => x.today)).toEqual([false, false, false, false, false, false, true]);
    expect(headers(render({ today: 6, weekDays: WEEK, comingWeek: true })).some((x) => x.today)).toBe(false);
    // On the coming week the week's شنبه is still today once جمعه is over.
    expect(headers(render({ today: 0, weekDays: WEEK, comingWeek: true }))[0]!.today).toBe(true);
  });
});
