// The converter's logic, pure (no I/O) so tests/unit/primary-objectives-parse.test.ts can exercise every rule:
// the text of the school's six Word files (scripts/data/primary-objectives-source.txt — one paragraph per line,
// `===== <file>` before each document, grades 1…6 in that order) → `PrimaryObjectivesFile` + a report of every
// change made to the school's wording. scripts/build-primary-objectives.ts is the CLI around it.
//
// Structure of the source: grade → month heading (many spellings) → درس heading → objective lines, most of the core
// درس‌ها carrying a domain tag in one of a dozen forms. The rules, in the order they run on an objective line:
//   1. characters: zero-width marks dropped, Arabic ي/ك folded, NBSP and tabs to spaces, ZWNJ tidied;
//   2. whole-line REWRITES (a few lines whose words Word's bidi reordered) and SPLITS (two objectives on one line);
//   3. a درس heading glued to the end of the line («…می کند.تربیت بدنی») is cut off;
//   4. the domain tag is taken off the end into `domain` (`DOMAIN_WORDS`);
//   5. leading/trailing punctuation goes; `TYPO_FIXES` (each one listed in the review);
//   6. orthography: «می کند» → «می‌کند», «نشانه ها» → «نشانه‌ها», «سوره ی» → «سوره‌ی», «ودر» → «و در», spacing around
//      «،» and parentheses — counted, not listed one by one;
//   7. MOVES (a line that sits under the wrong درس heading) and duplicates inside one درس.
// Nothing else of the school's wording changes.
import {
  canonicalSubject,
  jalaliMonthName,
  objectiveNameKey,
  PRIMARY_GRADE_WORDS,
  schoolMonthIndex,
  subjectOrder,
  type ObjectiveDomain,
  type PrimaryObjective,
  type PrimaryObjectivesFile,
} from "../src/modules/academic/primary-objectives";

export type EditKind = "typo" | "rewrite" | "split" | "move" | "glued-heading" | "duplicate" | "orphan" | "implied-month";

export interface ParseEdit {
  kind: EditKind;
  grade: number;
  month: number | null;
  subject: string | null;
  /** 1-based line of scripts/data/primary-objectives-source.txt. */
  line: number;
  before: string;
  after: string;
  note: string;
  /** A judgement call the school should confirm (listed separately in the review). */
  unsure: boolean;
}

/** A line kept exactly as written that the review asks the school about. */
export interface UnsureNote {
  grade: number;
  month: number;
  subject: string;
  line: number;
  text: string;
  note: string;
}

export interface ParseReport {
  edits: ParseEdit[];
  unsure: UnsureNote[];
  /** Raw درس heading (after character normalisation) → canonical name, with how often it occurs. */
  subjectHeadings: Array<{ raw: string; canonical: string; count: number }>;
  /** Every month heading as written. */
  monthHeadings: Array<{ grade: number; line: number; raw: string; month: number }>;
  /** Domain tag forms as written (the separator + word), with counts. */
  tagForms: Array<{ form: string; domain: ObjectiveDomain; count: number }>;
  /** Lines skipped as separators («…», «-----», «.»), titles or blanks. */
  skipped: number;
  /** How many objective texts the orthography step (rule 6) touched. */
  orthographyTouched: number;
}

// ---------------------------------------------------------------------------------------------------------------
// characters and keys
// ---------------------------------------------------------------------------------------------------------------

const ZWNJ = "‌";
const PERSIAN = "؀-ۿ";

/** Rule 1: what every line goes through first. */
export function normalizeChars(raw: string): string {
  return raw
    .replace(/[​‍‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[  \t]/g, " ")
    .replace(/‌{2,}/g, ZWNJ)
    .replace(/ *‌ */g, (m) => (m.includes(" ") ? " " : ZWNJ))
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/^‌+|‌+$/g, "");
}

/** A separator, a run of dots, a lone «.» — anything without a letter. */
export function isJunk(line: string): boolean {
  return !new RegExp(`[${PERSIAN}A-Za-z0-9]`).test(line);
}

