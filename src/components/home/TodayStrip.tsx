"use client";

import { AlarmClock, MailOpen, Sun } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * «امروز» in one line: three number chips (سررسیده · امروز · خوانده‌نشده), each opening the کارتابل pre-filtered.
 * Reads the shell's live summary, so it moves with the nav badges. Overdue > 0 turns its number and glyph red —
 * a red mark, never a red surface.
 */
export function TodayStrip() {
  const s = useInboxSummaryContext();
  return (
    <nav aria-label="امروز">
      <ul className="grid grid-cols-3 gap-2">
        <Cell href="/inbox?bucket=overdue" icon={AlarmClock} label="سررسیده" value={s.overdue} alert={s.overdue > 0} />
        <Cell href="/inbox?bucket=today" icon={Sun} label="امروز" value={s.dueToday} />
        <Cell href="/inbox?unread=1" icon={MailOpen} label="خوانده‌نشده" value={s.unread} />
      </ul>
    </nav>
  );
}

function Cell({ href, icon: Icon, label, value, alert = false }: { href: string; icon: typeof Sun; label: string; value: number; alert?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "pressable flex h-11 items-center justify-center gap-1.5 rounded-xl bg-surface px-2 text-xs shadow-1 hover:bg-info-soft/40",
          alert ? "text-danger" : "text-text-muted",
        )}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className={cn("tabular text-sm font-semibold", value === 0 && !alert ? "text-text-faint" : alert ? "text-danger" : "text-text")}>{formatNumberFa(value)}</span>
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
