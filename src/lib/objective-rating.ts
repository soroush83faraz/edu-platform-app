// «کارنامهٴ توصیفی» — the four levels a primary teacher gives each learning objective, their Persian labels, their
// colours, and the small pure math the pages share (counts, the «ثبت‌شده» rule, the month a page opens on). Pure and
// unit-tested (tests/unit/objective-rating.test.ts); the CHECK constraint of academic.objective_rating lists the
// same four codes.
//
// Colour (docs/decisions.md «کارنامهٴ توصیفی»): «خیلی خوب» = success, «خوب» = primary, «قابل قبول» = the soft info
// surface with navy text, «نیاز به تلاش» = the yellow warning FILL with navy text (CLAUDE.md: yellow is a fill,
// never text). No red: needing effort is not a failure, and red already means «a problem» in the product.
import { schoolMonthIndex } from "@/modules/academic/primary-objectives";

export const OBJECTIVE_RATINGS = ["very_good", "good", "acceptable", "needs_effort"] as const;
export type ObjectiveRating = (typeof OBJECTIVE_RATINGS)[number];

export const RATING_LABELS: Record<ObjectiveRating, string> = {
  very_good: "خیلی خوب",
  good: "خوب",
  acceptable: "قابل قبول",
  needs_effort: "نیاز به تلاش",
};

/** The pill a rating is shown as (student view, class view, print). Literal classes so Tailwind sees them. */
export const RATING_PILL_CLASSES: Record<ObjectiveRating, string> = {
  very_good: "bg-success-soft text-success",
  good: "bg-primary-50 text-primary-700",
  acceptable: "bg-info-soft text-primary-800",
  needs_effort: "bg-warning text-text",
};

/** The pressed segment of the entry control (`data-on=true`), same hues as the pills but filled. */
export const RATING_ON_CLASSES: Record<ObjectiveRating, string> = {
  very_good: "data-[on=true]:bg-success data-[on=true]:text-white",
  good: "data-[on=true]:bg-primary-600 data-[on=true]:text-white",
  acceptable: "data-[on=true]:bg-info data-[on=true]:text-text",
  needs_effort: "data-[on=true]:bg-warning data-[on=true]:text-text",
};

export function isObjectiveRating(v: unknown): v is ObjectiveRating {
  return typeof v === "string" && (OBJECTIVE_RATINGS as readonly string[]).includes(v);
}

export type RatingCounts = Record<ObjectiveRating, number>;

export function emptyRatingCounts(): RatingCounts {
  return { very_good: 0, good: 0, acceptable: 0, needs_effort: 0 };
}

/** Counts of the four levels; anything else (null = not rated) is ignored. */
export function tallyRatings(ratings: ReadonlyArray<string | null | undefined>): RatingCounts {
  const c = emptyRatingCounts();
  for (const r of ratings) if (isObjectiveRating(r)) c[r]++;
  return c;
}

export function ratedTotal(c: RatingCounts): number {
  return c.very_good + c.good + c.acceptable + c.needs_effort;
}

/** «۱۲ خیلی خوب · ۳ خوب · ۱ نیاز به تلاش» — zero levels left out; empty string when nothing is rated. */
export function ratingSummaryFa(c: RatingCounts): string {
  return OBJECTIVE_RATINGS.filter((r) => c[r] > 0)
    .map((r) => `${c[r].toLocaleString("fa-IR")} ${RATING_LABELS[r]}`)
    .join(" · ");
}

/**
 * «ثبت‌شده» for one student on one sheet (a month × درس): EVERY objective of the sheet has a rating. The progress line
 * «۱۸ از ۲۴ دانش‌آموز ثبت شده» counts these.
 */
export function isSheetComplete(objectiveIds: readonly string[], ratings: Readonly<Record<string, ObjectiveRating | null | undefined>>): boolean {
  return objectiveIds.length > 0 && objectiveIds.every((id) => isObjectiveRating(ratings[id]));
}

/**
 * The month a report-card page opens on: the current Jalali month when the class has objectives for it, else the
 * nearest month that has some (earlier one first on a tie — the last month taught beats next month), null when the
 * پایه has none. Months compare by their place in the school year (مهر … خرداد), so in تیر the nearest is خرداد/اردیبهشت.
 */
export function defaultReportMonth(available: readonly number[], current: number): number | null {
  if (available.length === 0) return null;
  if (available.includes(current)) return current;
  const at = schoolMonthIndex(current);
  return [...available].sort((a, b) => {
    const da = Math.abs(schoolMonthIndex(a) - at);
    const db = Math.abs(schoolMonthIndex(b) - at);
    return da - db || schoolMonthIndex(a) - schoolMonthIndex(b);
  })[0];
}
