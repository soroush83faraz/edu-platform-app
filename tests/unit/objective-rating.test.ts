// «کارنامهٴ توصیفی» — the pure half: the four levels (labels, colours), the counts, the «ثبت‌شده» rule, the month a
// page opens on, and the Zod inputs of the report-card action and queries (`.strict()`, Persian messages).
import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_RATINGS,
  RATING_LABELS,
  RATING_ON_CLASSES,
  RATING_PILL_CLASSES,
  defaultReportMonth,
  emptyRatingCounts,
  isObjectiveRating,
  isSheetComplete,
  ratedTotal,
  ratingSummaryFa,
  tallyRatings,
} from "@/lib/objective-rating";
import { tehranJalaliMonth } from "@/lib/format";
import { MyReportCardInput, ReportClassInput, ReportPrintInput, ReportSheetInput, SaveObjectiveRatingsInput } from "@/modules/academic/dto";

const CG = "0199a000-000b-7000-8000-0000000000a1";
const SP = "0199a000-000d-7000-8000-0000000000a1";
const LO = "0199a000-00aa-7000-8000-0000000000a1";

describe("the four levels", () => {
  it("are the codes of the CHECK constraint, each with its Persian label", () => {
    expect([...OBJECTIVE_RATINGS]).toEqual(["very_good", "good", "acceptable", "needs_effort"]);
    expect(RATING_LABELS).toEqual({ very_good: "خیلی خوب", good: "خوب", acceptable: "قابل قبول", needs_effort: "نیاز به تلاش" });
    expect(isObjectiveRating("good")).toBe(true);
    expect(isObjectiveRating("excellent")).toBe(false);
    expect(isObjectiveRating(null)).toBe(false);
  });

  it("follow the colour discipline: success / primary / info / yellow FILL with navy text — never red", () => {
    expect(RATING_PILL_CLASSES.very_good).toContain("success");
    expect(RATING_PILL_CLASSES.good).toContain("primary");
    expect(RATING_PILL_CLASSES.acceptable).toContain("info-soft");
    expect(RATING_PILL_CLASSES.needs_effort).toBe("bg-warning text-text");
    expect(RATING_ON_CLASSES.needs_effort).toContain("data-[on=true]:bg-warning");
    expect(RATING_ON_CLASSES.needs_effort).toContain("data-[on=true]:text-text");
    for (const r of OBJECTIVE_RATINGS) {
      expect(RATING_PILL_CLASSES[r]).not.toMatch(/danger|red/);
      expect(RATING_ON_CLASSES[r]).not.toMatch(/danger|red|text-warning/);
    }
  });
});

describe("counts and completion", () => {
  it("tallies the levels, ignores unrated and unknown values, and summarises in Persian", () => {
    const c = tallyRatings(["very_good", "very_good", "good", null, undefined, "needs_effort", "x"]);
    expect(c).toEqual({ very_good: 2, good: 1, acceptable: 0, needs_effort: 1 });
    expect(ratedTotal(c)).toBe(4);
    expect(ratingSummaryFa(c)).toBe("۲ خیلی خوب · ۱ خوب · ۱ نیاز به تلاش");
    expect(ratingSummaryFa(emptyRatingCounts())).toBe("");
  });

  it("a student is «ثبت‌شده» only when every objective of the sheet has a level", () => {
    expect(isSheetComplete(["a", "b"], { a: "good", b: "acceptable" })).toBe(true);
    expect(isSheetComplete(["a", "b"], { a: "good" })).toBe(false);
    expect(isSheetComplete(["a", "b"], { a: "good", b: null })).toBe(false);
    expect(isSheetComplete([], {})).toBe(false);
  });
});

describe("defaultReportMonth", () => {
  const year = [7, 8, 9, 10, 11, 12, 1, 2];
  it("opens on the current month when the پایه has objectives for it", () => {
    expect(defaultReportMonth(year, 7)).toBe(7);
    expect(defaultReportMonth(year, 1)).toBe(1);
  });
  it("else on the nearest month of the school year (the earlier one on a tie), null without objectives", () => {
    expect(defaultReportMonth(year, 3)).toBe(2); // خرداد → اردیبهشت
    expect(defaultReportMonth(year, 5)).toBe(2); // مرداد: after the year → its last month
    expect(defaultReportMonth([8, 10], 9)).toBe(8); // آذر between آبان and دی → آبان
    expect(defaultReportMonth([], 7)).toBeNull();
  });
  it("tehranJalaliMonth reads the Jalali month in Tehran", () => {
    expect(tehranJalaliMonth(new Date("2026-10-13T08:00:00Z"))).toBe(7); // ۲۱ مهر ۱۴۰۵
    expect(tehranJalaliMonth(new Date("2026-10-22T21:00:00Z"))).toBe(8); // 00:30 Tehran, ۱ آبان
  });
});

describe("report-card inputs", () => {
  it("accept a sheet save with levels and nulls (clear), refuse unknown keys, levels and months", () => {
    const ok = SaveObjectiveRatingsInput.parse({ classGroupId: CG, month: 7, subjectName: " ریاضی ", entries: [{ studentProfileId: SP, learningObjectiveId: LO, rating: "good" }, { studentProfileId: SP, learningObjectiveId: CG, rating: null }] });
    expect(ok.subjectName).toBe("ریاضی");
    expect(ok.entries[1].rating).toBeNull();
    expect(() => SaveObjectiveRatingsInput.parse({ ...ok, organizationId: CG })).toThrow();
    expect(() => SaveObjectiveRatingsInput.parse({ ...ok, entries: [{ studentProfileId: SP, learningObjectiveId: LO, rating: "excellent" }] })).toThrow(/سطح ارزشیابی نامعتبر است/);
    expect(() => SaveObjectiveRatingsInput.parse({ ...ok, entries: [{ studentProfileId: SP, learningObjectiveId: LO, rating: "good", ratedBy: SP }] })).toThrow();
    expect(() => SaveObjectiveRatingsInput.parse({ ...ok, month: 13 })).toThrow(/ماه نامعتبر است/);
    expect(() => SaveObjectiveRatingsInput.parse({ ...ok, entries: [] })).toThrow(/چیزی برای ثبت نیست/);
    expect(() => SaveObjectiveRatingsInput.parse({ ...ok, classGroupId: "x" })).toThrow();
  });

  it("validate the read inputs the same way", () => {
    expect(ReportSheetInput.parse({ classGroupId: CG, month: 8, subjectName: "قرآن" })).toEqual({ classGroupId: CG, month: 8, subjectName: "قرآن" });
    expect(() => ReportSheetInput.parse({ classGroupId: CG, month: 8, subjectName: "" })).toThrow(/درس را انتخاب کنید/);
    expect(ReportClassInput.parse({ classGroupId: CG })).toEqual({ classGroupId: CG });
    expect(() => ReportPrintInput.parse({ classGroupId: CG })).toThrow();
    expect(ReportPrintInput.parse({ classGroupId: CG, month: 7, studentProfileId: SP }).studentProfileId).toBe(SP);
    expect(MyReportCardInput.parse({})).toEqual({});
    expect(() => MyReportCardInput.parse({ studentProfileId: SP })).toThrow();
  });
});
