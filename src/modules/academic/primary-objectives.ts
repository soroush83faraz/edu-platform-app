// «کارنامهٴ توصیفی» — the vocabulary of the primary-school (دبستان, پایه ۱–۶) learning objectives: the canonical درس
// names with the spellings the school's documents use, the Jalali months of the school year, the three domains, and
// the shape of `scripts/data/primary-objectives.json` (written by scripts/build-primary-objectives.ts).
//
// Import-free on purpose: scripts/objectives-catalog.ts — part of the pg-only `scripts/seed-catalog.js` bundle the
// deploy runs inside the standalone image (scripts/build-seed-catalog.ts) — reads it, and so do the pages.

/** The domain tag a school attaches to an objective («دانشی / کاربردی / استدلالی»); most non-core درس‌ها have none. */
export type ObjectiveDomain = "knowledge" | "application" | "reasoning";
export const OBJECTIVE_DOMAINS: readonly ObjectiveDomain[] = ["knowledge", "application", "reasoning"];

export const DOMAIN_LABELS_FA: Record<ObjectiveDomain, string> = {
  knowledge: "دانشی",
  application: "کاربردی",
  reasoning: "استدلالی",
};

/**
 * The درس‌ها of the descriptive report card, in the order a report card lists them. `name` is the canonical name
 * stored in `academic.learning_objective.subject_name` (matching the textbook / the seeds' `tenancy.subject` names);
 * `aliases` are the headings the six source documents use and the names an organisation's own subject row may
 * carry — compared after `objectiveNameKey`.
 */
export const PRIMARY_SUBJECTS: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: "قرآن", aliases: ["آموزش قرآن", "قران"] },
  { name: "هدیه‌های آسمان", aliases: ["هدیه", "هدیه ها", "هدیه های آسمانی", "هدیه آسمان"] },
  { name: "فارسی", aliases: ["زبان فارسی", "فارسی خوانداری", "بخوانیم"] },
  { name: "ریاضی", aliases: ["ریاضیات"] },
  { name: "علوم تجربی", aliases: ["علوم"] },
  { name: "مطالعات اجتماعی", aliases: ["مطالعات"] },
  { name: "تفکر و پژوهش", aliases: ["تفکر", "تفکر و سبک زندگی"] },
  { name: "کار و فناوری", aliases: ["فناوری", "کار و فن آوری"] },
  { name: "هنر", aliases: ["آموزش هنر"] },
  { name: "تربیت بدنی", aliases: ["ورزش", "تربیت‌بدنی"] },
  { name: "شایستگی‌های عمومی", aliases: ["شایستگی", "شایستگی ها", "شایستگی عمومی", "شایستگی ها عمومی"] },
];

/**
 * The comparison key of a درس / heading name: Arabic yeh/kaf folded, ZWNJ, the written ezafe and every space
 * removed («هدیه‌های آسمان» = «هدیه های آسمان»). The seed's subject matching and the converter share it.
 */
export function objectiveNameKey(name: string): string {
  return name
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ٔٴ‌‍\s]/g, "");
}

const SUBJECT_BY_KEY = new Map<string, string>(
  PRIMARY_SUBJECTS.flatMap((s) => [s.name, ...s.aliases].map((n) => [objectiveNameKey(n), s.name] as const)),
);

/** The canonical درس of a heading / subject name, or null when it is none of the report-card درس‌ها. */
export function canonicalSubject(name: string): string | null {
  return SUBJECT_BY_KEY.get(objectiveNameKey(name)) ?? null;
}

/** Position of a canonical درس in the report-card order (unknown names sort last, alphabetically by caller). */
export function subjectOrder(name: string): number {
  const i = PRIMARY_SUBJECTS.findIndex((s) => s.name === name);
  return i === -1 ? PRIMARY_SUBJECTS.length : i;
}

/** Jalali month names, 1 = فروردین … 12 = اسفند. */
export const JALALI_MONTH_NAMES: readonly string[] = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

export function jalaliMonthName(month: number): string {
  return JALALI_MONTH_NAMES[month - 1] ?? "";
}

/** The months of a school year in their order: مهر (7) … اسفند (12), then فروردین (1) … خرداد (3). */
export const SCHOOL_MONTHS: readonly number[] = [7, 8, 9, 10, 11, 12, 1, 2, 3];

/** Index of a Jalali month inside the school year (مهر = 0); months outside it (تیر … شهریور) sort last. */
export function schoolMonthIndex(month: number): number {
  const i = SCHOOL_MONTHS.indexOf(month);
  return i === -1 ? SCHOOL_MONTHS.length : i;
}

/** The ordinal word of a primary grade («اول» … «ششم»), as the class names and the empty states use it. */
export const PRIMARY_GRADE_WORDS: readonly string[] = ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم"];

// ---------------------------------------------------------------------------------------------------------------
// the committed JSON (scripts/data/primary-objectives.json)
// ---------------------------------------------------------------------------------------------------------------

export interface PrimaryObjective {
  text: string;
  domain: ObjectiveDomain | null;
}

export interface PrimarySubjectBlock {
  /** Canonical name (`PRIMARY_SUBJECTS`). */
  name: string;
  objectives: PrimaryObjective[];
}

export interface PrimaryMonthBlock {
  /** Jalali month number (7 = مهر … 2 = اردیبهشت). */
  month: number;
  name: string;
  subjects: PrimarySubjectBlock[];
}

export interface PrimaryGradeBlock {
  /** 1…6. */
  grade: number;
  /** The fixed catalog's grade code (`G1` … `G6`, src/modules/tenancy/fixed-catalog.ts). */
  gradeCode: string;
  months: PrimaryMonthBlock[];
}

export interface PrimaryObjectivesFile {
  version: 1;
  /** Where the text came from (the six documents of the school), for humans. */
  source: string;
  grades: PrimaryGradeBlock[];
}
