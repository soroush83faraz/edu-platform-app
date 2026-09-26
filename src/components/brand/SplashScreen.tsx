import { InlineScript } from "@/components/InlineScript";
import { SplashTimer } from "@/components/brand/SplashTimer";
import { MARK_GHOST_OPACITY, MONOGRAM_PATH, MONOGRAM_STROKES, MONOGRAM_VIEWBOX } from "@/lib/brand/mark";
import { SPLASH_BOOT_SCRIPT } from "@/lib/pwa/splash-gate";

/**
 * The opening splash of the INSTALLED app: «دانینو» written once, with one pen, and then out of the way. No video,
 * no image, no dependency, no JS animation — the monogram we already ship (`src/lib/brand/mark.ts`), four SVG
 * elements and the keyframes in `globals.css` under «Opening splash». Everything that moves is `opacity`,
 * `transform` or a stroke's dash offset on a 64-unit drawing, so a cheap phone composites it without a layout.
 *
 * **It is painted with the first frame, and it is never a gate.** The markup is server-rendered in the root
 * layout, so it is in the HTML the browser parses — nothing waits for React to mount it. The inline script above
 * it (`SPLASH_BOOT_SCRIPT`) decides, before that first paint, whether it is laid out at all: only in the installed
 * app, only the first document load of the session. In a browser tab the attribute is never set, so the overlay
 * is `display: none` and never flashes. Underneath, the app renders and is interactive from the start: the layer
 * is `position: fixed` and `pointer-events: none` for its whole life, and nothing awaits it.
 *
 * **It cannot get stuck.** The leave is a CSS animation on the layer itself — no JS, no `animationend` listener,
 * nothing a throttled tab or a failed bundle could lose. `SplashTimer` only takes the finished layer out of the
 * render tree afterwards.
 *
 * The timeline (1450 ms, `SPLASH_TOTAL_MS`):
 *     0–80 ms    the launch still: the pale mark on `canvas`, exactly the iOS launch image (`renderSplash`)
 *    80–760 ms   the pen traces the silhouette in one stroke, clockwise from the top of the stem
 *   170–800 ms   … and the channel, a beat behind it on the inside
 *   600–940 ms   the ink floods in — the solid mark fades up and settles from 96 % into the drawn outline,
 *                while the pen line thins away into its edge
 *   600–1440 ms  the bell («زنگ»): as the ink lands, three hairline rings ripple out from the mark across the
 *                ground (600 / 720 / 840 ms, 600 ms each, 32 → 22 → 14 % persian-blue) — struck once, decaying
 *  1120–1450 ms  the whole layer lifts away: 14 px up as it fades, and the app is there
 *
 * The ground is plain `canvas` from the first frame to the last (the rings are transparent hairlines on it), so
 * it meets the launch still and the status bar with no colour jump. With `prefers-reduced-motion: reduce`
 * nothing moves and no ring rings: the solid mark simply stands for a moment and fades (`SPLASH_REDUCED_MS`).
 */
export function SplashScreen() {
  const [silhouette, channel] = MONOGRAM_STROKES;
  return (
    <>
      <InlineScript code={SPLASH_BOOT_SCRIPT} />
      <div aria-hidden className="splash-layer">
        {/* The bell: three rings leave the mark once, as the ink lands, each fainter than the last. */}
        <span className="splash-ring" />
        <span className="splash-ring splash-ring-2" />
        <span className="splash-ring splash-ring-3" />
        <svg viewBox={MONOGRAM_VIEWBOX} className="splash-art" focusable="false">
          {/* The launch still the pen writes over — the same pale mark iOS has just shown. */}
          <path className="splash-ghost" d={MONOGRAM_PATH} fillRule="evenodd" fillOpacity={MARK_GHOST_OPACITY} />
          <path className="splash-fill" d={MONOGRAM_PATH} fillRule="evenodd" />
          <path className="splash-pen" d={silhouette} pathLength={1} />
          <path className="splash-pen splash-pen-inner" d={channel} pathLength={1} />
        </svg>
      </div>
      <SplashTimer />
    </>
  );
}
