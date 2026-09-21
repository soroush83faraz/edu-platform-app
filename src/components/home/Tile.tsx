import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { IconChip, type IconChipTone } from "@/components/IconChip";

/**
 * One cell of the Home grid: a white card ≥ 108 px tall with the icon chip on top and a two-line-max label under
 * it. `muted` is the «به‌زودی» variant — flat translucent white, grey chip, a small yellow-fill tag — so the eye
 * lands on what works today. A badge comes in through `children`, positioned on the chip (`absolute`).
 */
export function Tile({
  href,
  label,
  icon,
  tone = "primary",
  mirror = false,
  muted = false,
  tag,
  children,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  tone?: IconChipTone;
  mirror?: boolean;
  muted?: boolean;
  /** Small tag on the top-end corner (the «به‌زودی» of upcoming tiles). */
  tag?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex">
      <Link
        href={href}
        className={cn(
          "pressable relative flex min-h-27 w-full flex-col items-center justify-center gap-2.5 rounded-card px-2 pt-3 pb-2.5 text-center",
          muted ? "bg-surface/60 hover:bg-surface" : "bg-surface shadow-1 hover:bg-info-soft/40",
        )}
      >
        <IconChip icon={icon} size="lg" tone={muted ? "muted" : tone} mirror={mirror}>
          {children}
        </IconChip>
        <span className={cn("text-sm leading-5 font-medium text-balance", muted ? "text-text-muted" : "text-text")}>{label}</span>
        {tag ? <span className="absolute top-2 end-2 rounded-full bg-warning-soft px-1.5 text-xs leading-5 font-medium text-warning-text">{tag}</span> : null}
      </Link>
    </li>
  );
}
