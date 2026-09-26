"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CheckBurst } from "@/components/motion/DrawnCheck";
import { RollingNumber, rememberCount } from "@/components/motion/RollingNumber";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { clearPendingCelebration, pendingCelebration, readCelebratedDay, shouldCelebrate, tehranDayKey, writeCelebratedDay } from "@/lib/completion-moment";
import { formatNumberFa } from "@/lib/format";

/**
 * «امروز» in ONE sentence (UX review 2026-09-27, owner): «۲ تکلیف عقب‌افتاده · ۱ تکلیف برای امروز · ۳ اعلان
 * خوانده‌نشده» — zeros omitted, each fragment a link to its filtered place (the کارتابل's overdue / today bucket,
 * «اعلان‌ها»), and only the overdue number in danger text. With nothing to say it is one calm line in the reader's
 * own voice: «تو» for a student, «شما» for staff. `noun` is the reader's word for a کار (`workItemVoice` —
 * «تکلیف» / «تسک»). Reads the shell's live summary, so it moves with the badges.
 *
 * Motion answers the reader's own work (docs/decisions «حرکت در پاسخ به کار کاربر»): a number that changed since
 * they last saw it rolls (`RollingNumber`, remembered across pages); and when a student has just finished the last
 * overdue / today item, the line becomes «همهٴ کارهای امروز انجام شد» with a small check burst — once a day.
 */
export function TodayStrip({ noun, student }: { noun: string; student: boolean }) {
  const s = useInboxSummaryContext();
  // Decided once, on mount, from a finish noted by the detail page in this app session (never on the server:
  // the note is only ever set by a click, so a hydrating render always starts false here too).
  const [celebrate] = useState(() =>
    typeof window === "undefined"
      ? false
      : shouldCelebrate({ student, overdue: s.overdue, dueToday: s.dueToday, pendingDay: pendingCelebration(), celebratedDay: pendingCelebration() ? readCelebratedDay() : null, today: tehranDayKey() }),
  );
  useEffect(() => {
    if (celebrate) writeCelebratedDay(tehranDayKey());
    // Seen by the line either way: a finish that was not the last one has nothing left to celebrate.
    clearPendingCelebration();
  }, [celebrate]);

  const parts = [
    { key: "overdue", href: "/inbox?bucket=overdue", value: s.overdue, rest: `${noun} عقب‌افتاده`, alert: true },
    { key: "today", href: "/inbox?bucket=today", value: s.dueToday, rest: `${noun} برای امروز`, alert: false },
    { key: "notif", href: "/notifications", value: s.unreadNotifications, rest: "اعلان خوانده‌نشده", alert: false },
  ];
  // A fragment that is filtered out still remembers its zero, so it rolls up when it comes back.
  useEffect(() => {
    for (const p of parts) if (p.value === 0) rememberCount(`today.${p.key}`, 0);
  });
  const shown = parts.filter((p) => p.value > 0 && !(celebrate && p.key !== "notif"));

  if (shown.length === 0 && !celebrate) {
    return <p className="text-row text-text-muted">{student ? "امروز کار عقب‌افتاده‌ای نداری." : "کار عقب‌افتاده‌ای ندارید."}</p>;
  }
  return (
    <nav aria-label="امروز">
      <ul className="flex flex-wrap items-center gap-x-1 text-row text-text">
        {celebrate ? (
          <li className="flex min-h-11 items-center gap-2 font-semibold" role="status">
            <CheckBurst className="-ms-1" />
            همهٴ کارهای امروز انجام شد
          </li>
        ) : null}
        {shown.map((p, i) => (
          <li key={p.key} className="flex items-center gap-x-1">
            {i > 0 || celebrate ? (
              <span aria-hidden className="text-text-faint">
                ·
              </span>
            ) : null}
            {/* 24 px line + 10 px above and below: a 44 px target that still reads as words in a sentence. */}
            <Link href={p.href} className="pressable inline-block rounded-lg py-2.5 underline decoration-line-strong underline-offset-4 hover:decoration-current">
              <RollingNumber value={p.value} memoryKey={`today.${p.key}`} className={cn("tabular font-bold", p.alert ? "text-danger" : "text-text")}>
                {formatNumberFa(p.value)}
              </RollingNumber>{" "}
              {p.rest}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
