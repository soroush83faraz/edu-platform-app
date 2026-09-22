"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { CountBadge } from "@/components/CountBadge";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * Home's ONE door to «پنل من» (QA round 4: the کارتابل left the navigation with the bell — the nav carries
 * places, the work surfaces live on Home). A 44 px outline کارتابل glyph beside the bell in the Home greeting
 * row, carrying the unread count on the same yellow `CountBadge` the nav used («۹۹+» cap); with nothing unread it
 * is a quiet glyph and no pill. It reads the shell's single summary poller, so it moves with the «امروز» strip —
 * whose three links are FILTERS of this same کارتابل, not a second door. Two tones because Home has two greeting
 * rows, one per breakpoint — `hero` on the phone banner's gradient, the default in the desktop page header —
 * never both at once.
 */
export function InboxDoor({ tone = "default" }: { tone?: "default" | "hero" }) {
  const unread = useInboxSummaryContext().unread;
  return (
    <Link
      href="/inbox"
      aria-label={unread > 0 ? `پنل من، ${formatNumberFa(unread)} خوانده‌نشده` : "پنل من"}
      className={cn(
        "pressable relative grid size-11 shrink-0 place-items-center rounded-full transition-base",
        tone === "hero" ? "text-on-hero hover:bg-white/15" : "text-text-muted hover:bg-surface-sunken hover:text-text",
      )}
    >
      <Inbox className="size-6" strokeWidth={2} aria-hidden />
      <CountBadge count={unread} label={`${formatNumberFa(unread)} مورد خوانده‌نشده`} floating className="top-1 end-1" />
    </Link>
  );
}
