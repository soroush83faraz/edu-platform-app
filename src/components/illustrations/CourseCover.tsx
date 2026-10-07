import { createElement, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { subjectIcon } from "@/lib/subject-icon";
import { fnv1a, subjectHue } from "@/lib/subject-stamp";

/**
 * «جلد درس» — the cover on top of a Home course card (owner 2026-09-27, after the university LMS's course grid): a
 * geometric pattern in one vivid colour set with the درس's glyph on a white disc in the middle. Inline SVG, no raster,
 * no network, no JS; decorative (`aria-hidden`) — the card prints the name.
 *
 * Colour: covers have their OWN vivid palette (owner: the muted stamp hues read «بی‌روح» at this size) — eight sets
 * `--color-cover-{0..7}-{light,base,dark,ink}` in globals.css, mapped 1:1 to the stamp index, so by default a درس's
 * cover set is its stamp hue (`subjectHue`, fnv1a(id) % 8) and it keeps its identity; stamps / SubjectIcon stay muted.
 * The ground is the set's `base`; the pattern tones are `light`, `base`↔`dark` (50 % oklab mix) and `dark` — three
 * clearly separated steps (L 0.87 / ~0.65 / 0.57 on a 0.72 ground); the glyph is the set's `ink` on a white disc at
 * 85 % (≥ 8.8:1).
 *
 * Variation: the pattern FAMILY and tone layout come from a hash of `variantKey` (default: the subject id) — the
 * family from bits above the hue's (`h >>> 3`), the rest seeding the per-cell tones and a mirror. A teacher's list
 * passes the OFFERING id as `variantKey` and an explicit `palette` per card (owner 2026-09-27: «ریاضی» in five classes
 * must not look alike — `homeCourses` passes the teacher's own hue of the class, `teacherOfferingHues`, so card and
 * stamp agree and up to eight classes never share a set); a student's list leaves both unset, so one درس keeps one
 * stable look. The glyph is always the درس's own.
 * The pattern is authored on a 320×180 (16:9) board and drawn `xMidYMid slice`, so it fills any box crisply and the
 * centred glyph always stays in view.
 */

export const COVER_FAMILIES = ["circles", "hexagons", "triangles", "waves", "plaid", "squares"] as const;
export type CoverFamily = (typeof COVER_FAMILIES)[number];

const W = 320;
const H = 180;

/** The number of cover colour sets (`--color-cover-{0..7}-*`), one per stamp hue. */
export const COVER_PALETTES = 8;

/** The pattern family for a key (a subject or an offering id): bits above the hue's (`h >>> 3`), so hue and family vary independently. */
export function coverFamily(key: string): CoverFamily {
  return COVER_FAMILIES[(fnv1a(key) >>> 3) % COVER_FAMILIES.length];
}

/** Small deterministic PRNG (mulberry32) seeded from the subject hash — picks each cell's tone. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three pattern tones, darkest last (`--cv-1..3`); `--cv-0` is the ground. */
const TONE = ["fill-(--cv-1)", "fill-(--cv-2)", "fill-(--cv-3)"] as const;
const tone = (r: () => number) => TONE[Math.floor(r() * 3)];
const f = (n: number) => Math.round(n * 10) / 10;

function circles(r: () => number): ReactNode {
  // Overlapping discs on a staggered grid, translucent so every overlap reads as a third shade.
  const out: ReactNode[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 7; col++) {
      const cx = col * 56 + (row % 2) * 28 - 8;
      const cy = row * 48 - 6;
      out.push(<circle key={`${row}-${col}`} cx={cx} cy={cy} r={34} className={tone(r)} fillOpacity={0.72} />);
    }
  }
  return out;
}

function hexagons(r: () => number): ReactNode {
  // A honeycomb of flat hexagons with a ground-coloured gap between them.
  const s = 26; // side
  const w = Math.sqrt(3) * s;
  const out: ReactNode[] = [];
  for (let row = -1; row < 6; row++) {
    for (let col = -1; col < 8; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * s * 1.5;
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return `${f(cx + (s - 2) * Math.cos(a))},${f(cy + (s - 2) * Math.sin(a))}`;
      }).join(" ");
      out.push(<polygon key={`${row}-${col}`} points={pts} className={tone(r)} />);
    }
  }
  return out;
}

function triangles(r: () => number): ReactNode {
  // A triangle tessellation: rows of up and down triangles, each on its own tone — reads as diamonds where two meet.
  const b = 60;
  const h = 45;
  const out: ReactNode[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 12; col++) {
      const x = col * (b / 2) + (row % 2) * (b / 2);
      const y = row * h;
      const up = col % 2 === 0;
      const d = up ? `M${x} ${y + h}L${x + b / 2} ${y}L${x + b} ${y + h}Z` : `M${x} ${y}L${x + b} ${y}L${x + b / 2} ${y + h}Z`;
      if (r() < 0.78) out.push(<path key={`${row}-${col}`} d={d} className={tone(r)} />);
    }
  }
  return out;
}

