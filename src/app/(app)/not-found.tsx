import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

/** Rendered for `notFound()` anywhere in the app shell — also for items the caller may not see. */
export default function AppNotFound() {
  return (
    <EmptyState
      title="چنین موردی پیدا نشد"
      description="ممکن است حذف شده باشد یا در دسترس شما نباشد."
      action={
        <Button asChild variant="outline" className="h-11">
          <Link href="/inbox">بازگشت به کارتابل</Link>
        </Button>
      }
    />
  );
}
