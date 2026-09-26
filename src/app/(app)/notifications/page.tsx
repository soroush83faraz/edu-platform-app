import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/ctx";
import { audienceOf, emptyNotificationsCopy } from "@/lib/empty-copy";
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
  // In the reader's voice (تو / شما), text only — no illustration (UX review 2026-09-27).
  const empty = rows.length === 0 ? emptyNotificationsCopy(audienceOf((await requireContext()).assignments)) : null;
  const hasUnread = rows.some((r) => r.readAt === null);

  return (
    <ContentWidth className="gap-3">
      <PageHeader title="اعلان‌ها" actions={hasUnread ? <MarkAllReadButton disabled={false} /> : undefined} />
      {empty ? (
        <EmptyState title={empty.title} description={empty.description} />
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
