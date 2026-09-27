"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "@/components/motion/CrossFade";
import { installTapRipple } from "@/lib/tap-ripple";

/**
 * The app-wide tap ink (`src/lib/tap-ripple.ts`): mounted once in the root layout, it installs one delegated
 * listener set on the document and renders nothing.
 */
export function TapRipple() {
  useEffect(() => installTapRipple(document, { reducedMotion: prefersReducedMotion }), []);
  return null;
}