function waves(r: () => number): ReactNode {
  // Stacked wave bands, each a shade deeper than the ground, the crest shifting band to band.
  const out: ReactNode[] = [];
  const phase = r() * 80;
  for (let i = 0; i < 6; i++) {
    const y = 18 + i * 30;
    const amp = 10 + (i % 2) * 4;
    const shift = phase + i * 22;
    let d = `M${-80 + shift} ${y}`;
    for (let x = -80 + shift; x < W + 80; x += 80) d += `q20 ${-amp} 40 0t40 0`;
    d += `V${H + 10}H${-80 + shift}Z`;
    out.push(<path key={i} d={d} className={TONE[i % 3]} fillOpacity={0.55} />);
  }
  return out;
}

function plaid(r: () => number): ReactNode {
  // Tartan: translucent vertical and horizontal stripes of mixed widths; their crossings deepen.
  const out: ReactNode[] = [];
  const widths = [10, 26, 6, 18];
  let x = -Math.floor(r() * 30);
  for (let i = 0; x < W; i++) {
    const w = widths[i % widths.length];
    out.push(<rect key={`v${i}`} x={x} y={0} width={w} height={H} className={TONE[i % 3]} fillOpacity={0.5} />);
    x += w + 22;
  }
  let y = -Math.floor(r() * 20);
  for (let i = 0; y < H; i++) {
    const w = widths[(i + 1) % widths.length];
    out.push(<rect key={`h${i}`} x={0} y={y} width={W} height={w} className={TONE[(i + 1) % 3]} fillOpacity={0.5} />);
    y += w + 24;
  }
  return out;
}

function squares(r: () => number): ReactNode {
  // A grid of rounded squares, some nested (a square in a square), each on its own tone.
  const c = 40;
  const out: ReactNode[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      const x = col * c;
      const y = row * c - 10;
      out.push(<rect key={`${row}-${col}`} x={x + 3} y={y + 3} width={c - 6} height={c - 6} rx={6} className={tone(r)} />);
      if (r() < 0.35) out.push(<rect key={`${row}-${col}-in`} x={x + 12} y={y + 12} width={c - 24} height={c - 24} rx={3} className="fill-(--cv-0)" fillOpacity={0.8} />);
    }
  }
  return out;
}

const DRAW: Record<CoverFamily, (r: () => number) => ReactNode> = { circles, hexagons, triangles, waves, plaid, squares };

/** The cover's tone variables for colour set `i` — only the cover palette tokens and one mix of two of them. */
function tones(i: number): CSSProperties {
  const set = (t: "light" | "base" | "dark" | "ink") => `var(--color-cover-${i}-${t})`;
  return {
    "--cv-0": set("base"),
    "--cv-1": set("light"),
    "--cv-2": `color-mix(in oklab, ${set("dark")} 50%, ${set("base")})`,
    "--cv-3": set("dark"),
    "--cv-ink": set("ink"),
  } as CSSProperties;
}

/**
 * The cover of one درس. `className` sizes the box (the card gives it a height / aspect); the SVG fills it.
 * `variantKey` seeds the pattern (default `subjectId`); `palette` picks the colour set 0–7 (default the subject's
 * stamp hue). `data-family` / `data-palette` expose the pick for tests.
 */
export function CourseCover({
  subjectId,
  name,
  variantKey = subjectId,
  palette,
  className,
}: {
  subjectId: string;
  name: string;
  variantKey?: string;
  palette?: number;
  className?: string;
}) {
  const set = (((palette ?? subjectHue(subjectId)) % COVER_PALETTES) + COVER_PALETTES) % COVER_PALETTES;
  const family = coverFamily(variantKey);
  const h = fnv1a(variantKey);
  const r = rng(h);
  const mirror = ((h >>> 11) & 1) === 1;
  return (
    <div aria-hidden className={cn("relative overflow-hidden bg-(--cv-0)", className)} style={tones(set)} data-family={family} data-palette={set}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" focusable="false">
        <g transform={mirror ? `matrix(-1 0 0 1 ${W} 0)` : undefined}>{DRAW[family](r)}</g>
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-16 place-items-center rounded-full bg-white/85 text-(--cv-ink) shadow-1">
          {createElement(subjectIcon(name), { className: "size-8", strokeWidth: 1.75, "aria-hidden": true })}
        </span>
      </span>
    </div>
  );
}
