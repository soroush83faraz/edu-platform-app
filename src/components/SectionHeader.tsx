import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { formatNumberFa } from "@/lib/format";

/** Group heading inside a list: a small glyph, the title, the count on a chip, an optional trailing control. */
export function SectionHeader({
  title,
  icon: Icon,
  count,
  tone = "neutral",
  trailing,
  className,
  as: Tag = "h3",
}: {
  title: string;
  icon?: LucideIcon;
  count?: number;
  tone?: "neutral" | "danger";
  trailing?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-5 pt-5 pb-1.5", className)}>
      <Tag className={cn("flex items-center gap-1.5 text-sm font-semibold", tone === "danger" ? "text-danger" : "text-text-muted")}>
        {Icon ? <Icon className="size-4" strokeWidth={1.75} aria-hidden /> : null}
        {title}
        {count !== undefined ? (
          <Chip tone={tone === "danger" ? "danger" : "neutral"} className="h-5 px-1.5">
            {formatNumberFa(count)}
          </Chip>
        ) : null}
      </Tag>
      {trailing}
    </div>
  );
}
