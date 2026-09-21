"use client";

import { AlarmClock, MailOpen, Sun } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { ClayIcon } from "@/components/ClayIcon";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * «امروز» in one line: three white cells (سررسیده · امروز · خوانده‌نشده), each a 40 px blue clay mark with the bold
 * primary-700 number and its label stacked beside it, each opening the کارتابل pre-filtered.
 * Reads the shell's live summary, so it moves with the nav badges. A zero fades to text-faint; overdue > 0 turns its
 * number red — a red mark, never a red surface.
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

function Cell({ href, icon, label, value, alert = false }: { href: string; icon: typeof Sun; label: string; value: number; alert?: boolean }) {
  return (
    <li>
      <Link href={href} className="pressable flex min-h-14 items-center gap-1.5 rounded-card bg-surface px-1.5 shadow-1 hover:bg-primary-50">
        <ClayIcon icon={icon} size="md" />
        <span className="flex min-w-0 flex-col">
          <span className={cn("tabular text-base leading-5 font-bold", value === 0 && !alert ? "text-text-faint" : alert ? "text-danger" : "text-primary-700")}>{formatNumberFa(value)}</span>
          <span className="line-clamp-2 text-[0.6875rem] leading-4 text-text-muted">{label}</span>
        </span>
      </Link>
    </li>
  );
}
