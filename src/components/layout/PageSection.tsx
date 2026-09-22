import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { formatNumberFa } from "@/lib/format";

export type SectionSurface = "work" | "panel" | "quiet";

/**
 * A titled block of a page in one of the three surface roles. `work` — the heading sits above a white
 * `surface-work` box (the page's primary content); `panel` — a `surface-panel` box (supporting content, asides);
 * `quiet` — no box: the heading, the content, a hairline under the section. The heading is `text-section` with
 * an optional glyph, a tabular count and a trailing control (a link, a toggle) at the end. `flush` removes the
 * box padding so a list can divide the box edge to edge.
 */
export function PageSection({
  title,
  id,
  icon: Icon,
  count,
  trailing,
  surface = "quiet",
  flush = false,
  as: Tag = "section",
  headingAs: Heading = "h2",
  className,
  children,
}: {
  title: string;
  id: string;
  icon?: LucideIcon;
  count?: number;
  trailing?: React.ReactNode;
  surface?: SectionSurface;
  flush?: boolean;
  as?: "section" | "div";
  headingAs?: "h2" | "h3";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag aria-labelledby={`${id}-heading`} className={cn("flex flex-col gap-2.5", surface === "quiet" && "surface-quiet", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <Heading id={`${id}-heading`} className="flex items-center gap-2 text-section font-semibold text-text">
          {Icon ? <Icon className="size-5 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden /> : null}
          <span className="truncate">{title}</span>
          {count !== undefined ? <span className="tabular text-meta font-normal text-text-muted">{formatNumberFa(count)}</span> : null}
        </Heading>
        {trailing}
      </div>
      {surface === "quiet" ? children : <div className={cn(surface === "work" ? "surface-work" : "surface-panel", !flush && "p-4")}>{children}</div>}
    </Tag>
  );
}
