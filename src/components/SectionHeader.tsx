import { cn } from "cn";
import { formatNumberFa } from "@/lib/format";

/** Group heading inside a list: title, optional count, optional trailing control. */
export function SectionHeader({
  title,
  count,
  tone = "neutral",
  trailing,
  className,
  as: Tag = "h3",
}: {
  title: string;
  count?: number;
  tone?: "neutral" | "danger";
  trailing?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-4 pt-5 pb-1", className)}>
      <Tag className={cn("flex items-baseline gap-2 text-sm font-semibold", tone === "danger" ? "text-danger" : "text-text-muted")}>
        {title}
        {count !== undefined ? <span className="tabular text-xs font-medium">{formatNumberFa(count)}</span> : null}
      </Tag>
      {trailing}
    </div>
  );
}
