// `cn` (src/lib/cn) — the class merger taught our @theme tokens. The package's default tables read `text-row` as a
// text colour (so `cn("text-row", "text-text")` dropped the size), `shadow-1` as a shadow colour and `bg-hero` as a
// background colour. These pin the fixed behaviour and parse globals.css so a new token cannot be forgotten.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_TOKENS, cn } from "@/lib/cn";

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
/** Every `--name: value` declared inside an `@theme { … }` / `@theme inline { … }` block. */
const themeVars = [...css.matchAll(/@theme[^{]*\{([^}]*)\}/g)].flatMap((m) => [...m[1]!.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((v) => v[1]!));
const inNamespace = (ns: string) => themeVars.filter((v) => v.startsWith(`${ns}-`) && !v.slice(ns.length + 1).includes("--")).map((v) => v.slice(ns.length + 1));

describe("globals.css @theme tokens are all registered", () => {
  it("parses the theme", () => {
    expect(inNamespace("text")).toContain("row");
    expect(inNamespace("color")).toContain("text-muted");
  });

  it("knows every namespace used in @theme", () => {
    // A new namespace needs a decision here: register it in src/lib/cn.ts, or state why the default tables suffice.
    const handled = ["color", "text", "radius", "shadow", "container", "spacing", "background-image", "font", "ease", "duration"];
    const namespaces = new Set(themeVars.map((v) => handled.find((ns) => v.startsWith(`${ns}-`)) ?? v));
    expect([...namespaces].filter((ns) => !handled.includes(ns))).toEqual([]);
  });

  it.each(inNamespace("text"))("text-%s is a font size, not a colour", (size) => {
    expect(cn("text-xs", `text-${size}`)).toBe(`text-${size}`);
    expect(cn(`text-${size}`, "text-text")).toBe(`text-${size} text-text`);
    expect(cn("text-text-muted", `text-${size}`)).toBe(`text-text-muted text-${size}`);
  });

  it.each(inNamespace("color"))("text-%s / bg-%s are colours that keep the size", (color) => {
    expect(cn("text-row", `text-${color}`)).toBe(`text-row text-${color}`);
    expect(cn("text-text", `text-${color}`)).toBe(`text-${color}`);
    expect(cn("bg-surface", `bg-${color}`)).toBe(`bg-${color}`);
  });

  it.each(inNamespace("radius"))("rounded-%s is a radius", (r) => {
    expect(cn("rounded-md", `rounded-${r}`)).toBe(`rounded-${r}`);
  });

  it.each(inNamespace("shadow"))("shadow-%s is a shadow, not a shadow colour", (s) => {
    expect(cn("shadow-sm", `shadow-${s}`)).toBe(`shadow-${s}`);
    expect(cn(`shadow-${s}`, "shadow-primary-500")).toBe(`shadow-${s} shadow-primary-500`);
  });

  it.each(inNamespace("container"))("max-w-%s is a container width", (c) => {
    expect(cn("max-w-3xl", `max-w-${c}`)).toBe(`max-w-${c}`);
  });

  it.each(inNamespace("spacing"))("%s is on the spacing scale", (s) => {
    expect(cn("w-4", `w-${s}`)).toBe(`w-${s}`);
    expect(cn("ps-2", `ps-${s}`)).toBe(`ps-${s}`);
  });

  it.each(inNamespace("background-image"))("bg-%s is an image and keeps the background colour", (b) => {
    expect(cn("bg-surface", `bg-${b}`)).toBe(`bg-surface bg-${b}`);
    expect(cn("bg-none", `bg-${b}`)).toBe(`bg-${b}`);
  });

  it("font families and eases resolve with the default tables", () => {
    for (const f of inNamespace("font")) expect(cn("font-sans", `font-${f}`)).toBe(`font-${f}`);
    for (const e of inNamespace("ease")) expect(cn("ease-linear", `ease-${e}`)).toBe(`ease-${e}`);
  });

  it("the static lists match the file (nothing stale)", () => {
    const tshirt = /^(\d?xs|sm|md|lg|\d?xl|base)$/;
    expect([...THEME_TOKENS.text].sort()).toEqual(inNamespace("text").filter((t) => !tshirt.test(t)).sort());
    expect([...THEME_TOKENS.radius].sort()).toEqual(inNamespace("radius").filter((t) => !tshirt.test(t)).sort());
    expect([...THEME_TOKENS.shadow].sort()).toEqual(inNamespace("shadow").sort());
    expect([...THEME_TOKENS.container].sort()).toEqual(inNamespace("container").sort());
    expect([...THEME_TOKENS.spacing].sort()).toEqual(inNamespace("spacing").sort());
    expect([...THEME_TOKENS.backgroundImage].sort()).toEqual(inNamespace("background-image").sort());
  });
});

describe("cn merges", () => {
  it("keeps a size role next to a colour (the InboxRow / DayAgenda bug)", () => {
    expect(cn("line-clamp-2 text-row", cn("text-text", "font-semibold"))).toBe("line-clamp-2 text-row text-text font-semibold");
  });

  it("keeps only the last size and the last colour", () => {
    expect(cn("text-meta", "text-row")).toBe("text-row");
    expect(cn("text-sm", "text-section")).toBe("text-section");
    expect(cn("text-text", "text-text-muted")).toBe("text-text-muted");
    expect(cn("text-meta text-text-faint", "text-row text-text")).toBe("text-row text-text");
  });

  it("resolves the custom radii and shadow against each other", () => {
    expect(cn("rounded-card", "rounded-hero")).toBe("rounded-hero");
    expect(cn("rounded-xl", "rounded-card")).toBe("rounded-card");
    expect(cn("rounded-card", "rounded-s-none")).toBe("rounded-card rounded-s-none");
    expect(cn("shadow-1", "shadow-none")).toBe("shadow-none");
  });

  it("leaves the non-Tailwind surface utilities alone", () => {
    expect(cn("surface-work", "surface-panel pressable surface-link")).toBe("surface-work surface-panel pressable surface-link");
    expect(cn("bg-canvas", "bg-surface")).toBe("bg-surface");
  });

  it("keeps every SubjectStamp class", () => {
    const base = "inline-grid shrink-0 place-items-center pt-px font-bold leading-none whitespace-nowrap ring-1 ring-inset";
    const hue = "bg-subject-3-bg text-subject-3-ink ring-subject-3-ink/9";
    expect(cn(base, "size-9 rounded-stamp text-meta leading-none", hue).split(" ")).toEqual(
      expect.arrayContaining(["size-9", "rounded-stamp", "text-meta", "leading-none", "bg-subject-3-bg", "text-subject-3-ink", "ring-subject-3-ink/9"]),
    );
    // `text-stamp` carries its own line-height 1, so the base `leading-none` it replaces changes nothing.
    expect(cn(base, "size-12 rounded-stamp-lg text-stamp", hue).split(" ")).toEqual(
      expect.arrayContaining(["size-12", "rounded-stamp-lg", "text-stamp", "bg-subject-3-bg", "text-subject-3-ink"]),
    );
  });
});
