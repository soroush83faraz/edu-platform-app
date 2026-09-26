"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { CountBadge } from "@/components/CountBadge";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * Home's ONE door to «اعلان‌ها» (QA round 3: the bell left the navigation — owner: «too much for the sidebar»).
 * A 44 px outline bell at the start of the Home greeting row, carrying the unread count on the same yellow
 * `CountBadge` the nav used («۹۹+» cap); with nothing unread it is a quiet bell and no pill. It reads the shell's
 * single summary poller, so it moves with the «امروز» line. Home has two greeting rows, one per breakpoint — the
 * flat phone header and the desktop page header — never both at once, and both sit on the canvas.
 */
export function NotificationsBell() {
  const unread = useInboxSummaryContext().unreadNotifications;
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `اعلان‌ها، ${formatNumberFa(unread)} خوانده‌نشده` : "اعلان‌ها"}
      className="pressable relative grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-base hover:bg-surface hover:text-text"
    >
      <Bell className="size-6" strokeWidth={2} aria-hidden />
      <CountBadge count={unread} label={`${formatNumberFa(unread)} اعلان خوانده‌نشده`} floating className="-top-0.5 -end-1.5" />
    </Link>
  );
}
