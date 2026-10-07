import { ContentWidth } from "@/components/layout/ContentWidth";
import { ListSkeleton } from "@/components/ListSkeleton";
import { TopBarBack } from "@/components/shell/TopBarBack";
import { Skeleton } from "@/components/ui/skeleton";
import { getUiVariant } from "@/lib/ui-variant";

export default async function InboxLoading() {
  const hub = (await getUiVariant()) === "hub";
  return (
    <ContentWidth className="gap-3">
      {/* «پنل من» goes back to Home (its `PageHeader`): the pill is in the top bar from the first frame. */}
      {hub ? <TopBarBack href="/home" label="خانه" /> : null}
      <div className="pt-4 lg:pt-17">
        <Skeleton className="h-8 w-24" />
      </div>
      {/* The one list (no tabs since the unified list, mock class-page-v3). */}
      <div className="surface-work mt-1 overflow-hidden">
        <ListSkeleton rows={6} />
      </div>
    </ContentWidth>
  );
}
