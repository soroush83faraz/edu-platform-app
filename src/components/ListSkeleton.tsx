import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows for list pages (`loading.tsx`). Mirrors the inbox row height so the layout does not jump. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-busy="true" aria-label="در حال بارگذاری" className="flex flex-col divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-1 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-12 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
