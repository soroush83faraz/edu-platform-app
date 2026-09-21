import type { LucideIcon } from "lucide-react";
import { ClayIcon, type ClayShade, type ClaySize } from "@/components/ClayIcon";

/**
 * Semantic tones for places where the mark carries MEANING rather than a module identity: work-item priority and
 * status (inbox rows, detail facts), the roadmap's live/upcoming rows. Every tone is the one blue mark except
 * `warning` (yellow — high priority) and `muted` (grey — low priority, closed, upcoming); urgency's red stays on the
 * text and the due chip, and the tones remain so callers keep their meaning if the material changes again. The
 * `danger` TONE therefore stays blue: the red `danger` SHADE of `ClayIcon` is reserved for the «خروج» rows and is
 * not reachable through a tone (owner's rule — one red action in the product).
 */
export type IconChipTone = "primary" | "sky" | "warning" | "danger" | "success" | "violet" | "muted";
export type IconChipSize = ClaySize;

const SHADES: Record<IconChipTone, ClayShade> = {
  primary: "blue",
  sky: "blue",
  warning: "yellow",
  danger: "blue",
  success: "blue",
  violet: "blue",
  muted: "grey",
};

/** A `ClayIcon` addressed by semantic tone (`priorityChipTone`, status facts). Modules with an identity use `ClayIcon` with their own shade. */
export function IconChip({
  icon,
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
  /** A badge or tag positioned by the caller (`absolute`) — the mark is `relative`. */
  children?: React.ReactNode;
}) {
  return (
    <ClayIcon icon={icon} shade={SHADES[tone]} size={size} label={label} mirror={mirror} className={className}>
      {children}
    </ClayIcon>
  );
}
