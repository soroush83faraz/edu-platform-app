// The FIXED structure catalog of every organization (owner, 2026-09-27): three مقطع‌ها, the twelve Iranian پایه‌ها
// and the academic years the schools run on. Nobody edits these from the UI any more — the old «تنظیمات
// زیرساختی» section is gone — they are written by the catalog seed (`scripts/catalog.ts` → `ensureOrgCatalogWith`,
// which runs on every deploy and whenever a script creates an organization) and, for the years, by
// `ensureCatalogYears` in the tenancy service when a school is created from «مدرسه‌ها».
//
// Import-free on purpose: `scripts/build-seed-catalog.ts` compiles this module into the pg-only
// `scripts/seed-catalog.js` bundle that the deploy runs inside the standalone image (only relative imports, `pg`
// and `node:*` are allowed there). Codes are the natural keys (`education_level_org_code_uq`,
// `grade_level_org_code_uq`) and match what the seeds, the pilot data and the test fixtures already used
// (ELEM/SEC1/SEC2, G1…G12), so existing rows are REUSED; `aliases` catch a row an admin once typed by hand under
// another code (e.g. «ابتدایی»).

export interface FixedLevel {
  code: string;
  name: string;
  sequence: number;
  /** Other names the same مقطع may carry in an existing organization (compared after `catalogNameKey`). */
  aliases: readonly string[];
}

export interface FixedGrade {
  code: string;
  name: string;
  /** 1…12 — the grade number itself, so a class list sorts اول → دوازدهم across the three levels. */
  sequence: number;
  levelCode: string;
  aliases: readonly string[];
}

export interface FixedTerm {
  name: string;
  sequence: number;
  startsOn: string;
  endsOn: string;
}

export interface FixedYear {
  /** Stored exactly like the seeds always wrote it: Persian digits, ASCII hyphen. */
  name: string;
  startsOn: string;
  endsOn: string;
  /** The year a school runs NOW (1405–1406). Set only where the school has no current year yet — never flipped. */
  isCurrent: boolean;
  terms: readonly FixedTerm[];
}

export const FIXED_LEVELS: readonly FixedLevel[] = [
  { code: "ELEM", name: "دبستان", sequence: 1, aliases: ["ابتدایی", "دوره ابتدایی", "دبستان"] },
  { code: "SEC1", name: "متوسطهٴ اول", sequence: 2, aliases: ["متوسطه اول", "متوسطهٔ اول", "دوره اول متوسطه"] },
  { code: "SEC2", name: "متوسطهٴ دوم", sequence: 3, aliases: ["متوسطه دوم", "متوسطهٔ دوم", "دوره دوم متوسطه"] },
];

const GRADE_NAMES = ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم", "هفتم", "هشتم", "نهم", "دهم", "یازدهم", "دوازدهم"] as const;

/** 1–6 دبستان, 7–9 متوسطهٴ اول, 10–12 متوسطهٴ دوم. */
export function levelCodeOfGrade(n: number): string {
  return n <= 6 ? "ELEM" : n <= 9 ? "SEC1" : "SEC2";
}

export const FIXED_GRADES: readonly FixedGrade[] = GRADE_NAMES.map((name, i) => ({
  code: `G${i + 1}`,
  name,
  sequence: i + 1,
  levelCode: levelCodeOfGrade(i + 1),
  aliases: [`پایه ${name}`, `پایه‌ی ${name}`],
}));

export const FIXED_YEARS: readonly FixedYear[] = [
  {
    name: "۱۴۰۵-۱۴۰۶",
    startsOn: "2026-09-23",
    endsOn: "2027-06-21",
    isCurrent: true,
    terms: [
      { name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" },
      { name: "نوبت دوم", sequence: 2, startsOn: "2027-01-21", endsOn: "2027-06-21" },
    ],
  },
  {
    name: "۱۴۰۶-۱۴۰۷",
    startsOn: "2027-09-23",
    endsOn: "2028-06-20",
    isCurrent: false,
    terms: [
      { name: "نوبت اول", sequence: 1, startsOn: "2027-09-23", endsOn: "2028-01-20" },
      { name: "نوبت دوم", sequence: 2, startsOn: "2028-01-21", endsOn: "2028-06-20" },
    ],
  },
];

/**
 * The comparison key of a catalog NAME: Arabic yeh/kaf folded, the written ezafe (ٴ / ٔ), ZWNJ and every space
 * removed. «متوسطه اول», «متوسطهٔ اول» and «متوسطهٴ اول» are one مقطع. The seed's SQL applies the same folding.
 */
export function catalogNameKey(name: string): string {
  return name
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ٔٴ‌‍\s]/g, "");
}

/** The comparison key of a YEAR name: its digits only, Persian/Arabic folded to ASCII («۱۴۰۵-۱۴۰۶» → «14051406»). */
export function catalogYearKey(name: string): string {
  let out = "";
  for (const ch of name) {
    const p = "۰۱۲۳۴۵۶۷۸۹".indexOf(ch);
    const a = "٠١٢٣٤٥٦٧٨٩".indexOf(ch);
    if (p !== -1) out += String(p);
    else if (a !== -1) out += String(a);
    else if (ch >= "0" && ch <= "9") out += ch;
  }
  return out;
}
