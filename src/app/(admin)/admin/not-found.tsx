import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

/** `notFound()` inside /admin — also for a non-admin visitor and for rows outside the caller's scope. */
export default function AdminNotFound() {
  return (
    <EmptyState
      title="چنین موردی پیدا نشد"
      description="ممکن است حذف شده باشد یا در دسترس شما نباشد."
      action={
        <Button asChild variant="outline">
          <Link href="/home">بازگشت به خانه</Link>
        </Button>
      }
    />
  );
}
