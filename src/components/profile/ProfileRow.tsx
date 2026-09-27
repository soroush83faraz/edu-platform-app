import { ChevronLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { RowMark } from "@/components/RowMark";

/**
 * One row of a «حساب من» group: the whole row is the link — the quiet `RowMark` glyph, the title (`text-row`), an
 * optional hint under it (`text-meta`, muted), the end chevron. Rows sit in ONE `surface-work` card per group with
 * hairline dividers (`divide-y` on the list), so the row itself only tints on hover (`surface-sunken`) and settles on
 * press (`pressable`) — it is a row of a card, not a card, so it does not lift. The first/last row round with the
 * card so the tint never pokes out of its corners. At least 56 px tall.
 */
export function ProfileRow({ href, icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint?: string }) {
  return (
    <li className="group">
      <Link
        href={href}
        className="pressable flex min-h-14 items-center gap-3 px-4 py-2.5 text-text group-first:rounded-t-card group-last:rounded-b-card hover:bg-surface-sunken"
      >
        <RowMark icon={icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-row font-medium">{label}</span>
          {hint ? <span className="truncate text-meta text-text-muted">{hint}</span> : null}
        </span>
        <ChevronLeft className="size-5 shrink-0 text-text-faint" aria-hidden />
      </Link>
    </li>
  );
}
