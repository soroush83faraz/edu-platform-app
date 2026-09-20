import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { listNotificationsQuery } from "@/modules/notif/queries";
import { MarkAllReadButton, NotificationList } from "@/modules/notif/ui/NotificationList";

export const metadata: Metadata = { title: "اعلان‌ها | سامانهٴ مدرسه" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cursor = typeof sp.cursor === "string" && sp.cursor ? sp.cursor : undefined;
  const result = await listNotificationsQuery({ cursor });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="اعلان‌ها در دسترس نیست" description={result.message} />;
  }
  const { rows, nextCursor } = result.data;
  const hasUnread = rows.some((r) => r.readAt === null);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-5 pb-3 md:pt-8">
        <h2 className="text-xl font-bold text-text">اعلان‌ها</h2>
        {rows.length > 0 ? <MarkAllReadButton disabled={!hasUnread} /> : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="اعلانی ندارید" description="کار جدید، نظر تازه و تغییر وضعیت کارها این‌جا خبر داده می‌شود." />
      ) : (
        <>
          <NotificationList rows={rows} />
          {nextCursor || cursor ? (
            <div className="flex items-center justify-center gap-3 px-4 py-5">
              {cursor ? (
                <Button asChild variant="ghost" className="h-11">
                  <Link href="/notifications">بازگشت به ابتدا</Link>
                </Button>
              ) : null}
              {nextCursor ? (
                <Button asChild variant="outline" className="h-11 px-5">
                  <Link href={`/notifications?cursor=${encodeURIComponent(nextCursor)}`}>نمایش بیشتر</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
