"use server";
// «ارتباط ولی و مدرسه» Server Actions (owner, 2026-10-19). Each goes through defineAction (session → must-change →
// strict Zod → the permission at ANY scope → tenant transaction); the service decides the real scope inside — the
// child among the caller's live children for a guardian, the caller among the item's addressees for an answer — and
// answers NOT_FOUND outside it. The sender, the school and the addressees come from the session and the database.
import { defineAction } from "@/lib/actions";
import { AnswerGuardianMessageInput, SendGuardianMessageInput } from "./guardian-message-dto";
import { answerAddressedMessage, sendGuardianMessage } from "./guardian-messages";

/** «ارسال پیام»: a guardian's question / suggestion / criticism about one child (`iam.guardian_message.send` — the «ولی» role only). */
export const sendGuardianMessageAction = defineAction({ schema: SendGuardianMessageInput, permission: "iam.guardian_message.send", scope: "any" }, async (tx, input, ctx) =>
  sendGuardianMessage(tx, ctx, {
    studentProfileId: input.child,
    kind: input.kind,
    destination: input.destination,
    classOfferingId: input.classOfferingId ?? null,
    teacherPersonId: input.teacherPersonId ?? null,
    subject: input.subject,
    body: input.body,
    idempotencyKey: input.idempotencyKey ?? null,
  }),
);

/**
 * «ثبت پاسخ» of a counselor in «مشاوره» › «پیام‌های اولیا» — a counselor holds no `workspace.*` permission, so they
 * answer here (the gate is the counselor's own `counseling.note.write`; the service requires the caller to be one of
 * the message's addressees). Teachers and the school's managers answer in «پنل من» (workspace `changeStatus`).
 */
export const answerGuardianMessageAction = defineAction({ schema: AnswerGuardianMessageInput, permission: "counseling.note.write", scope: "any" }, async (tx, input, ctx) =>
  answerAddressedMessage(tx, ctx, { workItemId: input.workItemId, answer: input.answer }),
);
