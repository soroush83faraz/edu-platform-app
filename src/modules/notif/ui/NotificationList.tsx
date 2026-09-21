"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { RelativeTime } from "@/components/RelativeTime";
import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction, markNotificationReadAction } from "../actions";
import type { NotificationRow } from "../repo";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await markAllNotificationsReadAction({});
          if (r.ok) router.refresh();
          else toast.error(r.message);
        })
      }
    >
      <CheckCheck aria-hidden />
      همه را خوانده‌شده کن
    </Button>
  );
}

/** Tap = mark read + follow the deep link. Unread rows are bold with a dot. */
export function NotificationList({ rows }: { rows: NotificationRow[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const open = (n: NotificationRow) =>
    start(async () => {
      const r = n.readAt ? { ok: true as const, data: { deepLink: n.deepLink } } : await markNotificationReadAction({ id: n.id });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      const link = r.data.deepLink ?? n.deepLink;
      if (link) router.push(link);
      else router.refresh();
    });

  return (
    <ul className="mx-4 divide-y divide-line/70 rounded-card bg-surface shadow-1">
      {rows.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => open(n)} className="flex min-h-[4.5rem] w-full items-start gap-3 px-4 py-3 text-start transition-base first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
            <span className={cn("mt-2.5 size-2.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-sky")} aria-label={n.readAt ? undefined : "خوانده‌نشده"} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn("line-clamp-2 text-base leading-6 text-text", n.readAt ? "font-medium" : "font-semibold")}>
                <bdi>{n.title}</bdi>
              </span>
              {n.body ? (
                <span className="line-clamp-2 text-sm text-text-muted">
                  <bdi>{n.body}</bdi>
                </span>
              ) : null}
            </span>
            <RelativeTime at={n.createdAt} mode="time" className="shrink-0 pt-1 text-xs text-text-faint" />
          </button>
        </li>
      ))}
    </ul>
  );
}
