import { cn } from "cn";

/** One line of direction, one optional illustration and at most one action. No mood copy. */
export function EmptyState({
  title,
  description,
  action,
  illustration,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** A clay illustration (`src/components/illustrations`), 120–160px. */
  illustration?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {illustration ? <div className="mb-2">{illustration}</div> : null}
      <p className="text-base font-medium text-text">{title}</p>
      {description ? <p className="max-w-xs text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
