// workspace/request-clock — what a work item's status change does to the response clock of the request it carries
// (`workspace.request_sla`; owner 2026-10-20, docs/decisions.md «یادآوری مهلت و مرکز درخواست‌ها»; the rule is
// ./request-sla `clockOnStatus`). Called by the ONE writer of `work_item.status_id` (./service `setItemStatus`) in the
// same transaction, so the clock and the status never disagree:
//   • «در حال بررسی» (category doing) → `paused_at = now()` — nothing is counted while it lasts;
//   • back to «باز» (todo) → the paused time, in whole seconds, moves `due_at` on and is added to `paused_seconds`;
//   • answered / cancelled (done, cancelled) → `closed_at = now()` — the clock stops for good (a request reopened after
//     its answer has no clock: it was answered).
// A leaf: tables only. An item without a clock (not a request) matches no row. No audit row of its own — the status
// change that caused it is audited (`workspace.work_item.status_changed`).
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { clockOnStatus } from "./request-sla";

export async function syncRequestClock(tx: Tx, workItemId: string, toCategory: string): Promise<void> {
  const step = clockOnStatus(toCategory);
  if (step === "pause") {
    await tx.execute(sql`
      update workspace.request_sla set paused_at = now()
      where work_item_id = ${workItemId}::uuid and closed_at is null and paused_at is null`);
  } else if (step === "resume") {
    await tx.execute(sql`
      update workspace.request_sla
         set due_at = due_at + make_interval(secs => greatest(0, floor(extract(epoch from (now() - paused_at))))::int),
             paused_seconds = paused_seconds + greatest(0, floor(extract(epoch from (now() - paused_at))))::int,
             paused_at = null
       where work_item_id = ${workItemId}::uuid and closed_at is null and paused_at is not null`);
  } else if (step === "close") {
    await tx.execute(sql`
      update workspace.request_sla set closed_at = now(), paused_at = null
      where work_item_id = ${workItemId}::uuid and closed_at is null`);
  }
}

/**
 * A leave request was decided or withdrawn (academic/leave `decideLeave`, iam/guardian-leave `cancelLeave`): its clock
 * stops now, in the same transaction — the answer's moment is the response time.
 */
export async function closeLeaveRequestClock(tx: Tx, leaveRequestId: string): Promise<void> {
  await tx.execute(sql`
    update workspace.request_sla set closed_at = now(), paused_at = null
    where leave_request_id = ${leaveRequestId}::uuid and closed_at is null`);
}
