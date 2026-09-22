import { ContentWidth } from "@/components/layout/ContentWidth";
import { ListSkeleton } from "@/components/ListSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <ContentWidth className="gap-3">
      <div className="pt-4 lg:pt-17">
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-14 w-full rounded-2xl sm:h-11" />
      <div className="surface-work mt-3 overflow-hidden">
        <ListSkeleton rows={6} />
      </div>
    </ContentWidth>
  );
}
