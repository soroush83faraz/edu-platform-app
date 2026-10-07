// «هر کلاسِ دبیر یک رنگ جدا» (owner, 2026-10-06; docs/mockups/class-page-v3 screen 5): a TEACHER's live class
// offerings each get their own hue from the eight subject hues — a math teacher with five classes sees five colours —
// deterministically (sorted by درس, then class), independent of the order the reads return them in, and the same
// index everywhere the class appears for that teacher: the Home course cover, the timetable cells and class list, the
// subject page mark, the rows of that class. Students and admins keep the درس's hue (`subjectHue`). The Home cover
// side (`homeCourses`) is in tests/unit/home-courses.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubjectIcon, SubjectStamp, subjectHueClasses } from "@/components/SubjectStamp";
import { SUBJECT_HUES, offeringHue, subjectHue, teacherOfferingHues, type HueOffering } from "@/lib/subject-stamp";

const offering = (offeringId: string, subjectName: string, classGroupName: string, subjectId = `sub-${subjectName}`): HueOffering => ({ offeringId, subjectId, subjectName, classGroupName });

// The mock's teacher: ریاضی in four classes and فیزیک in one.
const FIVE = [offering("o-123", "ریاضی", "۱۲/۳"), offering("o-122", "ریاضی", "۱۲/۲"), offering("o-111", "ریاضی", "۱۱/۱"), offering("o-103", "ریاضی", "۱۰/۳"), offering("o-p103", "فیزیک", "۱۰/۳")];

/** Every permutation of a short list (5! = 120). */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("teacherOfferingHues", () => {
  it("gives each of up to eight offerings its own hue (0–7), the same درس in five classes included", () => {
    const hues = teacherOfferingHues(FIVE);
    expect(Object.keys(hues).sort()).toEqual(FIVE.map((o) => o.offeringId).sort());
    expect(new Set(Object.values(hues)).size).toBe(5);
    for (const h of Object.values(hues)) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(SUBJECT_HUES);
    }
    const eight = Array.from({ length: 8 }, (_, i) => offering(`o-${i}`, "ریاضی", `۱۰/${i + 1}`, "sub-math"));
    expect(new Set(Object.values(teacherOfferingHues(eight))).size).toBe(8);
  });

  it("is deterministic and does not depend on the order of the input", () => {
    const first = teacherOfferingHues(FIVE);
    expect(teacherOfferingHues(FIVE)).toEqual(first);
    for (const p of permutations(FIVE)) expect(teacherOfferingHues(p)).toEqual(first);
  });

  it("sorts by درس name, then class (numeric: «۹/۱» before «۱۰/۱»), and the first keeps its درس's own hue", () => {
    const list = [offering("b", "ریاضی", "۱۰/۱", "sub-math"), offering("a", "ریاضی", "۹/۱", "sub-math"), offering("c", "تاریخ", "۱۲/۱", "sub-history")];
    const hues = teacherOfferingHues(list);
    // تاریخ sorts before ریاضی; within ریاضی ۹/۱ before ۱۰/۱.
    const base = subjectHue("sub-history");
    expect(hues.c).toBe(base);
    expect(hues.a).toBe((base + 4) % 8);
    expect(hues.b).toBe((base + 2) % 8);
    // A one-class teacher sees what their students see.
    expect(teacherOfferingHues([list[0]])).toEqual({ b: subjectHue("sub-math") });
  });

  it("keeps neighbours in the sorted order far apart on the hue wheel (≥ 90°, i.e. ≥ 2 steps of 45°)", () => {
    const eight = Array.from({ length: 8 }, (_, i) => offering(`o-${i}`, "ریاضی", `کلاس ${i + 1}`, "sub-math"));
    const hues = teacherOfferingHues(eight);
    const ordered = eight.map((o) => hues[o.offeringId]);
    for (let i = 1; i < ordered.length; i++) {
      const d = Math.abs(ordered[i] - ordered[i - 1]);
      expect(Math.min(d, 8 - d)).toBeGreaterThanOrEqual(2);
    }
  });

  it("wraps after eight, counts an offering once, and is empty for someone who teaches nothing", () => {
    const ten = Array.from({ length: 10 }, (_, i) => offering(`o-${String(i).padStart(2, "0")}`, "ریاضی", `کلاس ${i + 1}`, "sub-math"));
    const hues = teacherOfferingHues(ten);
    expect(Object.keys(hues)).toHaveLength(10);
    expect(new Set(Object.values(hues)).size).toBe(8);
    expect(teacherOfferingHues([...FIVE, ...FIVE])).toEqual(teacherOfferingHues(FIVE));
    expect(teacherOfferingHues([])).toEqual({});
  });
});

describe("offeringHue", () => {
  it("is the teacher's own hue of a class they teach, else the درس's", () => {
    const hues = { "o-1": 6 };
    expect(offeringHue(hues, "o-1", "sub-x")).toBe(6);
    expect(offeringHue(hues, "o-2", "sub-x")).toBe(subjectHue("sub-x"));
    expect(offeringHue(hues, null, "sub-x")).toBe(subjectHue("sub-x"));
    expect(offeringHue(undefined, "o-1", "sub-x")).toBe(subjectHue("sub-x"));
    expect(offeringHue({ "o-1": 0 }, "o-1", "sub-x")).toBe(0); // hue 0 is a hue, not "none"
  });
});

describe("the marks wear the hue they are given", () => {
  const id = "0199a1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b";
  const own = (subjectHue(id) + 3) % 8;
  const cls = (html: string) => /^<span class="([^"]*)"/.exec(html)![1]!.split(" ");

  it("SubjectStamp and SubjectIcon: `hue` overrides the درس's hue; without it nothing changes", () => {
    for (const C of [SubjectStamp, SubjectIcon]) {
      const given = cls(renderToStaticMarkup(createElement(C, { subjectId: id, name: "ریاضی", hue: own })));
      expect(given).toContain(`bg-subject-${own}-bg`);
      expect(given).toContain(`text-subject-${own}-ink`);
      const plain = cls(renderToStaticMarkup(createElement(C, { subjectId: id, name: "ریاضی" })));
      expect(plain).toContain(`bg-subject-${subjectHue(id)}-bg`);
    }
  });

  it("subjectHueClasses (the timetable cells) takes the same override", () => {
    expect(subjectHueClasses(id, own)).toContain(`bg-subject-${own}-bg`);
    expect(subjectHueClasses(id)).toContain(`bg-subject-${subjectHue(id)}-bg`);
  });
});
