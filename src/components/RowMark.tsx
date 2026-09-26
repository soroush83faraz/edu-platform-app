import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { Priority } from "@/components/priority";

export type RowMarkTone = "muted" | "danger";
export type RowMarkSize = "md" | "lg";

/**
 * The quiet glyph of a list row (Design v2 icon restraint): a plain lucide glyph at 20 px in `text-muted`, inside a
 * 32 px `surface-panel` circle — the sunken tint with a hairline, no shadow, no blue. The clay mark (`ClayIcon`)
 * is reserved for the Home tiles, illustration spots and login; a row of a درس leads with `SubjectStamp`; every other row uses this,
 * so a page has ONE strong mark at most. `bare` drops the circle (inline facts, chips). `danger` is the one red
 * action («خروج»). `lg` (48 px, 24 px glyph) for the profile card and detail facts.
 */
export function RowMark({
  icon: Icon,
  tone = "muted",
  size = "md",
  bare = false,
  label,
  mirror = false,
  className,
}: {
  icon: LucideIcon;
  tone?: RowMarkTone;
  size?: RowMarkSize;
  bare?: boolean;
  label?: string;
  mirror?: boolean;
  className?: string;
}) {
  const glyph = <Icon className={cn(size === "lg" ? "size-6" : "size-5", mirror && "rtl:-scale-x-100")} strokeWidth={1.75} aria-hidden />;
  const color = tone === "danger" ? "text-danger" : "text-text-muted";
  if (bare) {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center", color, className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        {glyph}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full ring-1 ring-inset",
        size === "lg" ? "size-12" : "size-8",
        tone === "danger" ? "bg-danger-soft ring-danger/20" : "bg-surface-sunken ring-line",
        color,
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {glyph}
    </span>
  );
}

const PRIORITY_DOT: Partial<Record<Priority, { className: string; label: string }>> = {
  high: { className: "bg-warning ring-warning/40", label: "اولویت بالا" },
  urgent: { className: "bg-danger ring-danger/30", label: "فوری" },
};

/** Priority as a small dot beside the title — yellow for high, red for urgent, nothing for normal/low (the mark never carries it). */
export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  const dot = PRIORITY_DOT[priority];
  if (!dot) return null;
  return <span className={cn("inline-block size-2 shrink-0 rounded-full ring-2", dot.className, className)} role="img" aria-label={dot.label} title={dot.label} />;
}
