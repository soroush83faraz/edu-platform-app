import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

/**
 * Shades of the clay mark (`.clay-icon[data-shade]` in globals.css): `blue` — the one persian blue of every live
 * mark; `yellow` — the one action («کار جدید», high priority; navy glyph); `grey` — a cool navy-tinted grey for
 * «به‌زودی» and closed / low-priority rows. Marks differ by glyph and label, never by a different blue.
 */
export type ClayShade = "blue" | "yellow" | "grey";

/**
 * Mark sizes: compact rows 36, list rows and the «امروز» strip 40, detail facts 48, 56, and the Home tile — 68 px on
 * phones, 80 px from `md:`. The size is one CSS variable (`--ic-size`); radius, glyph and shadows scale from it.
 */
export type ClaySize = "sm" | "md" | "lg" | "xl" | "tile";
const SIZES: Record<ClaySize, string> = {
  sm: "[--ic-size:2.25rem]",
  md: "[--ic-size:2.5rem]",
  lg: "[--ic-size:3rem]",
  xl: "[--ic-size:3.5rem]",
  tile: "[--ic-size:4.25rem] md:[--ic-size:5rem]",
};

/**
 * The one icon material of the product: a calm persian-blue squircle (a gentle two-stop gradient, one thin top
 * highlight, one small navy shadow) with a white lucide glyph at stroke 2 (navy on yellow). Decorative by default; pass `label` when the icon is the
 * only thing naming the row. `mirror` flips glyphs that imply reading direction (arrows, send). `children` is a
 * badge or tag positioned by the caller (`absolute`) — the mark is `relative`.
 */
export function ClayIcon({
  icon: Icon,
  shade = "blue",
  size = "md",
  label,
  mirror = false,
  className,
  children,
}: {
  icon: LucideIcon;
  shade?: ClayShade;
  size?: ClaySize;
  label?: string;
  mirror?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={cn("clay-icon", SIZES[size], className)} data-shade={shade} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Icon strokeWidth={2} className={cn(mirror && "rtl:-scale-x-100")} aria-hidden />
      {children}
    </span>
  );
}
