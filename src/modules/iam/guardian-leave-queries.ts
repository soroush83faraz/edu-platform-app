// «درخواست‌های مرخصی» read of a guardian's child page (owner, 2026-10-20). Names its permission at ANY scope; the
// service narrows it — `requireChild` (the live link AND the permission at THAT child's scope, NOT_FOUND). `child` is
// the page's `?child=` — a choice among the caller's own children, never trusted.
import { defineQuery } from "@/lib/actions";
import { ChildLeaveInput } from "@/modules/academic/leave-dto";
import { childLeavePage } from "./guardian-leave";

export type { ChildExitRow, ChildLeavePage, ChildLeaveRow } from "./guardian-leave";

/** «درخواست‌های مرخصی» of one child: the requests with status and decision, the early exits, the school's زنگ‌ها. */
export const childLeaveQuery = defineQuery({ schema: ChildLeaveInput, permission: "academic.leave.request", scope: "any" }, async (tx, input, ctx) => childLeavePage(tx, ctx, input.child));
