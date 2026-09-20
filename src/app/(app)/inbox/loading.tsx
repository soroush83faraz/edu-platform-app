import { ListSkeleton } from "@/components/ListSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <div className="flex flex-col">
      <div className="px-4 pt-5 pb-3 md:pt-8">
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="px-4">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="mt-6 bg-surface">
        <ListSkeleton rows={6} />
      </div>
    </div>
  );
}
