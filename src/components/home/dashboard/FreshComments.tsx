import { ChevronLeft, MessageSquare } from "lucide-react";
import Link from "next/link";
import { PageSection } from "@/components/layout/PageSection";
import { RelativeTime } from "@/components/RelativeTime";
import { unreadCommentNotificationsQuery } from "@/modules/notif/queries";

/**
 * «نظرهای تازه» (teachers): the newest unread comment notifications, five at most, each opening its کار (the
 * notification is marked read on the notifications page; here the row is a plain link to the deep link).
 */
export async function FreshComments() {
  const r = await unreadCommentNotificationsQuery();
  const rows = r.ok ? r.data : [];
  return (
    <PageSection
      id="fresh-comments"
      title="نظرهای تازه"
      icon={MessageSquare}
      count={rows.length > 0 ? rows.length : undefined}
      surface="work"
      flush
      trailing={
        <Link href="/notifications" className="pressable inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          اعلان‌ها
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">نظر خوانده‌نشده‌ای ندارید.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={n.deepLink ?? "/notifications"} className="pressable flex min-h-14 items-start gap-3 px-4 py-2.5 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                <span className="mt-2 size-2 shrink-0 rounded-full bg-sky" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-row font-semibold text-text">
                    <bdi>{n.title}</bdi>
                  </span>
                  {n.body ? (
                    <span className="line-clamp-1 text-meta text-text-muted">
                      <bdi>{n.body}</bdi>
                    </span>
                  ) : null}
                </span>
                <RelativeTime at={n.createdAt} mode="time" className="shrink-0 pt-0.5 text-meta text-text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
