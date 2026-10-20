"use server";
// «مرخصی و خروج مجاز» Server Actions of the school's managers (owner, 2026-10-20): deciding a guardian's leave request
// and recording / cancelling an authorized early exit. defineAction with `scope: "any"` as everywhere in this module: the
// service decides the real scope INSIDE the transaction (the permission at the request's / student's SCHOOL) and answers
// NOT_FOUND outside it. The actor and the organization come from the session; nothing from the client reaches a query
// unmapped.
import { defineAction } from "@/lib/actions";
import { CancelEarlyExitInput, DecideLeaveInput, RecordEarlyExitInput } from "./leave-dto";
import { cancelEarlyExit, decideLeave, recordEarlyExit } from "./leave";

/** «تأیید / رد» of a pending request (`academic.leave.decide`). */
export const decideLeaveAction = defineAction({ schema: DecideLeaveInput, permission: "academic.leave.decide", scope: "any" }, async (tx, input, ctx) =>
  decideLeave(tx, ctx, { id: input.id, decision: input.decision, note: input.note ?? null }),
);

/** «ثبت خروج مجاز» of a student of the caller's school (`academic.early_exit.write`). */
export const recordEarlyExitAction = defineAction({ schema: RecordEarlyExitInput, permission: "academic.early_exit.write", scope: "any" }, async (tx, input, ctx) =>
  recordEarlyExit(tx, ctx, {
    studentProfileId: input.studentProfileId,
    time: input.time ?? null,
    category: input.category,
    note: input.note ?? null,
    pickedUpBy: input.pickedUpBy ?? null,
  }),
);

/** «لغو خروج مجاز» — a mistaken record (`academic.early_exit.write`). */
export const cancelEarlyExitAction = defineAction({ schema: CancelEarlyExitInput, permission: "academic.early_exit.write", scope: "any" }, async (tx, input, ctx) =>
  cancelEarlyExit(tx, ctx, { id: input.id }),
);
