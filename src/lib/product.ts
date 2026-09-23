/**
 * Product naming. The product is «دانینو» (Latin «Donino», used only where a Latin string is unavoidable — file
 * names and code identifiers; the UI stays Persian). «سامانهٴ مدرسه» is the CATEGORY, not the name.
 * `PRODUCT_NAME` is optional and read lazily from process.env (no `env.ts` import, so the manifest route and
 * scripts can use it without the full server environment). Never «همکلاسی» — that is the competitor.
 */
export const DEFAULT_PRODUCT_NAME = "دانینو";

/** The Latin wordmark of the printed logo. Only for surfaces where a Latin string is already acceptable
 * (code identifiers, file names, the README) — never as a label in the Persian UI. */
export const PRODUCT_NAME_LATIN = "donino";

export function productName(): string {
  const v = process.env.PRODUCT_NAME?.trim();
  return v && v.length > 0 ? v : DEFAULT_PRODUCT_NAME;
}
