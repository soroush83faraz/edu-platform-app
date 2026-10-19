// Zod v4 `.strict()` inputs of «ارتباط ولی و مدرسه» (./guardian-messages). Persian messages; nothing here is spread into
// a query — the service maps every field explicitly, and the sender, the school and the addressees come from the
// session and the database, never from these. The service checks the bounds and the owner's rule once more.
import { z } from "zod";
import { ANSWER_MAX, MESSAGE_BODY_MAX, MESSAGE_DESTINATIONS, MESSAGE_KINDS, MESSAGE_SUBJECT_MAX } from "./guardian-message-policy";

const uuid = z.uuid("گزینهٴ انتخاب‌شده نامعتبر است.");
const max = (n: number) => `حداکثر ${n.toLocaleString("fa-IR")} نویسه.`;

export const SendGuardianMessageInput = z
  .object({
    /** The child the message is about — one of the caller's live children (`requireChild`). */
    child: uuid,
    kind: z.enum(MESSAGE_KINDS, "نوع پیام را انتخاب کنید."),
    destination: z.enum(MESSAGE_DESTINATIONS, "گیرندهٴ پیام را انتخاب کنید."),
    /** A teacher destination: the درس (class offering) and the teacher of the pair picked from the list. */
    classOfferingId: uuid.optional(),
    teacherPersonId: uuid.optional(),
    subject: z.string().trim().min(1, "موضوع پیام را بنویسید.").max(MESSAGE_SUBJECT_MAX, max(MESSAGE_SUBJECT_MAX)),
    body: z.string().trim().min(1, "متن پیام را بنویسید.").max(MESSAGE_BODY_MAX, max(MESSAGE_BODY_MAX)),
    /** UUID v7 minted when the form mounts; a resubmit within 10 minutes returns the message already sent. */
    idempotencyKey: uuid.optional(),
  })
  .strict();
export type SendGuardianMessageInput = z.output<typeof SendGuardianMessageInput>;

export const ChildMessagesInput = z.object({ child: uuid.optional() }).strict();

export const AnswerGuardianMessageInput = z
  .object({
    workItemId: uuid,
    answer: z.string().trim().min(1, "متن پاسخ را بنویسید.").max(ANSWER_MAX, max(ANSWER_MAX)),
  })
  .strict();
