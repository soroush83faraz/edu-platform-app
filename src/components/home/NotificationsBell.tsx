"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { CountBadge } from "@/components/CountBadge";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * Home's ONE door to «اعلان‌ها» (QA round 3: the bell left the navigation — owner: «too much for the sidebar»).
 * A 44 px outline bell at the start of the Home greeting row, carrying the unread count on the same yellow
 * `CountBadge` the nav used («۹۹+» cap); with nothing unread it is a quiet bell and no pill. It reads the shell's
 * single summary poller, so it moves with the «امروز» strip. Two tones because Home has two greeting rows, one per
 * breakpoint — `hero` on the phone banner's gradient, the default in the desktop page header — never both at once.
 */
export function NotificationsBell({ tone = "default" }: { tone?: "default" | "hero" }) {
  const unread = useInboxSummaryContext().unreadNotifications;
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `اعلان‌ها، ${formatNumberFa(unread)} خوانده‌نشده` : "اعلان‌ها"}
      className={cn(
        "pressable relative grid size-11 shrink-0 place-items-center rounded-full transition-base",
        tone === "hero" ? "text-on-hero hover:bg-white/15" : "text-text-muted hover:bg-surface-sunken hover:text-text",
      )}
    >
      <Bell className="size-6" strokeWidth={2} aria-hidden />
      <CountBadge count={unread} label={`${formatNumberFa(unread)} اعلان خوانده‌نشده`} floating className="top-1 end-1" />
    </Link>
  );
}
