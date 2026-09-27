/**
 * The tap ink («اسپلش ریز», owner 2026-09-27): a small disc that starts under the finger and spreads and fades inside
 * the pressed surface, clipped by its radius. ONE delegated `pointerdown` listener on the document (installed by
 * `TapRipple` in the root layout) — no component renders, nothing re-renders; the ink is a throwaway span animated
 * with the Web Animations API (transform + opacity) that removes itself. The sink that goes with it is CSS `:active`
 * (`pressable`, `press-sink`, `press-mark` in globals.css).
 *
 * Targets: `.pressable`, every `button`, `[data-ripple]` — the innermost one under the finger. A `[data-ripple-host]`
 * inside it takes the ink instead (the Home tile's squircle); `[data-ripple="off"]` opts a subtree out; a disabled or
 * `aria-disabled` target gets none. Under `prefers-reduced-motion: reduce` there is no ink at all (the press is an
 * instant dim, in CSS). Keyboard activation fires no pointer event, so it shows the press state only.
 *
 * Touch: the ink waits `TOUCH_DELAY_MS` — a finger that starts a scroll fires `pointercancel` first and gets no ink;
 * a quick tap that lifts sooner gets it at once.
 */

export const RIPPLE_TARGETS = ".pressable, button, [data-ripple]";
/** Spread + fade, in all. */
export const RIPPLE_MS = 420;
/** A tiny splash, not a flood: the disc never grows past this radius, even on a full-width row. */
export const RIPPLE_MAX_RADIUS = 140;
export const TOUCH_DELAY_MS = 60;
const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** The element that takes the ink for a pointer that went down on `target`, or null. */
export function rippleHost(target: EventTarget | null): HTMLElement | null {
  const start = target as Element | null;
  if (!start || typeof start.closest !== "function") return null;
  const el = start.closest<HTMLElement>(RIPPLE_TARGETS);
  if (!el || el.closest('[data-ripple="off"]')) return null;
  if ((el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true") return null;
  return el.querySelector<HTMLElement>("[data-ripple-host]") ?? el;
}

/**
 * Light ink (white) where the host's own text is light — the clay squircle, a primary button, anything on `bg-hero`;
 * brand-blue ink everywhere else. Reads the computed `color` as `rgb()/rgba()`, `color(srgb …)` or `oklch()`.
 */
export function inkTone(color: string): "light" | "dark" {
  const c = color.trim().toLowerCase();
  let rgb: number[] | null = null;
  const m = /^rgba?\(([^)]+)\)/.exec(c);
  if (m) rgb = m[1]!.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  const srgb = /^color\(srgb\s+([^)]+)\)/.exec(c);
  if (srgb) rgb = srgb[1]!.split(/[\s/]+/).filter(Boolean).slice(0, 3).map((v) => Number(v) * 255);
  if (rgb && rgb.length === 3 && rgb.every((v) => Number.isFinite(v))) {
    const [r, g, b] = rgb as [number, number, number];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "light" : "dark";
  }
  const ok = /^oklch\(\s*([\d.]+)(%?)/.exec(c);
  if (ok) {
    const l = Number(ok[1]) / (ok[2] ? 100 : 1);
    return l > 0.75 ? "light" : "dark";
  }
  return "dark";
}

/**
 * Drops one ink disc into `host` at the viewport point (x, y) — its centre when the point is outside the host (a tap
 * on the tile's label rings the squircle from its middle). Returns the layer, or null when nothing was drawn.
 */
export function spawnRipple(host: HTMLElement, x: number, y: number): HTMLElement | null {
  const doc = host.ownerDocument;
  const rect = host.getBoundingClientRect();
  if (!doc || rect.width === 0 || rect.height === 0) return null;
  const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const px = inside ? x - rect.left : rect.width / 2;
  const py = inside ? y - rect.top : rect.height / 2;
  const reach = Math.hypot(Math.max(px, rect.width - px), Math.max(py, rect.height - py));
  const r = Math.min(reach, RIPPLE_MAX_RADIUS);

  const layer = doc.createElement("span");
  layer.className = "tap-ink-layer";
  layer.setAttribute("aria-hidden", "true");
  const view = doc.defaultView;
  if (view && inkTone(view.getComputedStyle(host).color) === "light") layer.dataset.tone = "light";
  const ink = doc.createElement("span");
  ink.className = "tap-ink";
  ink.style.width = ink.style.height = `${2 * r}px`;
  if (typeof ink.animate !== "function") return null;
  layer.appendChild(ink);
  // First child: positioned children after it (a tile's badge) paint above the ink, and `:last-child` / space-*
  // rules of the host's own children are untouched.
  host.insertBefore(layer, host.firstChild);

  const at = `translate(${px - r}px, ${py - r}px)`;
  const anim = ink.animate(
    [
      { transform: `${at} scale(0.2)`, opacity: 1 },
      { transform: `${at} scale(1)`, opacity: 0.9, offset: 0.55 },
      { transform: `${at} scale(1)`, opacity: 0 },
    ],
    { duration: RIPPLE_MS, easing: EASE_OUT },
  );
  const done = () => layer.remove();
  anim.onfinish = done;
  anim.oncancel = done;
  return layer;
}

/** Installs the one delegated listener set on `doc`; returns the uninstaller. */
export function installTapRipple(doc: Document, opts: { reducedMotion: () => boolean }): () => void {
  const pending = new Map<number, { host: HTMLElement; x: number; y: number; timer: ReturnType<typeof setTimeout> }>();
  const listen = { capture: true, passive: true } as const;

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (opts.reducedMotion()) return;
    const host = rippleHost(e.target);
    if (!host) return;
    if (e.pointerType !== "touch") {
      spawnRipple(host, e.clientX, e.clientY);
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(e.pointerId);
      spawnRipple(host, e.clientX, e.clientY);
    }, TOUCH_DELAY_MS);
    pending.set(e.pointerId, { host, x: e.clientX, y: e.clientY, timer });
  };
  const onUp = (e: PointerEvent) => {
    const p = pending.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(e.pointerId);
    spawnRipple(p.host, p.x, p.y);
  };
  const onCancel = (e: PointerEvent) => {
    const p = pending.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(e.pointerId);
  };
  // iOS Safari applies `:active` only once the page listens for touches: a passive no-op is enough.
  const onTouch = () => undefined;

  doc.addEventListener("pointerdown", onDown, listen);
  doc.addEventListener("pointerup", onUp, listen);
  doc.addEventListener("pointercancel", onCancel, listen);
  doc.addEventListener("touchstart", onTouch, listen);
  return () => {
    doc.removeEventListener("pointerdown", onDown, listen);
    doc.removeEventListener("pointerup", onUp, listen);
    doc.removeEventListener("pointercancel", onCancel, listen);
    doc.removeEventListener("touchstart", onTouch, listen);
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
  };
}
