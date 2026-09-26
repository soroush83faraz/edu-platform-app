"use client";

import { useLayoutEffect, useRef } from "react";

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Content that changed in place — another tab of the کارتابل, another day of the timetable — fades in over 180 ms
 * when `swapKey` changes. Never on the first render (a page view is not an action) and not under reduced motion.
 * Opacity only, through the Web Animations API, so the wrapper stays a plain block and nothing remounts.
 */
export function CrossFade({ swapKey, className, children }: { swapKey: string | number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(swapKey);
  useLayoutEffect(() => {
    if (first.current === swapKey) return;
    first.current = swapKey;
    const el = ref.current;
    if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [swapKey]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
