import type { LucideIcon } from "lucide-react";
import { ClayIcon } from "@/components/ClayIcon";
import { cn } from "@/lib/cn";

/**
 * The face of a module tile that is NOT a Home door: the clay mark, the label under it and — for a module that is not
 * built yet — the grey mark, a muted label and a small «به‌زودی» pill. Shared by Home's «به‌زودی» section
 * (`UpcomingTiles`) and the /roadmap tiles, so both draw one shape. All spans (phrasing content), so it can sit inside
 * a `<summary>`. The caller owns interaction: Home's tiles are inert (`inert` → `aria-disabled`), the roadmap's open
 * their description.
 */
export function ModuleTileFace({
  icon,
  label,
  soon = false,
  compact = false,
  inert = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  soon?: boolean;
  compact?: boolean;
  inert?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-disabled={inert ? "true" : undefined}
      className={cn(
        "flex w-full max-w-32 flex-col items-center justify-start px-1 text-center",
        compact ? "min-h-24 gap-1.5 pt-2 pb-1.5" : "min-h-28 gap-2 pt-2.5 pb-2",
        className,
      )}
    >
      <ClayIcon icon={icon} size={compact ? "xl" : "tile"} shade={soon ? "grey" : "blue"} rippleHost={!inert} />
      <span className={cn("text-meta font-semibold text-balance", soon ? "text-text-muted" : "text-text")}>{label}</span>
      {soon ? <span className="rounded-full bg-surface px-2 text-xs leading-5 font-medium text-text-muted">به‌زودی</span> : null}
    </span>
  );
}
