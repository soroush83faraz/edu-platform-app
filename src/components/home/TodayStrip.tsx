"use client";

import Link from "next/link";
import { cn } from "cn";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * «امروز» in ONE sentence (UX review 2026-09-27, owner): «۲ تکلیف عقب‌افتاده · ۱ تکلیف برای امروز · ۳ اعلان
 * خوانده‌نشده» — zeros omitted, each fragment a link to its filtered place (the کارتابل's overdue / today bucket,
 * «اعلان‌ها»), and only the overdue number in danger text. With nothing to say it is one calm line in the reader's
 * own voice: «تو» for a student, «شما» for staff. `noun` is the reader's word for a کار (`workItemVoice` —
 * «تکلیف» / «تسک»). Reads the shell's live summary, so it moves with the badges.
 */
export function TodayStrip({ noun, student }: { noun: string; student: boolean }) {
  const s = useInboxSummaryContext();
  const parts = [
    { key: "overdue", href: "/inbox?bucket=overdue", value: s.overdue, rest: `${noun} عقب‌افتاده`, alert: true },
    { key: "today", href: "/inbox?bucket=today", value: s.dueToday, rest: `${noun} برای امروز`, alert: false },
    { key: "notif", href: "/notifications", value: s.unreadNotifications, rest: "اعلان خوانده‌نشده", alert: false },
  ].filter((p) => p.value > 0);

  if (parts.length === 0) {
    return <p className="text-row text-text-muted">{student ? "امروز کار عقب‌افتاده‌ای نداری." : "کار عقب‌افتاده‌ای ندارید."}</p>;
  }
  return (
    <nav aria-label="امروز">
      <ul className="flex flex-wrap items-center gap-x-1 text-row text-text">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center gap-x-1">
            {i > 0 ? (
              <span aria-hidden className="text-text-faint">
                ·
              </span>
            ) : null}
            {/* 24 px line + 10 px above and below: a 44 px target that still reads as words in a sentence. */}
            <Link href={p.href} className="pressable inline-block rounded-lg py-2.5 underline decoration-line-strong underline-offset-4 hover:decoration-current">
              <span className={cn("tabular font-bold", p.alert ? "text-danger" : "text-text")}>{formatNumberFa(p.value)}</span> {p.rest}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
