// The moment a کار is finished, carried between pages of one app session (docs/decisions «حرکت در پاسخ به کار
// کاربر»). The detail page's «انجام شد» notes it here; two places read it later:
//
// - the کارتابل list, which may come back from the router's cache still showing the finished row: it strikes the
//   row, refreshes, and the row collapses out instead of popping (`LeavingList`);
// - Home's «امروز» line (`TodayStrip`), which turns into «همهٴ کارهای امروز انجام شد» with a small check burst when
//   a student has just finished the last overdue / today item — at most once a day (localStorage, per device).
//
// Module state on purpose: it lives exactly as long as the client app (client-side navigations keep it, a document
// load clears it), is never written on the server (only event handlers write it), and so can never make a
// server render differ from the client's first render.

const TEHRAN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" });

/** «2026-09-27» — the school day in Tehran, whatever the device's zone. */
export function tehranDayKey(at: Date = new Date()): string {
  return TEHRAN_DAY.format(at);
}

/** Whether a deadline counts in «امروز» (overdue or due by the end of today, Tehran). */
export function dueByToday(dueAt: Date | null, now: Date = new Date()): boolean {
  return dueAt !== null && tehranDayKey(dueAt) <= tehranDayKey(now);
}

const recentlyCompleted = new Set<string>();
let pendingCelebrationDay: string | null = null;

/** The detail page's «انجام شد» / «اتمام» succeeded (or is optimistically on its way). */
export function noteCompleted(workItemId: string, dueAt: Date | null, now: Date = new Date()): void {
  recentlyCompleted.add(workItemId);
  if (dueByToday(dueAt, now)) pendingCelebrationDay = tehranDayKey(now);
}

/** The optimistic «انجام شد» failed: forget it. */
export function forgetCompleted(workItemId: string): void {
  recentlyCompleted.delete(workItemId);
}

/** Ids among `ids` finished in this session that a list still shows (a cached render); they are handed over once. */
export function takeStaleCompleted(ids: readonly string[]): string[] {
  const stale = ids.filter((id) => recentlyCompleted.has(id));
  for (const id of stale) recentlyCompleted.delete(id);
  return stale;
}

/** Read-only peek for render (pure): is a celebration waiting for today? */
export function pendingCelebration(): string | null {
  return pendingCelebrationDay;
}

export function clearPendingCelebration(): void {
  pendingCelebrationDay = null;
}

/** localStorage key: the last Tehran day the «همهٴ کارهای امروز انجام شد» burst played on this device. */
export const CELEBRATED_KEY = "donino.celebrated.day";

export function readCelebratedDay(): string | null {
  try {
    return window.localStorage.getItem(CELEBRATED_KEY);
  } catch {
    return null;
  }
}

export function writeCelebratedDay(day: string): void {
  try {
    window.localStorage.setItem(CELEBRATED_KEY, day);
  } catch {
    /* storage blocked: the module flag is already cleared, so it still plays at most once per app session */
  }
}

/**
 * The rule, pure: a student, a finish noted today, nothing overdue or due today left, and no burst yet today.
 */
export function shouldCelebrate(input: { student: boolean; overdue: number; dueToday: number; pendingDay: string | null; celebratedDay: string | null; today: string }): boolean {
  return input.student && input.pendingDay === input.today && input.overdue + input.dueToday === 0 && input.celebratedDay !== input.today;
}
