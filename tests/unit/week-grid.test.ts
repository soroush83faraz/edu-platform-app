// The phone week grid (src/components/timetable/WeekGrid): a lesson cell reads the درس's NAME (`cellSubjectLabel`,
// owner 2026-09-27), not the stamp's three letters; a دبیر's cell adds the class under it. The columns are the full
// day names شنبه … جمعه, all seven the same width (owner 2026-09-27 follow-up): جمعه is a plain empty column unless
// the school has lessons on it, never a tinted or narrower one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeekGrid } from "@/components/timetable/WeekGrid";
import { cellOfferings, WeekClassList, weekClasses } from "@/components/timetable/WeekClassList";
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
  // The grid ends where the student's details card or the دبیر's class list begins.
  const grid = html.slice(0, html.search(/aria-live="polite"|data-week-classes/));
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

// A دبیر's week (owner 2026-09-27): every class of the week listed once under the grid; a tapped cell's class row is
// emphasised (bolder, primary-50), the other rows are not; the student's week keeps its details card and no list.
const teacherDays: DayView[] = [
  {
    weekday: 0,
    sessions: [
      session({ offeringId: "o1", classGroupName: "۱۰/۲" }),
      session({ offeringId: "o2", subjectName: "هندسه", classGroupName: "۱۰/۱", periodNo: 2, label: "زنگ دوم", startsAt: "08:20", endsAt: "09:05" }),
    ],
  },
  {
    weekday: 1,
    sessions: [
      session({ offeringId: "o1", classGroupName: "۱۰/۲", weekday: 1 }),
      session({ offeringId: "o3", subjectName: "آمار", classGroupName: "۱۰/۱", weekday: 1, periodNo: 2, label: "زنگ دوم", startsAt: "08:20", endsAt: "09:05" }),
    ],
  },
  { weekday: 3, sessions: [session({ offeringId: "o2", subjectName: "هندسه", classGroupName: "۱۰/۱", weekday: 3 })] },
];
/** Each class row of the list: its offering (from the chevron link), whether it is emphasised, and its text. */
const classRows = (html: string) =>
  [...html.matchAll(/<li( data-selected="")? class="[^"]*"><button[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button><a[^>]*href="\/subjects\/([^"]+)"/g)].map((m) => ({
    offeringId: m[4],
    selected: Boolean(m[1]),
    pressed: m[2] === "true",
    text: m[3]!.replace(/<[^>]+>/g, ""),
  }));
const teacherGrid = (props: Partial<Parameters<typeof WeekGrid>[0]> = {}) =>
  renderToStaticMarkup(createElement(WeekGrid, { days: teacherDays, periods, today: 2, nowMinutes: 600, secondary: "class", perspective: "staff", ...props }));

describe("WeekGrid, a دبیر's class list", () => {
  it("lists every offering of the week once, by class then درس, with its periods per week and next session", () => {
    const rows = classRows(teacherGrid());
    expect(rows.map((r) => r.offeringId)).toEqual(["o3", "o2", "o1"]);
    expect(rows[0]!.text).toContain("آمار");
    expect(rows[0]!.text).toContain("کلاس ۱۰/۱ · ۱ زنگ در هفته");
    expect(rows[1]!.text).toContain("کلاس ۱۰/۱ · ۲ زنگ در هفته");
    expect(rows[2]!.text).toContain("کلاس ۱۰/۲ · ۲ زنگ در هفته");
    // Today is دوشنبه 10:00: هندسه's next session is سه‌شنبه, ریاضی's wraps round to شنبه.
    expect(rows[1]!.text).toContain("سه‌شنبه۰۷:۳۰");
    expect(rows[2]!.text).toMatch(/زنگ در هفتهشنبه۰۷:۳۰$/);
    // Nothing is selected on open, and the single-cell details card is gone.
    expect(rows.some((r) => r.selected || r.pressed)).toBe(false);
    expect(teacherGrid()).not.toContain('aria-live="polite"');
  });

  it("reads «الان» for the class that is ringing and «امروز» for a later session today", () => {
    const rows = classRows(teacherGrid({ today: 0, nowMinutes: 460 }));
    expect(rows.find((r) => r.offeringId === "o1")!.text).toContain("الان");
    expect(rows.find((r) => r.offeringId === "o2")!.text).toContain("امروز۰۸:۲۰");
  });

  it("emphasises the tapped cell's class row and no other", () => {
    const selected = cellOfferings(teacherDays, { weekday: 3, periodNo: 1 });
    expect(selected).toEqual(["o2"]);
    const html = renderToStaticMarkup(createElement(WeekClassList, { classes: weekClasses(teacherDays, 2, 600), selected }));
    const rows = classRows(html);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.selected).map((r) => r.offeringId)).toEqual(["o2"]);
    expect(rows.filter((r) => r.pressed).map((r) => r.offeringId)).toEqual(["o2"]);
    // The selected row sits on primary-50 and its title turns bold; the others keep the plain semibold title.
    const li = [...html.matchAll(/<li( data-selected="")? class="([^"]*)">(.*?)<\/li>/g)];
    for (const [, sel, cls, body] of li) {
      expect(cls.includes("bg-primary-50")).toBe(Boolean(sel));
      expect(body!.includes("font-bold")).toBe(Boolean(sel));
    }
  });

  it("opens each درس from the row's chevron link", () => {
    expect(teacherGrid()).toMatch(/<a aria-label="باز کردن هندسه، کلاس ۱۰\/۱"[^>]*href="\/subjects\/o2"/);
  });

  it("is not drawn in a student's week, which keeps its details card", () => {
    const html = renderToStaticMarkup(createElement(WeekGrid, { days: teacherDays, periods, today: 2, nowMinutes: 600, secondary: "teacher", perspective: "student" }));
    expect(html).not.toContain("data-week-classes");
    expect(classRows(html)).toEqual([]);
    expect(html).toContain('aria-live="polite"');
  });
});
