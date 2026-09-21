import { Skeleton } from "@/components/ui/skeleton";

/** Grid placeholder of the same shape as the live tiles: `count` white cards with a chip and a label line. */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="در حال بارگذاری" className="grid grid-cols-3 gap-2.5 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-h-27 flex-col items-center justify-center gap-2.5 rounded-card bg-surface shadow-1">
          <Skeleton className="size-12 rounded-2xl" />
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Card placeholder that keeps the final layout: a title line and a card of `rows` rows. */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="در حال بارگذاری" className="flex flex-col gap-2.5">
      <Skeleton className="h-4 w-24" />
      <div className="rounded-card bg-surface shadow-1">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
