/**
 * Input normalization for Persian/Arabic text and phone numbers.
 * Pure functions — no I/O. Every user-typed identifier passes through these before validation.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert Persian (۰–۹) and Arabic-Indic (٠–٩) digits to ASCII 0–9. Other characters are untouched. */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p !== -1) {
      out += String(p);
      continue;
    }
    const a = ARABIC_DIGITS.indexOf(ch);
    out += a !== -1 ? String(a) : ch;
  }
  return out;
}

/**
 * Normalize an Iranian mobile number to E.164 (+989XXXXXXXXX).
 * Accepts Persian/Arabic digits, spaces, dashes, parentheses and the prefixes 0, 98, +98, 0098.
 * Returns null when the input is not a valid Iranian mobile number.
 */
export function normalizePhoneIR(input: string): string | null {
  if (typeof input !== "string") return null;
  let s = toAsciiDigits(input).replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0098")) s = s.slice(4);
  else if (s.startsWith("98") && s.length === 12) s = s.slice(2);
  else if (s.startsWith("0") && s.length === 11) s = s.slice(1);
  // now expect 10 digits starting with 9
  if (!/^9\d{9}$/.test(s)) return null;
  return `+98${s}`;
}

/**
 * Normalize Persian text for storage and search:
 * Arabic yeh/kaf/teh-marbuta → Persian forms, Arabic-Indic digits → Persian digits are left as-is
 * (digits are handled by toAsciiDigits when needed), collapse whitespace, trim.
 */
export function normalizeFa(input: string): string {
  return input
    .replace(/[\u064A\u0649]/g, "\u06CC") // ي ى → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\u0640/g, "") // tatweel
    .replace(/[\u200C\u200D]+/g, "\u200C") // collapse repeated ZWNJ
    .replace(/[ \t\r\n\u00A0]+/g, " ")
    .trim();
}
