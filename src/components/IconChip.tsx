import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

export type IconChipTone = "primary" | "sky" | "warning" | "danger" | "success" | "muted";
export type IconChipSize = "sm" | "md" | "lg";

/** Chip box / icon glyph, in px: compact rows 36/18, list rows 40/20, Home tiles and detail facts 48/24. */
const SIZES: Record<IconChipSize, { box: string; icon: number }> = {
  sm: { box: "size-9 rounded-xl", icon: 18 },
  md: { box: "size-10 rounded-[0.875rem]", icon: 20 },
  lg: { box: "size-12", icon: 24 },
};

/**
 * The one icon material of the product: a soft-3D "clay" chip (top-light gradient, inset highlight, tinted glow —
 * `.icon-chip` in globals.css) around a lucide glyph at stroke 1.75. Decorative by default; pass `label` when the
 * icon is the only thing naming the row. `mirror` flips glyphs that imply reading direction (arrows, send).
 */
export function IconChip({
  icon: Icon,
  tone = "primary",
  size = "md",
  label,
  mirror = false,
  className,
  children,
}: {
  icon: LucideIcon;
  tone?: IconChipTone;
  size?: IconChipSize;
  label?: string;
  mirror?: boolean;
  className?: string;
  /** A badge or tag positioned by the caller (`absolute`) — the chip is `relative`. */
  children?: React.ReactNode;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("icon-chip relative", s.box, className)} data-tone={tone} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Icon size={s.icon} strokeWidth={1.75} className={cn(mirror && "rtl:-scale-x-100")} aria-hidden />
      {children}
    </span>
  );
}
