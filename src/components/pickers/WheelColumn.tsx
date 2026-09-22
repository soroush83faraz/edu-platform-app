"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "cn";

/** One drum row. Five of them are visible, so the column is 200 px tall — two rows of context above and below. */
export const WHEEL_ROW = 40;
const VISIBLE_ROWS = 5;
/** Half-column padding so the first and last option can sit on the centre band. */
const EDGE_PAD = ((VISIBLE_ROWS - 1) / 2) * WHEEL_ROW;

export interface WheelColumnProps {
  /** The values, in drum order (top to bottom). */
  options: readonly number[];
  value: number;
  onChange: (value: number) => void;
  /** One option as the user reads it (Persian digits). */
  format: (value: number) => string;
  /** Accessible name of the drum («ساعت» / «دقیقه»). */
  label: string;
  /** Spoken form of one option, when the digits alone are not a sentence. */
  optionLabel?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A phone-alarm drum: a scroll-snapping column whose centre row is the value. Drag it with a thumb (momentum and
 * snap come from the platform), spin it with the wheel, or drive it from the keyboard (↑↓ one step, PageUp/PageDown
 * five, Home/End the ends). The value commits when the scroll settles, never mid-flight, so a fast flick reads once.
 * `role="listbox"` with `aria-activedescendant` so a screen reader announces the centred option as it changes.
 */
export function WheelColumn({ options, value, onChange, format, label, optionLabel, disabled, className }: WheelColumnProps) {
  const baseId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const firstParked = useRef(true);
  /** A finger or a mouse button is down on the drum: never commit and never re-park under it mid-drag. */
  const dragging = useRef(false);

  const index = Math.max(0, options.indexOf(value));
  const optionId = (v: number) => `${baseId}-${v}`;

  // Park the drum on the value: instantly on mount, animated when the value arrives from the keyboard or the form.
  useEffect(() => {
    const el = scroller.current;
    if (!el || dragging.current) return;
    const top = index * WHEEL_ROW;
    if (Math.abs(el.scrollTop - top) < 2) {
      firstParked.current = false;
      return;
    }
    el.scrollTo({ top, behavior: firstParked.current || reducedMotion() ? "auto" : "smooth" });
    firstParked.current = false;
  }, [index]);

  // Commit whatever row the drum came to rest on. `scrollend` is the real signal (Chrome, Firefox); the debounced
  // `scroll` covers engines that do not fire it (Safari) and is idempotent where both land.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const commit = () => {
      if (dragging.current) return;
      const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ROW)));
      const next = options[i];
      if (next !== undefined && next !== value) onChange(next);
    };
    const onScroll = () => {
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(commit, 140);
    };
    const down = () => {
      dragging.current = true;
    };
    const up = () => {
      dragging.current = false;
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(commit, 140);
    };
    el.addEventListener("scrollend", commit);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", down, { passive: true });
    el.addEventListener("pointerup", up, { passive: true });
    el.addEventListener("pointercancel", up, { passive: true });
    return () => {
      window.clearTimeout(settle.current);
      el.removeEventListener("scrollend", commit);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [options, value, onChange]);

  /** Tapping a visible row picks it outright; the pending settle timer must not second-guess the choice. */
  const choose = (o: number) => {
    window.clearTimeout(settle.current);
    if (o !== value) onChange(o);
  };

  const step = (delta: number) => {
    const i = Math.min(options.length - 1, Math.max(0, index + delta));
    const next = options[i];
    if (next !== undefined && next !== value) onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -VISIBLE_ROWS, PageDown: VISIBLE_ROWS };
    if (e.key in moves) {
      e.preventDefault();
      step(moves[e.key]);
    } else if (e.key === "Home") {
      e.preventDefault();
      step(-options.length);
    } else if (e.key === "End") {
      e.preventDefault();
      step(options.length);
    }
  };

  return (
    <div className={cn("relative select-none", disabled && "pointer-events-none opacity-50", className)} style={{ height: VISIBLE_ROWS * WHEEL_ROW }}>
      {/* The lit centre row: the drum's read-head, behind the digits. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg border-y border-primary-200 bg-primary-50"
        style={{ height: WHEEL_ROW }}
      />
      <div
        ref={scroller}
        role="listbox"
        aria-label={label}
        aria-activedescendant={optionId(value)}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-lg outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-scrollbar]:hidden"
        style={{
          paddingBlock: EDGE_PAD,
          WebkitOverflowScrolling: "touch",
          // The digits fade out toward the rim, the way a physical drum curves away.
          maskImage: "linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)",
        }}
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <div
              key={o}
              id={optionId(o)}
              role="option"
              aria-selected={active}
              aria-label={optionLabel?.(o)}
              onClick={() => choose(o)}
              className={cn(
                "flex cursor-pointer snap-center items-center justify-center text-section tabular transition-base",
                active ? "font-semibold text-primary-700" : "text-text-muted",
              )}
              style={{ height: WHEEL_ROW }}
            >
              {format(o)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
