"use client";

import { useEffect, useState } from "react";
import { formatNumberFa } from "@/lib/format";

export interface InboxSummaryState {
  overdue: number;
  dueToday: number;
  unread: number;
  unreadNotifications: number;
}

export const POLL_INTERVAL_MS = 45_000;

function sameSummary(a: InboxSummaryState, b: InboxSummaryState): boolean {
  return a.overdue === b.overdue && a.dueToday === b.dueToday && a.unread === b.unread && a.unreadNotifications === b.unreadNotifications;
}

/**
 * Server-rendered initial counts, then GET /api/inbox/summary every 45 s while the tab is visible and online
 * (and once immediately when it becomes visible again). Mirrors the unread count into `document.title`.
 */
export function useInboxSummary(initial: InboxSummaryState): InboxSummaryState {
  const [summary, setSummary] = useState(initial);
  // After router.refresh() the layout re-renders with fresh server counts: adopt them (React's "adjust state
  // when a prop changes" pattern — compared by value, since the object identity changes on every render).
  const [seen, setSeen] = useState(initial);
  if (!sameSummary(seen, initial)) {
    setSeen(initial);
    setSummary(initial);
  }

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      try {
        const res = await fetch("/api/inbox/summary", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<InboxSummaryState>;
        if (cancelled) return;
        setSummary({
          overdue: data.overdue ?? 0,
          dueToday: data.dueToday ?? 0,
          unread: data.unread ?? 0,
          unreadNotifications: data.unreadNotifications ?? 0,
        });
      } catch {
        /* offline / aborted: keep the last counts */
      }
    };
    const schedule = () => {
      window.clearInterval(timer);
      timer = window.setInterval(poll, POLL_INTERVAL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void poll();
        schedule();
      } else {
        window.clearInterval(timer);
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  useEffect(() => {
    const base = document.title.replace(/^\([^)]*\)\s*/, "");
    const total = summary.unread + summary.unreadNotifications;
    document.title = total > 0 ? `(${formatNumberFa(total)}) ${base}` : base;
  }, [summary.unread, summary.unreadNotifications]);

  return summary;
}
