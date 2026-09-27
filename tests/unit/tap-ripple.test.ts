// Tap feedback (owner «اسپلش ریز»): the delegated ink helper (`src/lib/tap-ripple.ts`) against a tiny fake DOM (the
// unit project runs in node), the opt-ins on the Home tile / course card, and the stylesheet rules that move things
// living under `prefers-reduced-motion: no-preference`.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { House } from "lucide-react";
import { RIPPLE_MAX_RADIUS, RIPPLE_MS, TOUCH_DELAY_MS, inkTone, installTapRipple, rippleHost, spawnRipple } from "@/lib/tap-ripple";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: unknown }) =>
    createElement("a", { href, ...rest }, children),
}));

// ---- a fake DOM just big enough for the helper -------------------------------------------------------------------
type Anim = { keyframes: Keyframe[]; options: KeyframeAnimationOptions; onfinish: (() => void) | null; oncancel: (() => void) | null };

function matches(el: FakeEl, selector: string): boolean {
  return selector.split(",").some((raw) => {
    const s = raw.trim();
    if (s.startsWith(".")) return el.classes.has(s.slice(1));
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
    if (attr) return el.attrs.has(attr[1]!) && (attr[2] === undefined || el.attrs.get(attr[1]!) === attr[2]);
    return el.tag === s;
  });
}

