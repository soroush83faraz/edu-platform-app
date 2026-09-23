import { InlineScript } from "@/components/InlineScript";
import { SplashTimer } from "@/components/brand/SplashTimer";
import {
  MARK_BOTTOM,
  MARK_GLYPH,
  MARK_RADIUS_UNITS,
  MARK_RIM_OPACITY,
  MARK_TOP,
  MONOGRAM_ICON_TRANSFORM,
  MONOGRAM_PATH,
  MONOGRAM_STROKES,
  MONOGRAM_VIEWBOX,
} from "@/lib/brand/mark";
import { SPLASH_BOOT_SCRIPT } from "@/lib/pwa/splash-gate";

const R = MARK_RADIUS_UNITS;

/** The three orbits: how far each one leans, its radii on the 64 grid, and how late and how fast it sweeps. */
const ORBITS = [
  { tilt: -26, rx: 58, ry: 24, delay: 0, sweep: 820 },
  { tilt: 34, rx: 53, ry: 19, delay: 40, sweep: 880 },
  { tilt: 78, rx: 48, ry: 14, delay: 60, sweep: 940 },
] as const;

/**
 * The opening splash of the INSTALLED app: «دانینو» drawing itself over the app as it opens — the owner's launch
 * animation rebuilt from our own geometry (`src/lib/brand/mark.ts`). No video, no image, no dependency: the
 * monogram we already ship, a handful of ellipses, and the keyframes in `globals.css` under «Opening splash».
 *
 * **It is painted with the first frame, and it is never a gate.** The markup is server-rendered in the root
 * layout, so it is in the HTML the browser parses — nothing waits for React to mount it, which is what made an
 * earlier version arrive a beat after the page. The inline script above it (`SPLASH_BOOT_SCRIPT`) decides, before
 * that first paint, whether it is laid out at all: only in the installed app, only the first document load of the
 * session. In a browser tab the attribute is never set, so the overlay is `display: none` and never flashes.
 * Underneath, the app renders and is interactive from the start: the layer is `position: fixed` and
 * `pointer-events: none` for its whole life, and nothing awaits it.
 *
 * **It cannot get stuck.** The 1200 ms `splash-leave` is a CSS animation on the layer itself — no JS, no
 * `animationend` listener, nothing a throttled tab or a failed bundle could lose. `SplashTimer` only takes the
 * finished layer out of the render tree afterwards, and gets out of the way immediately under reduced motion.
 *
 * The timeline:
 *   0–520 ms    the monogram's three outlines draw on, thin sky strokes (`stroke-dashoffset`, `--ease-out`)
 *   0–1000 ms   three orbits at different tilts draw on, sweep at their own speeds and fade away
 *   480–760 ms  the finished icon lands: the clay squircle fades in and settles from 1.06
 *   500–900 ms  one soft sky bloom pulses behind it as the fill arrives
 *   760–1080 ms a shine sweeps across the glyph, clipped to the squircle
 *   1000–1200 ms the whole layer fades out
 *
 * It settles on exactly what the iOS launch screen paints (`renderSplash`): the installed icon, centred on
 * `canvas`, at the same share of the short side — so the still the OS shows and the animation that follows it are
 * one picture. With `prefers-reduced-motion: reduce` the clamp in `globals.css` collapses every animation,
 * including the layer's own leave, so the app simply opens with no splash at all.
 */
export function SplashScreen() {
  return (
    <>
      <InlineScript code={SPLASH_BOOT_SCRIPT} />
      <div aria-hidden className="splash-layer">
        <svg viewBox={MONOGRAM_VIEWBOX} className="splash-art" focusable="false">
          <defs>
            {/* The clay material of the installed icon, stop for stop (`markSvg`). */}
            <linearGradient id="splash-clay" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={MARK_TOP} />
              <stop offset="1" stopColor={MARK_BOTTOM} />
            </linearGradient>
            {/* Sky comes from the stylesheet: a presentation attribute cannot read a custom property, a class can. */}
            <radialGradient id="splash-bloom-paint">
              <stop offset="0.3" className="splash-bloom-core" />
              <stop offset="1" className="splash-bloom-edge" />
            </radialGradient>
            <linearGradient id="splash-shine-paint" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={MARK_GLYPH} stopOpacity="0" />
              <stop offset="0.5" stopColor={MARK_GLYPH} stopOpacity="0.45" />
              <stop offset="1" stopColor={MARK_GLYPH} stopOpacity="0" />
            </linearGradient>
            <clipPath id="splash-squircle">
              <rect width="64" height="64" rx={R} ry={R} />
            </clipPath>
          </defs>

          {/* One soft bloom, pulsed as the fill lands. */}
          <circle className="splash-bloom" cx="32" cy="32" r="46" fill="url(#splash-bloom-paint)" />

          {/* The orbits reach outside the 64 square — the SVG does not clip them (`overflow: visible`). */}
          {ORBITS.map((o) => (
            <g key={o.tilt} className="splash-orbit" style={{ animationDelay: `${o.delay}ms`, animationDuration: `${o.sweep}ms` }}>
              <ellipse
                cx="32"
                cy="32"
                rx={o.rx}
                ry={o.ry}
                transform={`rotate(${o.tilt} 32 32)`}
                pathLength="1"
                vectorEffect="non-scaling-stroke"
                className="splash-trace"
                style={{ animationDelay: `${o.delay}ms` }}
              />
            </g>
          ))}

          {/* The construction lines: the monogram's three sub-paths, each drawn where the finished icon carries it. */}
          <g transform={MONOGRAM_ICON_TRANSFORM}>
            {MONOGRAM_STROKES.map((d) => (
              <path key={d} d={d} pathLength="1" vectorEffect="non-scaling-stroke" className="splash-ink" />
            ))}
          </g>

          {/* The finished icon — the squircle the Home Screen and the launch screen already show. */}
          <g className="splash-solid">
            <rect width="64" height="64" rx={R} ry={R} fill="url(#splash-clay)" />
            <rect
              x="0.75"
              y="0.75"
              width="62.5"
              height="62.5"
              rx={R - 0.75}
              ry={R - 0.75}
              fill="none"
              stroke={MARK_GLYPH}
              strokeOpacity={MARK_RIM_OPACITY}
              strokeWidth="1.5"
            />
            <path d={MONOGRAM_PATH} fill={MARK_GLYPH} fillRule="evenodd" transform={MONOGRAM_ICON_TRANSFORM} />
          </g>

          {/* The shine, last and clipped to the squircle: a soft white band crossing the glyph once. */}
          <g clipPath="url(#splash-squircle)">
            <g transform="rotate(-18 32 32)">
              <rect className="splash-shine" x="-34" y="-26" width="22" height="116" fill="url(#splash-shine-paint)" />
            </g>
          </g>
        </svg>
      </div>
      <SplashTimer />
    </>
  );
}
