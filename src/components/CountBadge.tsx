import { cn } from "cn";
import { formatNumberFa } from "@/lib/format";

/**
 * A count on a yellow pill with navy text (yellow is a fill, never text): the nav badges. Renders nothing
 * for zero; caps at ۹۹. `floating` pins it to the top-end corner of a `relative` parent with a white ring.
 */
export function CountBadge({ count, label, floating = false, className }: { count: number; label: string; floating?: boolean; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-semibold leading-none text-primary-900",
        floating && "absolute -top-1.5 -end-2.5 ring-2 ring-surface",
        className,
      )}
      aria-label={label}
    >
      {formatNumberFa(count > 99 ? 99 : count)}
    </span>
  );
}
