// «مُهر درس» — the subject stamp's pure rules: a two-to-four-letter abbreviation of the subject name and a stable
// colour index (0–7) from the subject's id. Both are ported verbatim from the owner-approved swatch page
// (docs/decisions.md «مُهر درس»); the component is src/components/SubjectStamp.tsx.

/** Number of subject hues (`--color-subject-{0..7}-bg` / `-ink` in globals.css). */
export const SUBJECT_HUES = 8;

/**
 * Names whose first three letters read badly or collide, keyed by the first significant word after
 * normalisation. «علوم‌وفنون» is the joined key for «علوم و فنون ادبی» (else «علو», the same as علوم تجربی).
 */
const OVERRIDES: Record<string, string> = {
  "تربیت": "ورز", // تربیت بدنی
  "ورزش": "ورز",
  "آمادگی": "دفا", // آمادگی دفاعی (else «آما», the same as آمار)
  "قرآن": "قرآن", // «قرآ» looks cut
  "تفکر": "تفکر", // تفکر و سواد رسانه‌ای («تفک» looks cut)
  "علوم‌وفنون": "فنون", // علوم و فنون ادبی
};
/** «زبان انگلیسی» → the second word carries the meaning. */
const HEAD_SKIP = new Set(["زبان"]);

/**
 * The stamp's text: normalise ي→ی / ك→ک, strip harakat, split on whitespace / ZWNJ / «،» / punctuation / digits,
 * drop a leading «زبان» when more words follow, then an override or the first three letters of the first word.
 */
export function stampText(name: string): string {
  const norm = normalizeName(name);
  let words = norm.split(/[\s‌،,.\-–—/()0-9۰-۹]+/).filter(Boolean);
  if (words[0] === "علوم" && words[1] === "و" && words[2] === "فنون") words = ["علوم‌وفنون"];
  if (words.length > 1 && HEAD_SKIP.has(words[0])) words = words.slice(1);
  const w = words[0] ?? "";
  return OVERRIDES[w] ?? [...w].slice(0, 3).join("");
}

/** NFC, ي→ی / ك→ک, harakat stripped, trimmed — the shared first step of every rule here (and of `subjectIcon`). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ً-ْٰ]/g, "")
    .trim();
}

/**
 * Letters one line of a phone timetable cell holds: a 40.4 px day column of the seven EQUAL-width columns
 * (360 px phone, no side padding, owner 2026-09-27: جمعه is the same width as every other day), at `text-cell`
 * (11 px, weight 600) — the widest lines measured in Vazirmatn («جغرافیای» 40.1, «هدیه‌های» 41.6, «آزمایشگاه»
 * 41.5 px) still fit, as they did in the six-column grid (42.3 px).
 */
const CELL_LINE_LETTERS = 7;
const ZWNJ = "\u200c";
/** Width proxy of a line: every code point except the zero-width non-joiner. */
const letters = (s: string) => [...s].filter((ch) => ch !== ZWNJ).length;

/**
 * The درس name as it reads in a cell of the phone week grid (owner 2026-09-27: the name, not the stamp letters), as
 * one or two lines of at most ~seven letters each:
 * 1. normalise as `stampText` does; keep only the clause before a «،» / «:» / «(» / dash / slash (a subtitle such
 *    as «عربی، زبان قرآن» → «عربی»), and drop a trailing book number («ریاضی ۲» → «ریاضی») — the class and the
 *    details card carry the rest;
 * 2. the connector «و» sticks to the word before it («دین و» / «زندگی»);
 * 3. a single word too long for one line breaks at its ZWNJ («زیست‌شناسی» → «زیست» / «شناسی»);
 * 4. otherwise words fill line 1 while it fits and line 2 takes the rest («زبان» / «انگلیسی») — a line 2 that is
 *    still too long is cut with an ellipsis by the cell (`truncate`), never overflowing it.
 * The full name stays in the cell's accessible name and in the details card.
 */
export function cellSubjectLabel(name: string): string[] {
  const head = normalizeName(name).split(/[،,:;(\-–—/]/)[0] ?? "";
  const words = head.split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^[0-9۰-۹]+$/.test(words[words.length - 1])) words.pop();
  const units: string[] = [];
  for (const w of words) {
    if (w === "و" && units.length > 0) units[units.length - 1] += " و";
    else units.push(w);
  }
  if (units.length === 0) return [];
  if (units.length === 1) {
    const parts = units[0].split(ZWNJ).filter(Boolean);
    if (letters(units[0]) <= CELL_LINE_LETTERS || parts.length < 2) return [units[0]];
    // The ZWNJ that balances the two lines best.
    let best = 1;
    const cost = (k: number) => Math.max(letters(parts.slice(0, k).join("")), letters(parts.slice(k).join("")));
    for (let k = 2; k < parts.length; k++) if (cost(k) < cost(best)) best = k;
    return [parts.slice(0, best).join(ZWNJ), parts.slice(best).join(ZWNJ)];
  }
  let line1 = units[0];
  let i = 1;
  while (i < units.length && letters(`${line1} ${units[i]}`) <= CELL_LINE_LETTERS) line1 += ` ${units[i++]}`;
  const rest = units.slice(i).join(" ");
  return rest ? [line1, rest] : [line1];
}

/** 32-bit FNV-1a over the string's code points (unsigned). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The subject's hue: fnv1a32 of the full UUID string, mod 8 — the same درس has the same colour everywhere. */
export function subjectHue(subjectId: string): number {
  return fnv1a(subjectId) % SUBJECT_HUES;
}
