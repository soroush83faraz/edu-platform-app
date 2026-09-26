// The opening splash plays in the installed app, once per session — the two rules that keep it off a browser tab
// and off every load after the first (`src/lib/pwa/splash-gate.ts`). The boot script that runs them before the
// first paint cannot import the function, so what it must contain is pinned here too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPLASH_BOOT_SCRIPT,
  SPLASH_FADE_MS,
  SPLASH_HOLD_MS,
  SPLASH_REDUCED_MS,
  SPLASH_SEEN_KEY,
  SPLASH_TOTAL_MS,
  shouldShowSplash,
} from "@/lib/pwa/splash-gate";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("shouldShowSplash", () => {
  it("plays on the first cold load of the installed app", () => {
    expect(shouldShowSplash({ standalone: true, seenThisSession: false })).toBe(true);
  });

  it("does not play again in the same session — a refresh or a return to «خانه» gets nothing", () => {
    expect(shouldShowSplash({ standalone: true, seenThisSession: true })).toBe(false);
  });

  it("never plays in a browser tab — not on a public page, not on /login", () => {
    expect(shouldShowSplash({ standalone: false, seenThisSession: false })).toBe(false);
    expect(shouldShowSplash({ standalone: false, seenThisSession: true })).toBe(false);
  });
});

describe("the boot script", () => {
  it("asks the same two questions, and claims the session before anything is painted", () => {
    expect(SPLASH_BOOT_SCRIPT).toContain("(display-mode: standalone)");
    expect(SPLASH_BOOT_SCRIPT).toContain("(display-mode: minimal-ui)");
    expect(SPLASH_BOOT_SCRIPT).toContain("navigator.standalone");
    expect(SPLASH_BOOT_SCRIPT).toContain(`sessionStorage.getItem("${SPLASH_SEEN_KEY}")`);
    expect(SPLASH_BOOT_SCRIPT).toContain(`sessionStorage.setItem("${SPLASH_SEEN_KEY}","1")`);
    // The attribute the stylesheet lays the overlay out under — set last, and only after the claim.
    expect(SPLASH_BOOT_SCRIPT.indexOf('dataset.splash="on"')).toBeGreaterThan(SPLASH_BOOT_SCRIPT.indexOf("setItem"));
  });

  it("shows nothing at all if anything throws (storage off, a locked-down WebView)", () => {
    expect(SPLASH_BOOT_SCRIPT).toContain("try{");
    expect(SPLASH_BOOT_SCRIPT).toContain("catch(e){}");
  });
});

describe("the timeline", () => {
  it("is hard-capped under 1.6 s — the CSS leave and the timer that clears up after it are the same number", () => {
    expect(SPLASH_TOTAL_MS).toBe(SPLASH_HOLD_MS + SPLASH_FADE_MS);
    expect(SPLASH_TOTAL_MS).toBeLessThanOrEqual(1600);
    // The stylesheet's leave runs exactly as long, and its hold ends where the fade begins.
    expect(css).toContain(`animation: splash-leave ${SPLASH_TOTAL_MS}ms linear both;`);
    expect(css).toContain(`${((SPLASH_HOLD_MS / SPLASH_TOTAL_MS) * 100).toFixed(2)}% {`);
  });

  it("under reduced motion nothing moves: the still mark stands and fades, spared by the global clamp", () => {
    expect(SPLASH_REDUCED_MS).toBeLessThan(SPLASH_TOTAL_MS);
    expect(css).toContain(`animation: splash-leave-still ${SPLASH_REDUCED_MS}ms linear both;`);
    expect(css).toContain("*:not(.splash-layer), *::before, *::after {");
    // Every movement of the pieces lives under no-preference; at rest the pen is gone and the ink is solid.
    const moving = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  /* Starts unhurried"));
    expect(moving.indexOf("splash-write")).toBeGreaterThan(0);
  });
});
