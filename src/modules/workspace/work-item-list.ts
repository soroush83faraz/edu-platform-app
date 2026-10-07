// The rules of the unified work-item list (owner, mock class-page-v3, 2026-10-07): «پنل من» and the subject page
// show ONE list — no «انجام‌نشده» / «انجام‌شده» tabs — open items first, then a quiet «انجام‌شده‌ها» divider and the
// finished ones; every row carries a status tag at its end. Pure (no I/O, no React), unit-tested in
// tests/unit/work-item-list.test.ts.
import { formatNumberFa } from "@/lib/format";
import type { InboxRow } from "./repo";

type Row = Pick<InboxRow, "id" | "dueAt" | "category" | "bucket">;

/**
 * The tag of a row, from the category the CALLER experiences (`listInbox`: a student's own «انجام شد» wins; for the
 * giver it is the item's status) — «در انتظار», «مهلت گذشته» (open and past its deadline day: the `overdue` bucket,
 * the same rule that paints the deadline red), «انجام‌شده», or «حذف‌شده» for a withdrawn item.
 */
export type WorkItemListStatus = "pending" | "overdue" | "done" | "cancelled";

export function listStatusOf(row: Pick<InboxRow, "category" | "bucket">): WorkItemListStatus {
  if (row.category === "cancelled") return "cancelled";
  if (row.category === "done") return "done";
  return row.bucket === "overdue" ? "overdue" : "pending";
}

export function isClosed(row: Pick<InboxRow, "category">): boolean {
  return row.category === "done" || row.category === "cancelled";
}

const time = (d: Date | null, missing: number) => (d ? d.getTime() : missing);
const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Open rows: overdue first, then by deadline (soonest first), then the ones without a deadline. */
export function compareOpen(a: Row, b: Row): number {
  const lateA = listStatusOf(a) === "overdue" ? 0 : 1;
  const lateB = listStatusOf(b) === "overdue" ? 0 : 1;
  return lateA - lateB || time(a.dueAt, Number.POSITIVE_INFINITY) - time(b.dueAt, Number.POSITIVE_INFINITY) || byId(a, b);
}

/** Finished rows: the latest deadline first, the ones without a deadline last. */
export function compareDone(a: Row, b: Row): number {
  return time(b.dueAt, Number.NEGATIVE_INFINITY) - time(a.dueAt, Number.NEGATIVE_INFINITY) || byId(b, a);
}

/** The list order: open (overdue → by deadline → no deadline), then finished. A row lands by its own category. */
export function orderWorkItems<T extends Row>(rows: readonly T[]): { open: T[]; done: T[] } {
  const open = rows.filter((r) => !isClosed(r)).sort(compareOpen);
  const done = rows.filter((r) => isClosed(r)).sort(compareDone);
  return { open, done };
}

/**
 * Whether a row shows the class's progress: what I GAVE to others — not a personal note whose one assignee is me.
 * (The rule `InboxRow` had for its «۳/۲۵».)
 */
export function showsProgress(row: Pick<InboxRow, "createdByMe" | "assigneesTotal" | "myAssigneeState">): boolean {
  return row.createdByMe && row.assigneesTotal > 0 && !(row.assigneesTotal === 1 && row.myAssigneeState !== null);
}

/** «۹ از ۲۴ انجام داده‌اند», or «همه انجام دادند» once everyone has. */
export function progressText(done: number, total: number): string {
  if (total > 0 && done >= total) return "همه انجام دادند";
  return `${formatNumberFa(done)} از ${formatNumberFa(total)} انجام داده‌اند`;
}
