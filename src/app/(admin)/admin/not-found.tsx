import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { TopBarBack } from "@/components/shell/TopBarBack";
import { Button } from "@/components/ui/button";
import { getUiVariant } from "@/lib/ui-variant";

/**
 * `notFound()` inside /admin — also for a non-admin visitor and for rows outside the caller's scope.
 * An inner page like any other: in the hub layout the top bar's start slot carries «خانه» (`TopBarBack`).
 */
export default async function AdminNotFound() {
  const hub = (await getUiVariant()) === "hub";
  return (
    <>
      {hub ? <TopBarBack href="/home" label="خانه" /> : null}
      <EmptyState
        title="چنین موردی پیدا نشد"
        description="ممکن است حذف شده باشد یا در دسترس شما نباشد."
        action={
          <Button asChild variant="outline">
            <Link href="/home">بازگشت به خانه</Link>
          </Button>
        }
      />
    </>
  );
}
