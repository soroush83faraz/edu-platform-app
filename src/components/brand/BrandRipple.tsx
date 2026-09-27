import { DoninoMark } from "@/components/brand/DoninoMark";
import { cn } from "@/lib/cn";

/** The water rings round the mark, strongest inside — the splash's ripple, standing still (radii in a 200 unit box). */
const RINGS: readonly [r: number, opacity: number][] = [
  [44, 0.22],
  [64, 0.15],
  [84, 0.1],
  [99, 0.06],
];

/**
 * The decoration of the blue brand cards (the Home greeting, the «حساب من» profile card): the «دانینو» mark standing
 * faint in a few still water rings — white at low opacity, no extra hue, no glow. Decorative (`aria-hidden`); the
 * caller positions it (`className`: an absolute box at the card's end side, clipped by the card's `overflow-hidden`)
 * and keeps its text clear of it with `pe-*`. `markClassName` sizes the mark per breakpoint.
 */
export function BrandRipple({ className, markSize = 56, markClassName }: { className?: string; markSize?: number; markClassName?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute -z-10 grid place-items-center", className)}>
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" focusable="false">
        {RINGS.map(([r, opacity]) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeOpacity={opacity} strokeWidth="1.5" />
        ))}
      </svg>
      <DoninoMark size={markSize} className={cn("relative text-white/20", markClassName)} />
    </div>
  );
}