class FakeEl {
  attrs = new Map<string, string>();
  classes = new Set<string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  disabled?: boolean;
  anims: Anim[] = [];
  rect = { left: 0, top: 0, width: 0, height: 0 };
  color = "rgb(11, 20, 64)";
  constructor(
    public tag: string,
    public ownerDocument: FakeDoc,
  ) {}
  set className(v: string) {
    this.classes = new Set(v.split(/\s+/).filter(Boolean));
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  closest(sel: string): FakeEl | null {
    for (let e: FakeEl | null = this; e; e = e.parent) if (matches(e, sel)) return e;
    return null;
  }
  querySelector(sel: string): FakeEl | null {
    for (const c of this.children) {
      if (matches(c, sel)) return c;
      const d = c.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  appendChild(c: FakeEl) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c: FakeEl, ref: FakeEl | null) {
    c.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const a: Anim = { keyframes, options, onfinish: null, oncancel: null };
    this.anims.push(a);
    return a;
  }
}

class FakeDoc {
  listeners = new Map<string, (e: unknown) => void>();
  defaultView = { getComputedStyle: (el: FakeEl) => ({ color: el.color }) };
  createElement(tag: string) {
    return new FakeEl(tag, this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, fn);
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
  fire(type: string, e: Record<string, unknown>) {
    this.listeners.get(type)?.({ isPrimary: true, pointerType: "mouse", button: 0, pointerId: 1, ...e });
  }
}

function el(doc: FakeDoc, tag: string, opts: { cls?: string; attrs?: Record<string, string>; parent?: FakeEl } = {}) {
  const e = doc.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) e.setAttribute(k, v);
  opts.parent?.appendChild(e);
  return e;
}
const H = (e: FakeEl) => e as unknown as HTMLElement;
const layersOf = (e: FakeEl) => e.children.filter((c) => c.classes.has("tap-ink-layer"));

afterEach(() => vi.useRealTimers());

describe("rippleHost", () => {
  const doc = new FakeDoc();
  it("the innermost pressable, button or [data-ripple] under the finger", () => {
    const row = el(doc, "a", { cls: "pressable flex" });
    const glyph = el(doc, "span", { parent: row });
    expect(rippleHost(glyph as unknown as EventTarget)).toBe(row);
    const btn = el(doc, "button", { parent: row });
    const label = el(doc, "span", { parent: btn });
    expect(rippleHost(label as unknown as EventTarget)).toBe(btn);
    const opted = el(doc, "summary", { attrs: { "data-ripple": "" } });
    expect(rippleHost(opted as unknown as EventTarget)).toBe(opted);
  });
  it("nothing for a plain element, a disabled / aria-disabled target, or inside [data-ripple=off]", () => {
    expect(rippleHost(el(doc, "div", { cls: "surface-work" }) as unknown as EventTarget)).toBeNull();
    const off = el(doc, "button");
    off.disabled = true;
    expect(rippleHost(off as unknown as EventTarget)).toBeNull();
    expect(rippleHost(el(doc, "a", { cls: "pressable", attrs: { "aria-disabled": "true" } }) as unknown as EventTarget)).toBeNull();
    const quiet = el(doc, "div", { attrs: { "data-ripple": "off" } });
    expect(rippleHost(el(doc, "button", { parent: quiet }) as unknown as EventTarget)).toBeNull();
    expect(rippleHost(null)).toBeNull();
  });
  it("a [data-ripple-host] inside the target takes the ink (the tile's squircle)", () => {
    const tile = el(doc, "a", { attrs: { "data-ripple": "" } });
    const mark = el(doc, "span", { cls: "clay-icon", attrs: { "data-ripple-host": "" }, parent: tile });
    const label = el(doc, "span", { parent: tile });
    expect(rippleHost(label as unknown as EventTarget)).toBe(mark);
  });
});

describe("spawnRipple", () => {
  it("drops one disc under the finger, as the host's first child, and removes it when done", () => {
    const doc = new FakeDoc();
    const host = el(doc, "button");
    const text = el(doc, "span", { parent: host });
    host.rect = { left: 100, top: 50, width: 120, height: 44 };
    const layer = spawnRipple(H(host), 110, 60) as unknown as FakeEl;
    expect(host.children[0]).toBe(layer);
    expect(host.children[1]).toBe(text);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    const ink = layer.children[0]!;
    expect(ink.classes.has("tap-ink")).toBe(true);
    const r = Math.hypot(110, 34); // farthest corner from (10, 10)
    expect(ink.style.width).toBe(`${2 * r}px`);
    const anim = ink.anims[0]!;
    expect(anim.options.duration).toBe(RIPPLE_MS);
    expect(String(anim.keyframes[0]!.transform)).toContain(`translate(${10 - r}px, ${10 - r}px) scale(0.2)`);
    expect(anim.keyframes.at(-1)!.opacity).toBe(0);
    for (const k of anim.keyframes) expect(Object.keys(k).every((p) => ["transform", "opacity", "offset"].includes(p))).toBe(true);
    anim.onfinish!();
    expect(layersOf(host)).toHaveLength(0);
  });
  it("a point outside the host rings it from its centre; a wide row gets a small disc", () => {
    const doc = new FakeDoc();
    const mark = el(doc, "span");
    mark.rect = { left: 0, top: 0, width: 68, height: 68 };
    const ink = (spawnRipple(H(mark), 30, 120) as unknown as FakeEl).children[0]!;
    expect(String(ink.anims[0]!.keyframes[0]!.transform)).toContain(`translate(${34 - Math.hypot(34, 34)}px`);
    const row = el(doc, "a");
    row.rect = { left: 0, top: 0, width: 900, height: 64 };
    const rowInk = (spawnRipple(H(row), 450, 32) as unknown as FakeEl).children[0]!;
    expect(rowInk.style.width).toBe(`${2 * RIPPLE_MAX_RADIUS}px`);
  });
  it("white ink where the host's text is light, brand ink elsewhere", () => {
    const doc = new FakeDoc();
    const mark = el(doc, "span");
    mark.rect = { left: 0, top: 0, width: 68, height: 68 };
    mark.color = "rgb(255, 255, 255)";
    expect((spawnRipple(H(mark), 10, 10) as unknown as FakeEl).dataset.tone).toBe("light");
    const row = el(doc, "a");
    row.rect = { left: 0, top: 0, width: 300, height: 56 };
    expect((spawnRipple(H(row), 10, 10) as unknown as FakeEl).dataset.tone).toBeUndefined();
  });
  it("draws nothing on a collapsed host", () => {
    const doc = new FakeDoc();
    expect(spawnRipple(H(el(doc, "button")), 0, 0)).toBeNull();
  });
});

describe("inkTone", () => {
  it("reads rgb, color(srgb) and oklch", () => {
    expect(inkTone("rgb(255, 255, 255)")).toBe("light");
    expect(inkTone("rgba(255 255 255 / 0.9)")).toBe("light");
    expect(inkTone("rgb(11, 20, 64)")).toBe("dark");
    expect(inkTone("color(srgb 1 1 1)")).toBe("light");
    expect(inkTone("oklch(0.98 0.01 260)")).toBe("light");
    expect(inkTone("oklch(0.3 0.1 260)")).toBe("dark");
    expect(inkTone("currentcolor")).toBe("dark");
  });
});

describe("installTapRipple", () => {
  function setup(reduced = false) {
    const doc = new FakeDoc();
    const btn = el(doc, "button");
    btn.rect = { left: 0, top: 0, width: 120, height: 44 };
    const off = installTapRipple(doc as unknown as Document, { reducedMotion: () => reduced });
    return { doc, btn, off };
  }
  it("one delegated set: a mouse press inks at once; touch listeners are passive no-ops for iOS :active", () => {
    const { doc, btn, off } = setup();
    expect([...doc.listeners.keys()].sort()).toEqual(["pointercancel", "pointerdown", "pointerup", "touchstart"]);
    doc.fire("pointerdown", { target: btn, clientX: 5, clientY: 5 });
    expect(layersOf(btn)).toHaveLength(1);
    off();
    expect(doc.listeners.size).toBe(0);
  });
  it("skips everything under reduced motion, a secondary button and a non-target", () => {
    const { doc, btn } = setup(true);
    doc.fire("pointerdown", { target: btn, clientX: 5, clientY: 5 });
    expect(layersOf(btn)).toHaveLength(0);
    const s = setup();
    s.doc.fire("pointerdown", { target: s.btn, button: 2, clientX: 5, clientY: 5 });
    const plain = el(s.doc, "div");
    s.doc.fire("pointerdown", { target: plain, clientX: 5, clientY: 5 });
    expect(layersOf(s.btn)).toHaveLength(0);
    expect(plain.children).toHaveLength(0);
  });
  it("touch waits a beat: a scroll (pointercancel) gets no ink, a quick tap gets it on lift, a held one after the delay", () => {
    vi.useFakeTimers();
    const { doc, btn } = setup();
    doc.fire("pointerdown", { target: btn, pointerType: "touch", clientX: 5, clientY: 5 });
    doc.fire("pointercancel", { pointerType: "touch" });
    vi.advanceTimersByTime(TOUCH_DELAY_MS * 2);
    expect(layersOf(btn)).toHaveLength(0);
    doc.fire("pointerdown", { target: btn, pointerType: "touch", clientX: 5, clientY: 5 });
    doc.fire("pointerup", { pointerType: "touch" });
    expect(layersOf(btn)).toHaveLength(1);
    vi.advanceTimersByTime(TOUCH_DELAY_MS * 2);
    expect(layersOf(btn)).toHaveLength(1);
    doc.fire("pointerdown", { target: btn, pointerType: "touch", clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(TOUCH_DELAY_MS);
    expect(layersOf(btn)).toHaveLength(2);
  });
});

describe("opt-ins", () => {
  it("the Home tile is a ripple target whose squircle takes the ink and sinks (press-mark)", async () => {
    const { Tile } = await import("@/components/home/Tile");
    const html = renderToStaticMarkup(createElement(Tile, { href: "/inbox", label: "کارتابل", icon: House }));
    expect(html).toMatch(/<a[^>]*data-ripple="(true)?"/);
    expect(html).toContain("press-mark");
    expect(html).not.toMatch(/<a[^>]*class="[^"]*\bpressable\b/);
    expect(html).toMatch(/class="clay-icon[^"]*"[^>]*data-ripple-host=""/);
  });
  it("an inert «به‌زودی» tile face is no ripple host", async () => {
    const { ModuleTileFace } = await import("@/components/home/ModuleTileFace");
    expect(renderToStaticMarkup(createElement(ModuleTileFace, { icon: House, label: "x", soon: true, inert: true }))).not.toContain("data-ripple-host");
  });
});

describe("globals.css", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  // Walks the nesting and returns, for each line matching `re` inside an `:active` rule, whether it also sits inside a
  // block whose opener matches `open`.
  function inside(re: RegExp, open: string) {
    const out: boolean[] = [];
    const stack: string[] = [];
    for (const line of css.split("\n")) {
      if (re.test(line) && stack.some((s) => s.includes(":active"))) out.push(stack.some((s) => s.includes(open)));
      for (let i = 0; i < (line.match(/\{/g) ?? []).length; i++) stack.push(line);
      for (let i = 0; i < (line.match(/\}/g) ?? []).length; i++) stack.pop();
    }
    return out;
  }
  it("every press scale lives under no-preference", () => {
    const found = inside(/^\s*scale:\s*0\.9\d/, "prefers-reduced-motion: no-preference");
    expect(found.length).toBeGreaterThanOrEqual(4); // pressable, surface-link, press-sink, press-mark
    expect(found.every(Boolean)).toBe(true);
  });
  it("reduced motion dims the press instead", () => {
    const found = inside(/^\s*opacity:\s*0\.72/, "prefers-reduced-motion: reduce");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every(Boolean)).toBe(true);
  });
  it("the ink is clipped by its host's radius, never catches a tap, and has no glow", () => {
    const block = /\.tap-ink-layer \{[^}]*\}/.exec(css)?.[0] ?? "";
    for (const d of ["position: absolute", "inset: 0", "overflow: hidden", "border-radius: inherit", "pointer-events: none"]) expect(block).toContain(d);
    const ink = /\.tap-ink \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(ink).toContain("pointer-events: none");
    expect(ink).not.toMatch(/shadow|filter|blur/);
  });
  it("ink targets are containing blocks through the base layer, so position utilities still win", () => {
    expect(css).toMatch(/@layer base \{\s*:where\(button, \.pressable, \[data-ripple\], \[data-ripple-host\]\) \{\s*position: relative;/);
  });
});
