// The opening splash plays in the installed app, once per session — the two rules that keep it off a browser tab
// and off every load after the first (`src/lib/pwa/splash-gate.ts`). The boot script that runs them before the
// first paint cannot import the function, so what it must contain is pinned here too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SPLASH_BOOT_SCRIPT,
  SPLASH_FADE_MS,
  SPLASH_HOLD_MS,
  SPLASH_REDUCED_MS,
  SPLASH_SEEN_KEY,
  SPLASH_TOTAL_MS,
  shouldShowSplash,
} from "@/lib/pwa/splash-gate";
import { SPLASH_WATER_CALM_MS, SPLASH_WATER_DROP_MS, SPLASH_WATER_IMPACT_MS, SPLASH_WATER_SCRIPT, SPLASH_WATER_THEME, splashWaterScript } from "@/lib/pwa/splash-water";

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
  it("is hard-capped at 2.2 s — the CSS leave and the timer that clears up after it are the same number", () => {
    expect(SPLASH_TOTAL_MS).toBe(SPLASH_HOLD_MS + SPLASH_FADE_MS);
    expect(SPLASH_TOTAL_MS).toBeLessThanOrEqual(2200);
    // The drop falls as the pen finishes, lands as the ink does (the CSS ink and rings start on that same beat),
    // the water calms, and only then does the layer lift away.
    expect(SPLASH_WATER_DROP_MS).toBeLessThan(SPLASH_WATER_IMPACT_MS);
    expect(css).toContain(`splash-ink 340ms var(--ease-out) ${SPLASH_WATER_IMPACT_MS}ms both;`);
    expect(css).toContain(`splash-hand-over 120ms linear ${SPLASH_WATER_IMPACT_MS}ms both,`);
    expect(SPLASH_WATER_IMPACT_MS).toBeLessThan(SPLASH_WATER_CALM_MS);
    expect(SPLASH_WATER_CALM_MS).toBeLessThanOrEqual(SPLASH_HOLD_MS);
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

describe("the water (WebGL) — an enhancement that falls back to the CSS splash on every «no»", () => {
  type Env = { splash?: string; reduced?: boolean; cores?: number; memory?: number; gl?: unknown };
  // Runs the inline script against a fake page and reports whether it asked for WebGL and what it left on <html>.
  function run(env: Env) {
    const dataset: Record<string, string> = env.splash ? { splash: env.splash } : {};
    const getContext = vi.fn(() => env.gl ?? null);
    const document = { documentElement: { dataset }, querySelector: () => ({ getContext }), createElement: () => ({}) };
    const window = { matchMedia: (q: string) => ({ matches: Boolean(env.reduced) && q.includes("reduce") }) };
    const navigator = { hardwareConcurrency: env.cores ?? 8, deviceMemory: env.memory ?? 8 };
    new Function("document", "window", "navigator", SPLASH_WATER_SCRIPT)(document, window, navigator);
    return { askedForGl: getContext.mock.calls.length > 0, water: dataset.splashWater };
  }
  // A WebGL context whose shader never compiles.
  const brokenGl = new Proxy({}, { get: (_t, k) => (k === "getShaderParameter" ? () => false : typeof k === "string" && /^[A-Z_]+$/.test(k) ? 1 : () => ({})) });

  it("is plain, self-contained script well under 8 KB, and ships the light water", () => {
    expect(() => new Function(SPLASH_WATER_SCRIPT)).not.toThrow();
    expect(new TextEncoder().encode(SPLASH_WATER_SCRIPT).length).toBeLessThanOrEqual(8192);
    expect(SPLASH_WATER_THEME).toBe("light");
    expect(SPLASH_WATER_SCRIPT).toBe(splashWaterScript("light"));
    expect(SPLASH_WATER_SCRIPT).not.toContain("__name");
    expect(SPLASH_WATER_SCRIPT).toContain("WEBGL_lose_context");
  });

  it("does nothing where the splash does not play", () => {
    expect(run({})).toEqual({ askedForGl: false, water: undefined });
  });

  it("never starts under reduced motion, on a weak device, or without WebGL", () => {
    expect(run({ splash: "on", reduced: true }).askedForGl).toBe(false);
    expect(run({ splash: "on", cores: 2 }).askedForGl).toBe(false);
    expect(run({ splash: "on", memory: 1 }).askedForGl).toBe(false);
    expect(run({ splash: "on" })).toEqual({ askedForGl: true, water: undefined });
  });

  it("leaves the CSS splash in charge when the shader fails to compile", () => {
    expect(run({ splash: "on", gl: brokenGl })).toEqual({ askedForGl: true, water: undefined });
  });

  it("the stylesheet shows the canvas and parks the CSS ink and rings only under the script's attribute", () => {
    expect(css).toContain('html[data-splash-water="on"] .splash-water {');
    expect(css).toContain('html[data-splash-water="on"] :is(.splash-fill, .splash-ripple, .splash-wash) {');
  });
});
