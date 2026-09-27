import { ListSkeleton } from "@/components/ListSkeleton";
import { CardSkeleton, DashboardSkeleton, GridSkeleton } from "@/components/home/HomeSkeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentWidth } from "./ContentWidth";

/**
 * The route-level placeholder (`loading.tsx`): what a click paints at once while the page's reads land, in the
 * page's own frame — `ContentWidth` (or none inside /admin, whose layout already draws it) and a header of the
 * same height as `PageHeader` (the slim context bar from `lg:`, then the title), so nothing jumps when the page
 * arrives. The shapes are the page kinds of the app:
 *
 * - `list`   — a list page: a white card of inbox-height rows (کارتابل, اعلان‌ها, admin lists).
 * - `detail` — a detail page at the reading measure: a back link, the title, one card (a تکلیف, a درس, a person).
 * - `cards`  — a hub of sections: a few titled cards (بیشتر, کلاس من, کلاس‌ها, /admin).
 * - `home`   — Home: the tile grid on phones, the dashboard from `lg:`.
 *
 * Why it exists (docs/decisions.md «navigation feel»): a dynamic route with a loading boundary is prefetched down
 * to that boundary, so the click commits the placeholder instantly instead of waiting for the server render.
 */
export function PageSkeleton({ kind, framed = true, rows = 6 }: { kind: "list" | "detail" | "cards" | "home"; framed?: boolean; rows?: number }) {
  const body = (
    <div aria-busy="true" aria-label="در حال بارگذاری" className="flex flex-col gap-5">
      <HeaderSkeleton back={kind === "detail"} />
      {kind === "list" ? (
        <div className="surface-work overflow-hidden">
          <ListSkeleton rows={rows} />
        </div>
      ) : null}
      {kind === "detail" ? (
        <div className="surface-work flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {kind === "cards" ? (
        <>
          <CardSkeleton rows={3} />
          <CardSkeleton rows={2} />
        </>
      ) : null}
      {kind === "home" ? (
        <>
          <div className="lg:hidden">
            <GridSkeleton />
          </div>
          <div className="hidden lg:block">
            <DashboardSkeleton />
          </div>
        </>
      ) : null}
    </div>
  );
  if (!framed) return body;
  return <ContentWidth size={kind === "detail" ? "reading" : "full"}>{body}</ContentWidth>;
}

/** `PageHeader`'s footprint: phones — the title row under a 16 px top; from `lg:` — the 48 px context bar, then the title. */
function HeaderSkeleton({ back }: { back: boolean }) {
  return (
    <div className="flex flex-col gap-2 pt-4 lg:pt-0">
      <div className="hidden min-h-12 items-center border-b border-line/80 lg:flex">
        <Skeleton className="h-3.5 w-48" />
      </div>
      {back ? <Skeleton className="h-4 w-20 lg:mt-4" /> : null}
      <Skeleton className="h-8 w-40 lg:mt-5 lg:h-9" />
    </div>
  );
}
