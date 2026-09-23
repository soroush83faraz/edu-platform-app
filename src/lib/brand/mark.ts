/**
 * The «دانینو» brand mark, as geometry — ONE source of truth for the two renderings that must look identical:
 * `src/components/brand/DoninoMark.tsx` (JSX, in the app, navy on white) and `src/lib/pwa/app-icon.tsx` (a string
 * handed to satori/`ImageResponse` for the installed PWA icons, white on the persian-blue squircle).
 *
 * The owner's logo is a monogram **D** built from two interlocking strokes: an outer rounded D whose stem, on the
 * start side, carries a second, smaller D inside its counter — one navy ribbon folding inwards. It is drawn as
 * THREE sub-paths of a single `fill-rule="evenodd"` path on a 64×64 grid:
 *
 *   1. the outer D's silhouette (filled: the stem, the outer ring and — inside it — the inner D's body)
 *   2. the C-shaped channel between the outer ring and the inner D (knocked out: depth 2)
 *   3. the inner D's counter, the eye of the fold (knocked out: depth 2 — it lies outside the channel)
 *
 * The channel stops at the stem (x = 15) on both arms, so the inner D grows out of the stem with NO edge shared by
 * two sub-paths anywhere: a coincident edge is where an anti-aliasing rasteriser draws a hairline seam, and an
 * overlap would punch a hole. The strokes are 9 (outer ring), 6 (channel) and 6 (inner ring) grid units — thick
 * enough to stay two strokes at the 24 px favicon.
 *
 * The UI rendering fills with `currentColor` (the component defaults to the `primary-700` navy token). Raw hex
 * lives here only for the icon string: `ImageResponse` has no CSS variables. The two stops ARE the `.clay-icon`
 * gradient of `src/app/globals.css` — primary-500 leaning to primary-400 (#405FE8) down to primary-600 (#072AC8) —
 * so the installed icon is the same persian-blue material as every clay mark.
 */
export const MARK_TOP = "#405FE8";
export const MARK_BOTTOM = "#072AC8";
export const MARK_GLYPH = "#FFFFFF";
/** The page ground (`canvas` in globals.css) — what the iOS launch screen and the manifest's splash sit on. */
export const MARK_CANVAS = "#E8EEF9";
/** Corner radius as a percentage of the squircle — the same 26 % as `.clay-icon`. */
export const MARK_RADIUS_PCT = 26;

/** The grid the monogram is authored on. Both renderings use it verbatim. */
export const MONOGRAM_VIEWBOX = "0 0 64 64";

/** 1 — the outer D: a flat stem on the start side (3 px rounded corners), a bowl of r = 26 closing it. */
const OUTER = "M9 6H32C46.36 6 58 17.64 58 32C58 46.36 46.36 58 32 58H9A3 3 0 0 1 6 55V9A3 3 0 0 1 9 6Z";
/**
 * 2 — the channel: the outer ring's counter (inset 9 px, r = 17) MINUS the inner D (r = 11), traced as one C —
 * along the counter's top, round its bowl, back along its bottom to the stem, up 6, then back out along the inner
 * D's bottom, round the inner bowl the other way, and along its top to the stem again.
 */
const CHANNEL = "M15 15H32C41.39 15 49 22.61 49 32C49 41.39 41.39 49 32 49H15V43H32C38.08 43 43 38.08 43 32C43 25.92 38.08 21 32 21H15V15Z";
/** 3 — the inner D's own counter, inset 6 px (r = 5): the eye of the fold. */
const INNER_COUNTER = "M21 27H32C34.76 27 37 29.24 37 32C37 34.76 34.76 37 32 37H21V27Z";

/** The whole monogram as one `d`, to be filled with `fill-rule="evenodd"` — never `nonzero`. */
export const MONOGRAM_PATH = [OUTER, CHANNEL, INNER_COUNTER].join(" ");

/**
 * How much of the icon square the monogram takes (its ink spans 6…58 of the 64 grid, so 0.78 lands it on ~63 %
 * of the square — the proportion a launcher icon wants). `translate(32,32) scale(s) translate(-32,-32)`, folded.
 */
export const MONOGRAM_ICON_SCALE = 0.78;
const OFFSET = 32 - 32 * MONOGRAM_ICON_SCALE;
export const MONOGRAM_ICON_TRANSFORM = `translate(${OFFSET.toFixed(2)} ${OFFSET.toFixed(2)}) scale(${MONOGRAM_ICON_SCALE})`;

/** The rim light of the clay material: a hairline of white inside the edge. */
export const MARK_RIM_OPACITY = 0.22;

const RADIUS = (MARK_RADIUS_PCT / 100) * 64;

/**
 * The installed icon as a self-contained SVG string, for satori (`ImageResponse` cannot render our JSX component:
 * it needs an `<img src="data:image/svg+xml,…">`). `maskable` widens the viewBox to 80 so the 64-square lands
 * inside the 80 % safe zone the OS mask expects, and squares off the corners (the OS applies its own).
 */
export function markSvg(maskable = false): string {
  const box = maskable ? "-8 -8 80 80" : MONOGRAM_VIEWBOX;
  const bg = maskable
    ? `<rect x="-8" y="-8" width="80" height="80" fill="url(#g)"/>`
    : `<rect width="64" height="64" rx="${RADIUS}" ry="${RADIUS}" fill="url(#g)"/><rect x="0.75" y="0.75" width="62.5" height="62.5" rx="${RADIUS - 0.75}" ry="${RADIUS - 0.75}" fill="none" stroke="${MARK_GLYPH}" stroke-opacity="${MARK_RIM_OPACITY}" stroke-width="1.5"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${MARK_TOP}"/><stop offset="1" stop-color="${MARK_BOTTOM}"/>`,
    `</linearGradient></defs>`,
    bg,
    `<path d="${MONOGRAM_PATH}" fill="${MARK_GLYPH}" fill-rule="evenodd" transform="${MONOGRAM_ICON_TRANSFORM}"/>`,
    `</svg>`,
  ].join("");
}

/** The SVG as a data URI — what satori's `<img>` takes. */
export function markDataUri(maskable = false): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markSvg(maskable))}`;
}