/** Tokens of a heading candidate: ZWNJ → space, punctuation off, «مهرماه» → «مهر ماه». */
function headingTokens(line: string): string[] {
  return line
    .replace(/‌/g, " ")
    .replace(/[.:،؛\-—–_=()«»]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((t) => {
      const m = /^(.+)ماه$/.exec(t);
      return m && MONTHS_BY_NAME.has(m[1]) ? [m[1], "ماه"] : [t];
    });
}

const MONTHS_BY_NAME = new Map<string, number>([
  ["مهر", 7],
  ["آبان", 8],
  ["آذر", 9],
  ["دی", 10],
  ["بهمن", 11],
  ["اسفند", 12],
  ["فروردین", 1],
  ["اردیبهشت", 2],
  ["خرداد", 3],
]);

/** Words a month heading or a grade title may carry around the month name. */
const HEADING_FILLER = new Set(["اهداف", "آموزشی", "درسی", "توصیف", "عملکرد", "کارنامه", "توصیفی", "دانش", "آموز", "آموزان", "پایه", "دبستان", "ماه", ...PRIMARY_GRADE_WORDS]);

export type HeadingKind = { kind: "month"; month: number } | { kind: "title"; grade: number | null } | { kind: "subject"; name: string } | null;

/** Is this (normalised) line a month heading, a grade title, a درس heading — or an objective (null)? */
export function classifyHeading(line: string): HeadingKind {
  const subject = canonicalSubject(line.replace(/[.:،]+$/, ""));
  if (subject) return { kind: "subject", name: subject };
  const tokens = headingTokens(line);
  if (tokens.length === 0 || tokens.length > 9) return null;
  const rest = tokens.filter((t) => !HEADING_FILLER.has(t));
  if (rest.length === 1 && MONTHS_BY_NAME.has(rest[0])) return { kind: "month", month: MONTHS_BY_NAME.get(rest[0])! };
  if (rest.length === 0 && tokens.includes("پایه")) {
    const g = PRIMARY_GRADE_WORDS.findIndex((w) => tokens.includes(w));
    return { kind: "title", grade: g === -1 ? null : g + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// the domain tag (rule 4)
// ---------------------------------------------------------------------------------------------------------------

/** Every spelling of a domain word the documents use, incl. the two typos «گاربردی» and «کاربرد». */
export const DOMAIN_WORDS: Record<string, ObjectiveDomain> = {
  دانشی: "knowledge",
  کاربردی: "application",
  کاربرد: "application",
  گاربردی: "application",
  استدلالی: "reasoning",
  استدلال: "reasoning",
};
const TAG = Object.keys(DOMAIN_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * The four shapes a tag takes at the end of a line: after a dash-like run («---دانشی», «— کاربردی», «ــ استدلالی»,
 * «==دانشی», «---: استدلالی», «-- کاربردی.»), in parentheses («(دانشی)», «( کاربردی)», «(استدلالی» without the
 * closing one), as a bare word after a full stop («… می‌کند. دانشی»), or after a wide gap («…  استدلالی»).
 */
const TAG_PATTERNS: RegExp[] = [
  new RegExp(`^(.*?)[\\s.]*(?:-+|—+|–+|ـ+|=+)\\s*:?\\s*(${TAG})\\s*\\.*\\s*$`),
  new RegExp(`^(.*?)[\\s.]*\\(\\s*(${TAG})\\s*\\)?[\\s.]*$`),
  new RegExp(`^(.*?\\.)\\s*(${TAG})\\s*$`),
  new RegExp(`^(.*?)\\s{2,}(${TAG})\\s*$`),
];

/** The separator of a tag without its length / spacing / full stops («. ---- دانشی» → «---دانشی»), for the review. */
export function tagShape(form: string): string {
  return form
    .replace(/[.\s]/g, "")
    .replace(/-+/g, "---")
    .replace(/—+/g, "—")
    .replace(/ـ+/g, "ــ")
    .replace(/=+/g, "==");
}

export interface Tagged {
  text: string;
  domain: ObjectiveDomain | null;
  /** The tag as written (separator + word), for the review's table of forms. */
  form: string | null;
}

/** Rule 4. Works on the RAW (rule-1) line so the «two spaces» shape is still visible. */
export function extractDomain(line: string): Tagged {
  for (const re of TAG_PATTERNS) {
    const m = re.exec(line);
    if (m) {
      const word = m[2];
      const form = line.slice(m[1].length).trim();
      return { text: m[1], domain: DOMAIN_WORDS[word], form };
    }
  }
  return { text: line, domain: null, form: null };
}

// ---------------------------------------------------------------------------------------------------------------
// the school's wording: explicit fixes (rule 5), orthography (rule 6)
// ---------------------------------------------------------------------------------------------------------------

interface Fix {
  find: RegExp;
  to: string;
  note: string;
  unsure?: boolean;
}

/** Rule 5 — every one is a certain typo of the source; each occurrence is listed in the review. */
export const TYPO_FIXES: readonly Fix[] = [
  { find: new RegExp(`(^|[^${PERSIAN}])بداشت`, "g"), to: "$1بهداشت", note: "«بداشت» → «بهداشت»" },
  { find: /می شناسدت/g, to: "می شناسد", note: "حرف اضافهٔ «ت» در پایان فعل" },
  { find: /می[ ‌]کن$/g, to: "می‌کند", note: "فعل ناتمام «می‌کن» → «می‌کند»" },
  { find: /می[ ‌]ده$/g, to: "می دهد", note: "فعل ناتمام «می ده» → «می دهد»" },
  { find: /می هد/g, to: "می دهد", note: "«می هد» → «می دهد»" },
  { find: /زبان[ ‌]?نویسی/g, to: "زیبانویسی", note: "«زبان‌نویسی» → «زیبانویسی» (همین هدف در ماه‌های دیگر «زیبانویسی» است)" },
  { find: /موثردارد/g, to: "موثر دارد", note: "فاصلهٔ جاافتاده" },
  { find: /آموزگارگوش/g, to: "آموزگار گوش", note: "فاصلهٔ جاافتاده" },
  { find: /فطرآشنایی/g, to: "فطر آشنایی", note: "فاصلهٔ جاافتاده" },
  { find: /شعرریتم/g, to: "شعر ریتم", note: "فاصلهٔ جاافتاده" },
  { find: /رانام/g, to: "را نام", note: "فاصلهٔ جاافتاده" },
  { find: /موردزندگی/g, to: "مورد زندگی", note: "فاصلهٔ جاافتاده" },
  { find: /پذیراست/g, to: "پذیر است", note: "فاصلهٔ جاافتاده" },
  { find: /را ه های/g, to: "راه های", note: "فاصلهٔ اضافه در «راه»" },
  { find: /در ک کرده/g, to: "درک کرده", note: "فاصلهٔ اضافه در «درک»" },
  { find: /آب و هوا ی /g, to: "آب و هوای ", note: "فاصلهٔ اضافه در «هوای»" },
  { find: / و و /g, to: " و ", note: "«و» تکراری" },
  { find: / به به /g, to: " به ", note: "«به» تکراری" },
  { find: /اجرای اجرای/g, to: "اجرای", note: "«اجرای» تکراری" },
  { find: / ر دارد/g, to: " را دارد", note: "«ر» → «را»" },
  { find: /تعادلپ/g, to: "تعادل", note: "حرف اضافهٔ «پ»" },
  { find: /جمله\. را/g, to: "جمله را", note: "نقطهٔ اضافه وسط جمله" },
  { find: /\.و /g, to: " و ", note: "نقطهٔ اضافه پیش از «و»" },
  { find: /قرآن عه نشان/g, to: "قرآن علاقه نشان", note: "«عه» → «علاقه» (کلمهٔ بریده)" },
  { find: /متنی خالق/g, to: "متنی خلاق", note: "«خالق» → «خلاق»" },
  { find: /کالس/g, to: "کلاس", note: "«لا» وارونه در استخراج متن: «کالس» → «کلاس»" },
  { find: /عالئم/g, to: "علائم", note: "«لا» وارونه در استخراج متن: «عالئم» → «علائم»" },
  { find: /دالیل/g, to: "دلایل", note: "«لا» وارونه در استخراج متن: «دالیل» → «دلایل»" },
  { find: /جرئیات/g, to: "جزئیات", note: "«جرئیات» → «جزئیات»" },
  { find: /وازه سازی/g, to: "واژه سازی", note: "«وازه» → «واژه»" },
  { find: /به کا می/g, to: "به کار می", note: "«به کا» → «به کار»" },
  { find: /موقعیت مسئله های/g, to: "موقعیت مسئله‌ای", note: "«موقعیت مسئله های» → «موقعیت مسئله‌ای»" },
  { find: /ابراز های مختلف/g, to: "ابزار های مختلف", note: "«ابراز» → «ابزار»" },
  { find: /ویژگهای/g, to: "ویژگی های", note: "«ویژگهای» → «ویژگی‌های»" },
  { find: /مناسبت ترین/g, to: "مناسب ترین", note: "«مناسبت ترین» → «مناسب‌ترین»" },
  { find: /بیمهره/g, to: "بی‌مهره", note: "«بیمهره» → «بی‌مهره»" },
  { find: /(^|\s)ان ها/g, to: "$1آن ها", note: "«ان ها» → «آن‌ها»" },
  { find: /اندازهگیری/g, to: "اندازه‌گیری", note: "نیم‌فاصلهٔ جاافتاده" },
  { find: /بخشپذیر/g, to: "بخش‌پذیر", note: "نیم‌فاصلهٔ جاافتاده" },
];

/** Words where «و» was typed onto the next word («ودر» = «و در»); every one checked against the source. */
export const JOINED_WAW = [
  "وآثار", "وآمادگی", "وتحلیل", "وتحولات", "وتشخیص", "وتفاوت", "وتوضیح", "وحضور", "وحفاظت", "ودر", "ودوستان", "ودیگران",
  "وزیبا", "وستون", "وعبارات", "وعبارت", "وفردی", "وفعالیت", "ومتضاد", "ومفهوم", "ومقوا", "ومهارت", "ونام", "ونسبت",
] as const;

/** ZWNJ-dropped forms of the source («میکند», «نحوهی») → the written form. */
const GLUED: ReadonlyArray<readonly [string, string]> = [
  ["میکند", "می‌کند"],
  ["میدهد", "می‌دهد"],
  ["میآورد", "می‌آورد"],
  ["نحوهی", "نحوه‌ی"],
  ["رابطهی", "رابطه‌ی"],
  ["سازندهی", "سازنده‌ی"],
];

const WORD_END = `(?=$|[\\s.،:؛)»])`;

/** Letters that never join the next one: a suffix after them needs no ZWNJ. */
const NON_JOINING = "اآأإدذرزژو";

/** Rule 6: the orthography of the written language — no word of the school changes. */
export function orthography(s: string): string {
  let out = s;
  for (const w of JOINED_WAW) out = out.replace(new RegExp(`(^|\\s)${w}${WORD_END}`, "g"), `$1و ${w.slice(1)}`);
  for (const [from, to] of GLUED) out = out.replace(new RegExp(`(^|\\s)${from}${WORD_END}`, "g"), `$1${to}`);
  out = out
    // «می کند» / «نمی کند» → «می‌کند»
    .replace(new RegExp(`(^|[\\s(])(ن?می) (?=[${PERSIAN}])`, "g"), `$1$2${ZWNJ}`)
    // «نشانه ها» → «نشانه‌ها», «ابزار ها» → «ابزارها» (no ZWNJ after a letter that never joins), «راههای» → «راه‌های»
    .replace(new RegExp(`([${PERSIAN}]) (ها|های|هایی|هایش|هایشان)${WORD_END}`, "g"), (_m, c: string, suffix: string) => `${c}${NON_JOINING.includes(c) ? "" : ZWNJ}${suffix}`)
    .replace(new RegExp(`([${PERSIAN}]ه)(ها|های|هایی)${WORD_END}`, "g"), `$1${ZWNJ}$2`)
    // «سوره ی» → «سوره‌ی»
    .replace(new RegExp(`ه ی${WORD_END}`, "g"), `ه${ZWNJ}ی`)
    // punctuation spacing
    .replace(/\s+([،.:؛)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(new RegExp(`([${PERSIAN}])\\(`, "g"), "$1 (")
    .replace(/،(?=\S)/g, "، ")
    .replace(/ {2,}/g, " ")
    .trim();
  return out;
}

/** Leading full stops / commas (bidi debris: «.نمونه هایی …») and trailing dots go. */
function trimPunctuation(s: string): string {
  return s.replace(/^[\s.،:؛]+/, "").replace(/[\s.،:؛…]+$/, "").trim();
}

// ---------------------------------------------------------------------------------------------------------------
// the few lines that need a hand (rules 2 and 7)
// ---------------------------------------------------------------------------------------------------------------

/** Whitespace-insensitive comparison key of a line. */
const lineKey = (s: string) => s.replace(/[\s‌]/g, "");

interface Rewrite {
  grade: number;
  from: string;
  to: string;
  note: string;
  unsure: boolean;
}

/** Whole lines whose words Word's right-to-left run order scrambled (compared with `lineKey`). */
export const REWRITES: readonly Rewrite[] = [
  { grade: 3, from: "را می داند بیان موارد کاربرد شناسنامه", to: "بیان موارد کاربرد شناسنامه را می داند", note: "ترتیب کلمه‌ها در استخراج متن به‌هم ریخته بود", unsure: true },
  { grade: 3, from: "را رعایت می کند.بهداشت و ایمنی", to: "بهداشت و ایمنی را رعایت می کند", note: "ترتیب کلمه‌ها در استخراج متن به‌هم ریخته بود", unsure: false },
  { grade: 3, from: "درست مصرف کردن را می داند. روش های", to: "روش های درست مصرف کردن را می داند", note: "ترتیب کلمه‌ها در استخراج متن به‌هم ریخته بود", unsure: false },
  {
    grade: 4,
    from: "با توجه به مسیر گوارش، نقش بخش های مختلف دستگاه گوارش را در فرایند هضم توضیح داده و ارتباط — استدلالی نحوه عملکرد دستگاه گوارش را می داند",
    to: "با توجه به مسیر گوارش، نقش بخش های مختلف دستگاه گوارش را در فرایند هضم توضیح داده و ارتباط نحوه عملکرد دستگاه گوارش را می داند — استدلالی",
    note: "برچسب «استدلالی» وسط جمله افتاده بود؛ به پایان آن برده شد",
    unsure: true,
  },
];

interface Split {
  grade: number;
  month: number;
  /** The line contains this (lineKey) … */
  contains: string;
  /** … and is cut right before this text. */
  before: string;
}

/** Two objectives that ended up in one paragraph (the same two are separate lines in every other month). */
export const SPLITS: readonly Split[] = [
  { grade: 2, month: 11, contains: "بیانمیکندبادقتبهسخنان", before: "با دقت به سخنان" },
  { grade: 2, month: 1, contains: "احتراممیگذارد.درکلاسحضور", before: "در کلاس حضور" },
];

interface Move {
  grade: number;
  month: number;
  from: string;
  to: string;
  /** The objective's text starts with this (lineKey). */
  startsWith: string;
  at: "start" | "end";
  note: string;
}

/** Lines that sit under the wrong درس heading in the source. */
export const MOVES: readonly Move[] = [
  { grade: 3, month: 9, from: "قرآن", to: "هنر", startsWith: "ازابزارهایمختلف", at: "start", note: "هدف هنر زیر عنوان «قرآن» آمده بود (در ماه‌های دیگر نخستین هدف هنر است)" },
  { grade: 3, month: 9, from: "هنر", to: "تربیت بدنی", startsWith: "مهارتدرانجامحرکاتپایه", at: "start", note: "هدف تربیت بدنی پیش از عنوان «تربیت بدنی» آمده بود" },
  { grade: 5, month: 10, from: "هنر", to: "تربیت بدنی", startsWith: "مهارتهایمربوطبهطنابزنی", at: "end", note: "عنوان «تربیت بدنی» در این ماه جا افتاده بود" },
  { grade: 5, month: 10, from: "هنر", to: "تربیت بدنی", startsWith: "درفعالیتهایورزشیروحیههمکاری", at: "end", note: "عنوان «تربیت بدنی» در این ماه جا افتاده بود" },
];

/** Objective lines that come before any درس heading of their month → the درس they belong to. */
export const ORPHANS: ReadonlyArray<{ grade: number; month: number; subject: string; note: string }> = [
  { grade: 2, month: 8, subject: "قرآن", note: "عنوان «قرآن» در آغاز آبان جا افتاده بود (همان هدف‌های قرآنِ مهر)" },
];

/** Lines kept as written that the school should look at (matched by grade, month and the start of the text). */
export const UNSURE_KEPT: ReadonlyArray<{ grade: number; month: number; subject: string; startsWith: string; note: string }> = [
  { grade: 2, month: 7, subject: "فارسی", startsWith: "باصداهاینشانه", note: "«آنها به درستی تشخیص می دهد» — احتمالاً «را» جا افتاده است" },
  { grade: 2, month: 8, subject: "ریاضی", startsWith: "تکالیفخودراشخصا", note: "زیر عنوان «ریاضی» آمده؛ در ماه‌های دیگر هدف «شایستگی‌های عمومی» است" },
  { grade: 3, month: 12, subject: "تربیت بدنی", startsWith: "رعایتبهداشتوایمنی", note: "زیر «تربیت بدنی» و درست پیش از عنوان «شایستگی‌های عمومی» آمده؛ شاید هدف شایستگی باشد" },
  { grade: 4, month: 12, subject: "هنر", startsWith: "روشتذکردادن", note: "زیر «هنر» آمده ولی به شایستگی یا مطالعات می‌ماند" },
  { grade: 4, month: 1, subject: "هنر", startsWith: "درریتموگیم", note: "«وگیم» — شاید «و گام» باشد؛ دست نخورد" },
  { grade: 4, month: 9, subject: "مطالعات اجتماعی", startsWith: "باکارجغرافیدان", note: "جمله ناقص است («با کار جغرافی‌دان … را می‌داند»)" },
  { grade: 6, month: 7, subject: "هدیه‌های آسمان", startsWith: "بانقشپیامبران", note: "«با نقش پیامبران … را آشناست» — «را» زائد به نظر می‌رسد" },
];

// ---------------------------------------------------------------------------------------------------------------
// the parser
// ---------------------------------------------------------------------------------------------------------------

interface Working {
  objectives: Array<PrimaryObjective & { line: number }>;
  firstLine: number;
}

export interface ParseResult {
  file: PrimaryObjectivesFile;
  report: ParseReport;
}

const GRADE_COUNT = 6;

export function parseObjectivesText(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const edits: ParseEdit[] = [];
  const unsure: UnsureNote[] = [];
  const headingCounts = new Map<string, { canonical: string; count: number }>();
  const monthHeadings: ParseReport["monthHeadings"] = [];
  const tagForms = new Map<string, { domain: ObjectiveDomain; count: number }>();
  let skipped = 0;
  let orthographyTouched = 0;

  /** grade → month → subject → objectives */
  const data = new Map<number, Map<number, Map<string, Working>>>();
  let grade = 0;
  let month: number | null = null;
  let subject: string | null = null;

  const bucket = (g: number, m: number, s: string, line: number): Working => {
    let byMonth = data.get(g);
    if (!byMonth) data.set(g, (byMonth = new Map()));
    let bySubject = byMonth.get(m);
    if (!bySubject) byMonth.set(m, (bySubject = new Map()));
    let w = bySubject.get(s);
    if (!w) bySubject.set(s, (w = { objectives: [], firstLine: line }));
    return w;
  };
  const edit = (e: Omit<ParseEdit, "grade" | "month" | "subject"> & { subject?: string | null }) =>
    edits.push({ grade, month, subject: e.subject ?? subject, kind: e.kind, line: e.line, before: e.before, after: e.after, note: e.note, unsure: e.unsure });

  const addObjective = (rawText: string, lineNo: number) => {
    if (month === null) {
      month = 7;
      edit({ kind: "implied-month", line: lineNo, before: "", after: "مهر", note: "سند این پایه پیش از نخستین درس عنوان ماه ندارد؛ «مهر» در نظر گرفته شد", unsure: false });
    }
    if (subject === null) {
      const orphan = ORPHANS.find((o) => o.grade === grade && o.month === month);
      if (!orphan) throw new Error(`line ${lineNo}: objective before any درس heading (grade ${grade}, month ${month}): ${rawText}`);
      subject = orphan.subject;
      edit({ kind: "orphan", line: lineNo, before: "", after: orphan.subject, note: orphan.note, unsure: false });
    }
    let text = rawText;
    // rule 3: a heading glued onto the end («… می کند.تربیت بدنی»)
    const glued = new RegExp(`^(.*[${PERSIAN}])\\s*[.،]\\s*([${PERSIAN} ‌]+)$`).exec(text);
    if (glued && canonicalSubject(glued[2]) === subject) {
      edit({ kind: "glued-heading", line: lineNo, before: text, after: glued[1], note: `عنوان «${glued[2].trim()}» به انتهای هدف چسبیده بود`, unsure: false });
      text = glued[1];
    }
    // rule 4
    const tagged = extractDomain(text);
    if (tagged.form && tagged.domain) {
      const form = tagShape(tagged.form);
      const t = tagForms.get(form) ?? { domain: tagged.domain, count: 0 };
      t.count++;
      tagForms.set(form, t);
    }
    // rule 5
    let t = trimPunctuation(tagged.text);
    for (const fix of TYPO_FIXES) {
      fix.find.lastIndex = 0;
      if (fix.find.test(t)) {
        fix.find.lastIndex = 0;
        const after = t.replace(fix.find, fix.to);
        edit({ kind: "typo", line: lineNo, before: t, after, note: fix.note, unsure: fix.unsure ?? false });
        t = after;
      }
    }
    t = trimPunctuation(t);
    // rule 6
    const o = orthography(t);
    if (o !== t) orthographyTouched++;
    t = trimPunctuation(o);
    if (t === "") return;

    // rule 7: moves, then duplicates
    let target = subject;
    let at: "start" | "end" = "end";
    const move = MOVES.find((mv) => mv.grade === grade && mv.month === month && mv.from === subject && lineKey(t).startsWith(mv.startsWith));
    if (move) {
      target = move.to;
      at = move.at;
      edit({ kind: "move", line: lineNo, before: `${subject}: ${t}`, after: `${move.to}: ${t}`, note: move.note, unsure: true, subject: move.from });
    }
    const w = bucket(grade, month, target, lineNo);
    if (w.objectives.some((x) => lineKey(x.text) === lineKey(t))) {
      edit({ kind: "duplicate", line: lineNo, before: t, after: "", note: "همین هدف در همین درس و ماه تکرار شده بود؛ یک بار نگه داشته شد", unsure: false, subject: target });
      return;
    }
    const kept = UNSURE_KEPT.find((u) => u.grade === grade && u.month === month && u.subject === target && lineKey(t).startsWith(u.startsWith));
    if (kept) unsure.push({ grade, month, subject: target, line: lineNo, text: t, note: kept.note });
    const obj = { text: t, domain: tagged.domain, line: lineNo };
    if (at === "start") w.objectives.unshift(obj);
    else w.objectives.push(obj);
  };

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    if (rawLine.startsWith("=====")) {
      grade++;
      if (grade > GRADE_COUNT) throw new Error(`line ${lineNo}: more than ${GRADE_COUNT} documents`);
      month = null;
      subject = null;
      return;
    }
    const line = normalizeChars(rawLine);
    if (line === "" || isJunk(line)) {
      skipped++;
      return;
    }
    if (grade === 0) throw new Error(`line ${lineNo}: text before the first ===== document marker`);
    const heading = classifyHeading(line);
    if (heading?.kind === "title") {
      if (heading.grade !== null && heading.grade !== grade) throw new Error(`line ${lineNo}: title of grade ${heading.grade} inside document ${grade}`);
      skipped++;
      return;
    }
    if (heading?.kind === "month") {
      if (data.get(grade)?.has(heading.month)) throw new Error(`line ${lineNo}: month ${heading.month} appears twice in grade ${grade}`);
      monthHeadings.push({ grade, line: lineNo, raw: line, month: heading.month });
      month = heading.month;
      subject = null;
      return;
    }
    if (heading?.kind === "subject") {
      const raw = line.replace(/[.:،]+$/, "");
      const h = headingCounts.get(raw) ?? { canonical: heading.name, count: 0 };
      h.count++;
      headingCounts.set(raw, h);
      if (month === null) {
        month = 7;
        edit({ kind: "implied-month", line: lineNo, before: "", after: "مهر", note: "سند این پایه پیش از نخستین درس عنوان ماه ندارد؛ «مهر» در نظر گرفته شد", unsure: false });
      }
      subject = heading.name;
      return;
    }

    // An objective line: rewrites and splits first (rule 2).
    let text = line;
    const rewrite = REWRITES.find((r) => r.grade === grade && lineKey(r.from) === lineKey(text));
    if (rewrite) {
      edit({ kind: "rewrite", line: lineNo, before: text, after: rewrite.to, note: rewrite.note, unsure: rewrite.unsure });
      text = rewrite.to;
    }
    const split = SPLITS.find((s) => s.grade === grade && s.month === month && lineKey(text).includes(s.contains));
    if (split) {
      const at = text.indexOf(split.before);
      if (at <= 0) throw new Error(`line ${lineNo}: split marker not found`);
      const parts = [text.slice(0, at), text.slice(at)];
      edit({ kind: "split", line: lineNo, before: text, after: parts.map((p) => p.trim()).join(" ⟂ "), note: "دو هدف در یک سطر آمده بود؛ از هم جدا شد", unsure: false });
      for (const p of parts) addObjective(p.trim(), lineNo);
      return;
    }
    addObjective(text, lineNo);
  });

  if (grade !== GRADE_COUNT) throw new Error(`expected ${GRADE_COUNT} documents, found ${grade}`);

  const file: PrimaryObjectivesFile = {
    version: 1,
    source: "اهداف آموزشی / توصیف عملکرد پایه‌های اول تا ششم (شش فایل Word مدرسه)؛ تبدیل‌شده با scripts/build-primary-objectives.ts",
    grades: [...data.entries()]
      .sort(([a], [b]) => a - b)
      .map(([g, byMonth]) => ({
        grade: g,
        gradeCode: `G${g}`,
        months: [...byMonth.entries()]
          .sort(([a], [b]) => schoolMonthIndex(a) - schoolMonthIndex(b))
          .map(([m, bySubject]) => ({
            month: m,
            name: jalaliMonthName(m),
            subjects: [...bySubject.entries()]
              .sort(([a], [b]) => subjectOrder(a) - subjectOrder(b))
              .map(([name, w]) => ({ name, objectives: w.objectives.map(({ text, domain }) => ({ text, domain })) })),
          })),
      })),
  };

  return {
    file,
    report: {
      edits,
      unsure,
      subjectHeadings: [...headingCounts.entries()].map(([raw, v]) => ({ raw, canonical: v.canonical, count: v.count })).sort((a, b) => subjectOrder(a.canonical) - subjectOrder(b.canonical) || a.raw.localeCompare(b.raw, "fa")),
      monthHeadings,
      tagForms: [...tagForms.entries()].map(([form, v]) => ({ form, domain: v.domain, count: v.count })).sort((a, b) => b.count - a.count),
      skipped,
      orthographyTouched,
    },
  };
}

/** Objectives per (grade, month, درس) — the review's table and the unit test's snapshot. */
export function countObjectives(file: PrimaryObjectivesFile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of file.grades) for (const m of g.months) for (const s of m.subjects) out[`${g.grade}:${m.month}:${s.name}`] = s.objectives.length;
  return out;
}

/** The comparison key used for subject matching (re-exported for the seed). */
export { objectiveNameKey };
