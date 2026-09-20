import { cn } from "cn";

/** One line of direction and (optionally) one action. No illustration, no mood copy. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-14 text-center", className)}>
      <p className="text-base font-medium text-text">{title}</p>
      {description ? <p className="max-w-xs text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
