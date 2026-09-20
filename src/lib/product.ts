/**
 * Product naming. `PRODUCT_NAME` is optional and read lazily from process.env (no `env.ts` import, so the manifest
 * route and scripts can use it without the full server environment). Never «همکلاسی» — that is the competitor.
 */
export const DEFAULT_PRODUCT_NAME = "سامانهٴ مدرسه";

export function productName(): string {
  const v = process.env.PRODUCT_NAME?.trim();
  return v && v.length > 0 ? v : DEFAULT_PRODUCT_NAME;
}
