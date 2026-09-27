// The phone week grid (src/components/timetable/WeekGrid): a lesson cell reads the درس's NAME (`cellSubjectLabel`,
// owner 2026-09-27), not the stamp's three letters; a دبیر's cell adds the class under it.
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
