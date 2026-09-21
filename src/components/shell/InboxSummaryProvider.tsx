"use client";

import { createContext, useContext } from "react";
import { type InboxSummaryState, useInboxSummary } from "./useInboxSummary";

const InboxSummaryContext = createContext<InboxSummaryState | null>(null);

/**
 * Holds the ONE summary poller of the shell (see `useInboxSummary`) so the nav badges, the Home «امروز» strip and
 * the Home tile badges all read the same live numbers. Rendered once by `AppShell` around nav + content.
 */
export function InboxSummaryProvider({ initial, children }: { initial: InboxSummaryState; children: React.ReactNode }) {
  const summary = useInboxSummary(initial);
  return <InboxSummaryContext.Provider value={summary}>{children}</InboxSummaryContext.Provider>;
}

const ZERO: InboxSummaryState = { overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 0 };

/** The live counts; zeros outside the shell (tests, isolated renders). */
export function useInboxSummaryContext(): InboxSummaryState {
  return useContext(InboxSummaryContext) ?? ZERO;
}
