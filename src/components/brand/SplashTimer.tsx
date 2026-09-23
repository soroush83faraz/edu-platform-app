"use client";

import { useEffect } from "react";
import { SPLASH_TOTAL_MS } from "@/lib/pwa/splash-gate";

/**
 * The only JavaScript the opening splash runs after its boot script (`SplashScreen`): it takes the finished
 * overlay OUT of the render tree once the CSS leave has played, by clearing the `data-splash` attribute the boot
 * script set on `<html>`.
 *
 * Nothing about the splash depends on this — the layer fades itself out on a CSS animation of exactly
 * `SPLASH_TOTAL_MS`, so a bundle that never arrives, a listener that never fires or a tab the browser throttles
 * all end with the same empty screen. This just stops an invisible layer from sitting in the page afterwards.
 *
 * With `prefers-reduced-motion: reduce` it clears the attribute at once: the reduced-motion clamp in `globals.css`
 * collapses the animation anyway, and the app should simply open.
 */
export function SplashTimer() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.splash !== "on") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) {
      delete root.dataset.splash;
      return;
    }
    const done = window.setTimeout(() => {
      delete root.dataset.splash;
    }, SPLASH_TOTAL_MS);
    return () => window.clearTimeout(done);
  }, []);

  return null;
}
