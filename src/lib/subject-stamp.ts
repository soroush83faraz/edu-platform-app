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
  const norm = name
    .normalize("NFC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ً-ْٰ]/g, "")
    .trim();
  let words = norm.split(/[\s‌،,.\-–—/()0-9۰-۹]+/).filter(Boolean);
  if (words[0] === "علوم" && words[1] === "و" && words[2] === "فنون") words = ["علوم‌وفنون"];
  if (words.length > 1 && HEAD_SKIP.has(words[0])) words = words.slice(1);
  const w = words[0] ?? "";
  return OVERRIDES[w] ?? [...w].slice(0, 3).join("");
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
