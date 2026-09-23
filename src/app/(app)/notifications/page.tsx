import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { BellClay } from "@/components/illustrations";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { listNotificationsQuery } from "@/modules/notif/queries";
import { MarkAllReadButton, NotificationList } from "@/modules/notif/ui/NotificationList";

export const metadata: Metadata = { title: "اعلان‌ها" };

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
    <ContentWidth className="gap-3">
      <PageHeader title="اعلان‌ها" actions={hasUnread ? <MarkAllReadButton disabled={false} /> : undefined} />
      {rows.length === 0 ? (
        <EmptyState illustration={<BellClay size={128} />} title="اعلانی ندارید" description="تکلیف جدید، نظر تازه و تغییر وضعیت تکالیف این‌جا خبر داده می‌شود." />
      ) : (
        <>
          <NotificationList rows={rows} />
          {nextCursor || cursor ? (
            <div className="flex items-center justify-center gap-3 py-5">
              {cursor ? (
                <Button asChild variant="ghost">
                  <Link href="/notifications">بازگشت به ابتدا</Link>
                </Button>
              ) : null}
              {nextCursor ? (
                <Button asChild variant="outline">
                  <Link href={`/notifications?cursor=${encodeURIComponent(nextCursor)}`}>نمایش بیشتر</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </ContentWidth>
  );
}
