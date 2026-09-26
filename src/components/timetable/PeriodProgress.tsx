"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { periodProgress } from "@/lib/timetable";
import { CLOCK_TICK_MS } from "./useLiveClock";

/**
 * The live bar under the ringing زنگ: a 3 px rounded track along the bottom edge whose fill grows from the start
 * side (the right, in RTL) as the class runs. The fill is `scaleX` only (no layout work) with a linear transition
 * as long as one clock tick, so between two reads it glides instead of stepping; the first paint sets the width
 * without a transition, and under reduced motion the global clamp leaves just the width. Renders nothing outside
 * the زنگ — when the bell rings the bar is gone.
 *
 * Colour exception (owner's explicit ask, 2026-09-27): the fill is `success` green although it is not a 100 % /
 * completed state — see docs/decisions.md «live period progress».
 */
export function PeriodProgress({ startsAt, endsAt, nowMinutes, className }: { startsAt: string; endsAt: string; nowMinutes: number; className?: string }) {
  const fraction = periodProgress({ startsAt, endsAt }, nowMinutes);
  // Transition only after the first paint, so a freshly shown bar does not sweep in from zero.
  const [glide, setGlide] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setGlide(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  if (fraction === null) return null;
  return (
    <span aria-hidden className={cn("pointer-events-none absolute bottom-0 h-[3px] overflow-hidden rounded-full bg-success/15", className)}>
      <span
        className={cn("block h-full w-full rounded-full bg-success ltr:origin-left rtl:origin-right", glide && "motion-safe:transition-transform motion-safe:ease-linear")}
        style={{ transform: `scaleX(${fraction.toFixed(4)})`, transitionDuration: glide ? `${CLOCK_TICK_MS}ms` : undefined }}
      />
    </span>
  );
}
