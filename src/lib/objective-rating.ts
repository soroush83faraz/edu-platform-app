// «کارنامهٴ توصیفی» — the four levels a primary teacher gives each learning objective, their Persian labels, their
// colours, and the small pure math the pages share (counts, the «ثبت‌شده» rule, the month a page opens on). Pure and
// unit-tested (tests/unit/objective-rating.test.ts); the CHECK constraint of academic.objective_rating lists the
// same four codes.
//
// Colour (owner 2026-10-19, replacing the first scheme of docs/decisions.md «کارنامهٴ توصیفی»): «خیلی خوب» = success
// (green), «خوب» = primary (blue), «قابل قبول» = the yellow warning FILL with navy text (CLAUDE.md: yellow is a fill,
// never text), «نیاز به تلاش» = danger (red). Red here marks the one level that asks for the teacher's and the
// family's attention — it is shown as a soft pill/fill, never as a bare alarm.
import { canonicalSubject, schoolMonthIndex } from "@/modules/academic/primary-objectives";

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
  acceptable: "bg-warning text-text",
  needs_effort: "bg-danger-soft text-danger",
};

/** The pressed segment of the entry control (`data-on=true`), same hues as the pills but filled. */
export const RATING_ON_CLASSES: Record<ObjectiveRating, string> = {
  very_good: "data-[on=true]:bg-success data-[on=true]:text-white",
  good: "data-[on=true]:bg-primary-600 data-[on=true]:text-white",
  acceptable: "data-[on=true]:bg-warning data-[on=true]:text-text",
  needs_effort: "data-[on=true]:bg-danger data-[on=true]:text-white",
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

/** A `?month=` search param → a Jalali month 1..12, or undefined (the page / service picks the month). */
export function monthParam(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{1,2}$/.test(raw)) return undefined;
  const m = Number(raw);
  return m >= 1 && m <= 12 ? m : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// who writes which درس (owner, 2026-10-14)
// ---------------------------------------------------------------------------------------------------------------

/** An open offering of a class as the write rule sees it: the offering and its درس row (`tenancy.subject`). */
export interface OfferingSubject {
  offeringId: string;
  subjectId: string | null;
  subjectName: string | null;
}

/** A درس of the report card: its canonical name (`learning_objective.subject_name`) and the درس row its objectives link. */
export interface ReportSubject {
  name: string;
  subjectId: string | null;
}

/**
 * Is the offering one of درس `subject`? Its درس row is the one the objectives link (`subjectId`), or a row whose name
 * is that درس or one of its spellings (`canonicalSubject` — an organisation with «ریاضی» and «ریاضیات» rows links the
 * objectives to one of them, and an offering of the other is still ریاضی).
 */
export function offeringIsOfSubject(offering: OfferingSubject, subject: ReportSubject): boolean {
  if (subject.subjectId !== null && offering.subjectId === subject.subjectId) return true;
  return offering.subjectName !== null && canonicalSubject(offering.subjectName) === subject.name;
}

/** What the caller holds in ONE class (report-card `classRights`). */
export interface ClassWriteRights {
  /** `academic.objective_rating.write` at the class or above — the organisation admin, the principal, the vice. */
  writeAll: boolean;
  /** The class's open offerings at which the caller holds the write permission (their teaching). */
  mine: readonly OfferingSubject[];
  /** Every open offering of the class. */
  offerings: readonly OfferingSubject[];
}

/**
 * May the caller write درس `subject` of the class? (Owner, 2026-10-14 — narrowed from «any teacher of the class writes
 * every درس», which let the ورزش teacher overwrite ریاضی.) The class's management writes every درس; a teacher writes a
 * درس they teach in this class (one of `mine` is of it), and a درس the class has NO open offering of — e.g.
 * «شایستگی‌های عمومی», which no درس row carries — is written by any teacher of the class. Everyone else writes nothing.
 */
export function maySubjectWrite(rights: ClassWriteRights, subject: ReportSubject): boolean {
  if (rights.writeAll) return true;
  if (rights.mine.length === 0) return false;
  if (rights.mine.some((o) => offeringIsOfSubject(o, subject))) return true;
  return !rights.offerings.some((o) => offeringIsOfSubject(o, subject));
}
