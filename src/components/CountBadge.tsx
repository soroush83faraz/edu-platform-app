"use client";

import { cn } from "cn";
import { useCountRoll } from "@/components/motion/RollingNumber";
import { formatNumberFa } from "@/lib/format";

/**
 * A count on a yellow pill with navy text (yellow is a fill, never text): the nav badges. Renders nothing
 * for zero; caps at «۹۹+». `floating` pins it to the top-end corner of a `relative` parent with a white ring.
 * When the count changes (never on first render) the new number rolls in — up when it grew, down when it shrank —
 * and a badge that comes back from zero pops in (250 ms; still under reduced motion). `memoryKey` lets a badge that
 * is mounted again roll from what it showed last in this app session.
 */
export function CountBadge({ count, label, floating = false, memoryKey, className }: { count: number; label: string; floating?: boolean; memoryKey?: string; className?: string }) {
  const roll = useCountRoll(count, memoryKey);
  if (count <= 0) return null;
  const appeared = roll.dir !== null && (roll.from ?? 0) <= 0;
  return (
    <span
      key={appeared ? `pop-${roll.key}` : "badge"}
      className={cn(
        "tabular inline-flex h-5 min-w-5 items-center justify-center overflow-hidden rounded-full bg-warning px-1.5 text-xs font-semibold leading-none text-primary-900",
        floating && "absolute -top-1.5 -end-2.5 ring-2 ring-surface",
        appeared && "badge-pop",
        className,
      )}
      aria-label={label}
    >
      <span key={roll.key} className={appeared ? undefined : roll.dir === "up" ? "count-up" : roll.dir === "down" ? "count-down" : undefined}>
        {count > 99 ? `${formatNumberFa(99)}+` : formatNumberFa(count)}
      </span>
    </span>
  );
}
