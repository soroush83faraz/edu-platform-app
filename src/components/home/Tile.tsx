import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { ClayIcon, type ClayShade } from "@/components/ClayIcon";

/**
 * One cell of the Home grid — a phone app icon: the persian-blue clay mark (68 px, 80 px from `md:`) straight on
 * the tinted canvas, no card, and a 13 px semibold label under it; tiles differ by glyph and label only («کار جدید»
 * alone is yellow). The whole cell (≥ 112 px tall, at most 128 px wide and centred in its column so wide screens
 * never pull mark and label apart — owner) is the pressable target. `muted` is the «به‌زودی» variant — the grey mark and a `text-muted` label under the
 * section's own «به‌زودی» heading (no per-tile tag: fourteen yellow tags fought the real yellow — the FAB and the badge). A badge comes in through `children`, positioned on the mark (`absolute`).
 */
export function Tile({
  href,
  label,
  icon,
  shade = "blue",
  mirror = false,
  muted = false,
  children,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  shade?: ClayShade;
  mirror?: boolean;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex justify-center">
      <Link
        href={href}
        className="pressable relative flex min-h-28 w-full max-w-32 flex-col items-center justify-start gap-2.5 rounded-card px-1 pt-2.5 pb-2 text-center hover:bg-surface/50"
      >
        <ClayIcon icon={icon} size="tile" shade={muted ? "grey" : shade} mirror={mirror}>
          {children}
        </ClayIcon>
        <span className={cn("text-[0.8125rem] leading-5 font-semibold text-balance", muted ? "text-text-muted" : "text-text")}>{label}</span>
      </Link>
    </li>
  );
}
