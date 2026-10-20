// workspace/reminder-policy — WHEN the deadline nudges of «یادآوری مهلت تکالیف» are delivered (flag
// `deadline_reminders`; owner 2026-10-20, docs/decisions.md «یادآوری مهلت و مرکز درخواست‌ها»). Pure, unit-tested in
// tests/unit/reminder-policy.test.ts; ./deadline-reminders.ts reads the rows and enqueues the jobs.
//
//   • the assignees' reminder: `lead` hours before the deadline (setting `reminders.deadline_lead_hours`, default 24) —
//     for an item given INSIDE that window (a تکلیف due in 5 h), halfway between its creation and its deadline
//     instead, so it never lands on top of the «کار جدید» bell; never in the quiet hours (./notif/quiet-hours:
//     moved to the window's end, or just before it when the end is past the deadline);
//   • the giver's notice that the deadline passed with people unfinished: at the deadline, or at the end of the quiet
//     window it falls in.
import { type TimeRangeValue } from "@/modules/config/settings";
import { deliveryTime } from "@/modules/notif/quiet-hours";

const HOUR = 3_600_000;

/** How far ahead a scan enqueues: a little more than the 15-minute period of the scan (src/modules/ops/schedules.ts). */
export const SCAN_AHEAD_MS = 30 * 60_000;
/** A deadline passed longer ago than this gets no giver notice any more (a worker that was down for a day). */
export const OVERDUE_GRACE_MS = 24 * HOUR;

export interface ReminderInput {
  dueAt: Date;
  createdAt: Date;
  leadHours: number;
  quiet: TimeRangeValue;
  now: Date;
}

/** When the assignees are reminded; null = no reminder (the deadline has passed, or the only slot left is gone). */
export function reminderAt({ dueAt, createdAt, leadHours, quiet, now }: ReminderInput): Date | null {
  const due = dueAt.getTime();
  if (due <= now.getTime()) return null;
  const halfway = createdAt.getTime() + (due - createdAt.getTime()) / 2;
  const ideal = Math.max(due - leadHours * HOUR, halfway, now.getTime());
  if (ideal >= due) return null;
  return deliveryTime(new Date(ideal), dueAt, quiet, now);
}

/** When the giver hears that the deadline passed (the deadline, out of the quiet window); null when it is too old. */
export function overdueNoticeAt(dueAt: Date, quiet: TimeRangeValue, now: Date): Date | null {
  if (dueAt.getTime() < now.getTime() - OVERDUE_GRACE_MS) return null;
  return deliveryTime(dueAt, null, quiet, now);
}

/** Is a moment computed by the two above due for enqueueing in this scan? */
export function dueForScan(at: Date | null, now: Date): at is Date {
  return at !== null && at.getTime() <= now.getTime() + SCAN_AHEAD_MS;
}
