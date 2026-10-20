"use server";
// «درخواست مرخصی» Server Actions of a guardian (owner, 2026-10-20). Each goes through defineAction (session →
// must-change → strict Zod → the permission at ANY scope → tenant transaction); the service decides the real scope
// inside — the child among the caller's live children, the request among the caller's own — and answers NOT_FOUND
// outside it. The requester, the school and the organization come from the session and the database.
import { defineAction } from "@/lib/actions";
import { CancelLeaveInput, RequestLeaveInput } from "@/modules/academic/leave-dto";
import { cancelLeave, requestLeave } from "./guardian-leave";

/** «ثبت درخواست مرخصی» for one child (`academic.leave.request` — the «ولی» role only). */
export const requestLeaveAction = defineAction({ schema: RequestLeaveInput, permission: "academic.leave.request", scope: "any" }, async (tx, input, ctx) => requestLeave(tx, ctx, input));

/** «لغو درخواست» — the caller's own request, while it is pending. */
export const cancelLeaveAction = defineAction({ schema: CancelLeaveInput, permission: "academic.leave.request", scope: "any" }, async (tx, input, ctx) => cancelLeave(tx, ctx, { id: input.id }));
