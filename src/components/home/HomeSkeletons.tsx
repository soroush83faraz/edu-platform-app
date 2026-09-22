import { Skeleton } from "@/components/ui/skeleton";

/** Grid placeholder of the same shape as the live tiles: `count` clay-sized squircles with a label line, straight on the canvas. */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="در حال بارگذاری" className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mx-auto flex min-h-28 w-full max-w-32 flex-col items-center justify-start gap-2.5 pt-2.5">
          <Skeleton className="size-17 rounded-[1.125rem] bg-neutral-200 md:size-20" />
          <Skeleton className="h-3.5 w-14 bg-neutral-200" />
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
