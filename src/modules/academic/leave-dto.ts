// Zod v4 `.strict()` inputs of «مرخصی و خروج مجاز» (owner, 2026-10-20): the guardian's request / cancel / page, the
// manager's decision, early exit and queue. Persian messages; nothing here is spread into a query — the services map
// every field explicitly, and the actor, the school, the organization and the child's ownership come from the session
// and the database, never from these. The services check the bounds (src/lib/leave.ts) once more.
import { z } from "zod";
import {
  EARLY_EXIT_CATEGORIES,
  EARLY_EXIT_NOTE_MAX,
  EARLY_EXIT_PICKUP_MAX,
  LEAVE_CATEGORIES,
  LEAVE_DECISION_NOTE_MAX,
  LEAVE_MAX_PERIOD,
  LEAVE_MESSAGES,
  LEAVE_NOTE_MAX,
} from "@/lib/leave";

const uuid = z.uuid("گزینهٴ انتخاب‌شده نامعتبر است.");
/** A PostgreSQL `date` on the wire: ISO `YYYY-MM-DD` (the form's date fields build it from the Jalali pickers). */
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, LEAVE_MESSAGES.badDate);
/** `""` / `"none"` from a form select = no partial day. */
const optionalPeriod = z.preprocess(
  (v) => (v === "" || v === "none" || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number("شمارهٴ زنگ نامعتبر است.").int().min(1, "شمارهٴ زنگ نامعتبر است.").max(LEAVE_MAX_PERIOD, "شمارهٴ زنگ نامعتبر است.").nullable(),
);
const optionalNote = (max: number, message: string) => z.string().trim().max(max, message).nullable().optional();

export const ChildLeaveInput = z.object({ child: uuid.optional() }).strict();
export type ChildLeaveInput = z.output<typeof ChildLeaveInput>;

export const RequestLeaveInput = z
  .object({
    /** The child — one of the caller's live children (`requireChild`). */
    child: uuid,
    fromDate: isoDate,
    toDate: isoDate,
    fromPeriod: optionalPeriod.optional(),
    toPeriod: optionalPeriod.optional(),
    category: z.enum(LEAVE_CATEGORIES, "دلیل مرخصی را انتخاب کنید."),
    note: optionalNote(LEAVE_NOTE_MAX, LEAVE_MESSAGES.noteTooLong),
  })
  .strict();
export type RequestLeaveInput = z.output<typeof RequestLeaveInput>;

export const CancelLeaveInput = z.object({ id: uuid }).strict();
export type CancelLeaveInput = z.output<typeof CancelLeaveInput>;

export const DecideLeaveInput = z
  .object({
    id: uuid,
    decision: z.enum(["approved", "rejected"], "تصمیم را انتخاب کنید."),
    note: optionalNote(LEAVE_DECISION_NOTE_MAX, LEAVE_MESSAGES.decisionNoteTooLong),
  })
  .strict();
export type DecideLeaveInput = z.output<typeof DecideLeaveInput>;

export const LeaveQueueInput = z.object({ schoolId: uuid.optional() }).strict();
export type LeaveQueueInput = z.output<typeof LeaveQueueInput>;

export const RecordEarlyExitInput = z
  .object({
    studentProfileId: uuid,
    /** `HH:MM` (Tehran clock); omitted = now. */
    time: z.string().trim().max(8, LEAVE_MESSAGES.badTime).nullable().optional(),
    category: z.enum(EARLY_EXIT_CATEGORIES, "دلیل خروج را انتخاب کنید."),
    note: optionalNote(EARLY_EXIT_NOTE_MAX, LEAVE_MESSAGES.noteTooLong),
    pickedUpBy: optionalNote(EARLY_EXIT_PICKUP_MAX, LEAVE_MESSAGES.pickupTooLong),
  })
  .strict();
export type RecordEarlyExitInput = z.output<typeof RecordEarlyExitInput>;

export const CancelEarlyExitInput = z.object({ id: uuid }).strict();
export type CancelEarlyExitInput = z.output<typeof CancelEarlyExitInput>;
