// «ارتباط ولی و مدرسه» reads for pages (owner, 2026-10-19): the guardian's «پیام به مدرسه» of one child, and a
// counselor's «پیام‌های اولیا». Each names its permission at ANY scope; the service narrows it — `requireChild` for the
// guardian (the live link AND the permission at THAT child's scope, NOT_FOUND), the caller's own inbox rows for the
// counselor. `child` is the page's `?child=` — a choice among the caller's own children, never trusted.
import { defineQuery } from "@/lib/actions";
import { ChildMessagesInput } from "./guardian-message-dto";
import { childMessagesPage, listAddressedMessages } from "./guardian-messages";

export type { AddressedMessageRow, ChildMessagesPage, MyMessageRow, TeacherDestination } from "./guardian-messages";

/** «پیام به مدرسه» of one child: the form's destinations and the caller's messages about that child. */
export const childMessagesQuery = defineQuery({ schema: ChildMessagesInput, permission: "iam.guardian_message.send", scope: "any" }, async (tx, input, ctx) =>
  childMessagesPage(tx, ctx, input.child),
);

/** «پیام‌های اولیا» of a counselor: the guardians' messages given to the caller (their own inbox rows). */
export const addressedMessagesQuery = defineQuery({ permission: "counseling.note.write", scope: "any" }, async (tx, _input, ctx) => listAddressedMessages(tx, ctx));
