// «مرخصی و خروج مجاز» reads for the school's managers (owner, 2026-10-20): the queue page, today's exits and Home's
// tile count. Each names its permission at ANY scope; the service narrows it to the schools the caller holds it at
// (`getPermissionScope`, NOT_FOUND for `?school=` outside it). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { LeaveQueueInput } from "./leave-dto";
import { listLeaveQueue, listTodaysEarlyExits } from "./leave";

export type { EarlyExitRow, LeaveQueue, LeaveQueueRow } from "./leave";

/** «درخواست‌های مرخصی»: the pending requests and the recently decided ones, of the caller's schools (or `?school=`). */
export const leaveQueueQuery = defineQuery({ schema: LeaveQueueInput, permission: "academic.leave.decide", scope: "any" }, async (tx, input, ctx) =>
  listLeaveQueue(tx, ctx, { schoolId: input.schoolId }),
);

/** Today's authorized exits of the caller's schools (or `?school=`), with a cancel for a mistaken one. */
export const todaysEarlyExitsQuery = defineQuery({ schema: LeaveQueueInput, permission: "academic.early_exit.write", scope: "any" }, async (tx, input, ctx) =>
  listTodaysEarlyExits(tx, ctx, { schoolId: input.schoolId }),
);

// (`pendingLeaveCountQuery`, the badge of Home's «درخواست‌های مرخصی» tile, lives in ./queries beside Home's other reads.)
