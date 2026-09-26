/**
 * The «دانینو» brand mark, as geometry — ONE source of truth for every rendering that must look identical:
 * `src/components/brand/DoninoMark.tsx` (JSX, in the app, navy on white), `src/lib/pwa/app-icon.tsx` (a string
 * handed to satori/`ImageResponse` for the installed PWA icons and the iOS launch screens) and the opening splash
 * (`src/components/brand/SplashScreen.tsx`).
 *
 * It is the owner's logo (`brand/donino-logo-source.jpg`), redrawn as a clean vector: a monogram **D** built from
 * ONE ribbon of constant width. An outer D (stem, top bar, a round bowl, bottom bar) whose bottom bar sweeps up
 * from the foot of the stem as a leaf, into the slanted stem of a second, inner D; the inner D runs round its own
 * bowl and its top arm curves back down into the outer stem. Measured on the source and then made exact:
 *
 *   - every stroke is 5.75 grid units (the source wobbled 5.7…6.1 — its inner stem was the heavy one) and every
 *     white counter between two strokes is 4.9 (the channel round the bowl AND the notch between the stem and the
 *     leaf, which the source let pinch to 4.6);
 *   - the four bowls are true concentric circles about (32, 32): r = 27, 21.25, 16.35, 10.6 (the source was
 *     concentric to within a pixel; the auto-trace was not), so the tops and bottoms are straight and level;
 *   - the inner stem is two parallel lines at exactly 1 : 5 (11.3°, the source's 11.1°), one stroke apart;
 *   - the four free curves (the leaf's two edges, the inner top arm's two edges) are one cubic each, fitted to the
 *     source's edges within ~0.1 unit and then held one stroke — or one counter — apart from their partner; each
 *     leaves its bowl on the bowl's own tangent, so no curve has a kink.
 *
 * Two contours of one `fill-rule="evenodd"` path on a 64×64 grid, 22 on-curve nodes (the auto-trace had 30):
 *
 *   1. the silhouette — the outer D, with the notch that runs from the foot of the stem up into the inner D's eye
 *   2. the channel — the C-shaped counter round the inner D, ending in the wedge between the leaf and the inner stem
 *
 * The ink spans x 5.75…59, y 5…59: the D's round side is optically lighter than its stem, so it sits ⅜ unit right
 * of the geometric centre.
 *
 * The UI rendering fills with `currentColor` (the component defaults to the `primary-700` navy token). Raw hex
 * lives here only for the icon string: `ImageResponse` has no CSS variables. The two stops ARE the `.clay-icon`
 * gradient of `src/app/globals.css` — primary-500 leaning to primary-400 (#405FE8) down to primary-600 (#072AC8) —
 * so the installed icon is the same persian-blue material as every clay mark.
 */
export const MARK_TOP = "#405FE8";
export const MARK_BOTTOM = "#072AC8";
export const MARK_GLYPH = "#FFFFFF";
/** The page ground (`canvas` in globals.css) — what the iOS launch screen, the manifest's splash and the opening
 *  splash all sit on. */
export const MARK_CANVAS = "#E8EEF9";
/** Corner radius as a percentage of the squircle — the same 26 % as `.clay-icon`. */
export const MARK_RADIUS_PCT = 26;

/** The grid the monogram is authored on. Every rendering uses it verbatim. */
export const MONOGRAM_VIEWBOX = "0 0 64 64";

/** 1 — the silhouette: top bar, bowl (r 27), bottom bar, the leaf up to its tip, the inner stem down, the eye (r 10.6)
 *  and the inner top arm curving back down to the foot of the stem. */
const OUTER = "M5.75 5H32C46.91 5 59 17.09 59 32C59 46.91 46.91 59 32 59H5.75C10.59 42.35 16.56 27.62 30.08 25.97L26.75 42.6H32C37.85 42.6 42.6 37.85 42.6 32C42.6 26.15 37.85 21.4 32 21.4C15.07 21.4 9.08 36.44 5.75 43.61Z";
/** 2 — the channel: under the top bar, round the bowl (r 21.25), along the bottom bar to the leaf, up the leaf's inner
 *  edge to the wedge tip, down the inner stem, round the inner D (r 16.35) and along its top arm back to the stem. */
const CHANNEL = "M11.5 10.75H32C43.74 10.75 53.25 20.26 53.25 32C53.25 43.74 43.74 53.25 32 53.25H13.6C15.26 47.65 19.17 39.29 22.1 36.53L19.74 48.35H32C41.03 48.35 48.35 41.03 48.35 32C48.35 22.97 41.03 15.65 32 15.65C22.78 15.65 16.3 19.31 11.5 23.81Z";

/** The whole monogram as one `d`, to be filled with `fill-rule="evenodd"`. */
export const MONOGRAM_PATH = [OUTER, CHANNEL].join(" ");

/**
 * The same two contours kept apart, for the ONE rendering that strokes the monogram instead of filling it: the
 * opening splash draws each outline with `stroke-dasharray`/`stroke-dashoffset` (`SplashScreen`). They must be
 * separate elements there — a dash pattern restarts on every sub-path of a single `d` — and each carries
 * `pathLength="1"` so the long silhouette and the shorter channel both run 1 → 0 on their own clocks.
 * Both start at their top-left corner and run clockwise, so the channel traces a beat behind the silhouette.
 */
export const MONOGRAM_STROKES: readonly string[] = [OUTER, CHANNEL];

/**
 * How much of the icon square the monogram takes: its ink is 53.25 × 54 of the 64 grid, so 0.72 lands it on ~61 %
 * of the square — the proportion a launcher glyph wants, with a comfortable margin inside the 26 % corners.
 * `MONOGRAM_ICON_NUDGE` is the optical correction: the stem and the leaf carry the mass on the start side, so the
 * ink box is centred 0.6 unit to the end side of the squircle's middle, which is where the eye puts the centre.
 */
export const MONOGRAM_ICON_SCALE = 0.72;
export const MONOGRAM_ICON_NUDGE = 0.6;
const INK_CX = (5.75 + 59) / 2;
const OFFSET_X = 32 + MONOGRAM_ICON_NUDGE - INK_CX * MONOGRAM_ICON_SCALE;
const OFFSET_Y = 32 - 32 * MONOGRAM_ICON_SCALE;
export const MONOGRAM_ICON_TRANSFORM = `translate(${OFFSET_X.toFixed(2)} ${OFFSET_Y.toFixed(2)}) scale(${MONOGRAM_ICON_SCALE})`;

/** The rim light of the clay material: a hairline of white inside the edge. */
export const MARK_RIM_OPACITY = 0.22;

/** The squircle's corner radius in grid units. */
export const MARK_RADIUS_UNITS = (MARK_RADIUS_PCT / 100) * 64;
const RADIUS = MARK_RADIUS_UNITS;

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

/**
 * The launch still: the monogram alone, persian-blue at `MARK_GHOST_OPACITY`, no squircle — the iOS launch screen
 * (`renderSplash`) paints it on `canvas`, and it is ALSO the first frame of the opening splash (`SplashScreen`),
 * where the pen then traces over it. So the still the OS shows while the app starts and the animation that takes
 * over from it are one picture: nothing jumps, and a slow first response waits on a calm, recognisable mark.
 */
export const MARK_GHOST_OPACITY = 0.16;
export function ghostMarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MONOGRAM_VIEWBOX}"><path d="${MONOGRAM_PATH}" fill="${MARK_BOTTOM}" fill-opacity="${MARK_GHOST_OPACITY}" fill-rule="evenodd"/></svg>`;
}
export function ghostMarkDataUri(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ghostMarkSvg())}`;
}
