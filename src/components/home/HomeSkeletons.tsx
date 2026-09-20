import { Skeleton } from "@/components/ui/skeleton";

/** Section placeholder that keeps the final layout: a title line and a card of `rows` rows. */
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="در حال بارگذاری" className="flex flex-col gap-3">
      <Skeleton className="h-5 w-28" />
      <div className="rounded-card bg-surface shadow-1">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
