import { cn } from "cn";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "danger";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-surface-sunken text-text-muted",
  primary: "bg-primary-50 text-primary-700",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** Small status/type label. Never interactive — for tappable filters use `FilterChip`. */
export function Chip({ tone = "neutral", className, children, ...rest }: React.ComponentProps<"span"> & { tone?: ChipTone }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap", TONES[tone], className)} {...rest}>
      {children}
    </span>
  );
}
