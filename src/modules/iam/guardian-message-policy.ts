// iam/guardian-message-policy — the pure rules of «ارتباط ولی و مدرسه» (owner, 2026-10-19; docs/decisions.md): a
// guardian sends a question / suggestion / criticism about ONE of their children to the child's school and follows the
// answer. The kinds and destinations with their Persian labels, the owner's rule («انتقاد» never straight to a teacher),
// the bounds, the work item's title and description, the state the guardian reads and the answer they may read. No I/O
// — unit-tested in tests/unit/guardian-message-policy.test.ts; the service (./guardian-messages) decides the rest, the
// database checks the rule once more (`guardian_message_criticism_chk`, migration 0022).
import { formatNumberFa } from "@/lib/format";

/** `guardian_message.kind` — mirrors `guardian_message_kind_chk`. */
export const MESSAGE_KINDS = ["question", "suggestion", "criticism"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = { question: "سؤال", suggestion: "پیشنهاد", criticism: "انتقاد" };

/** `guardian_message.destination_kind` — mirrors `guardian_message_destination_chk`. */
export const MESSAGE_DESTINATIONS = ["teacher", "counselor", "vice_principal", "principal"] as const;
export type MessageDestination = (typeof MESSAGE_DESTINATIONS)[number];

/** How the guardian reads a destination; a teacher's row reads «<درس> — <دبیر>» (`teacherDestinationLabel`). */
export const DESTINATION_LABELS: Record<MessageDestination, string> = {
  teacher: "دبیر",
  counselor: "مشاور مدرسه",
  vice_principal: "معاون مدرسه",
  principal: "مدیر مدرسه",
};

export function teacherDestinationLabel(subjectName: string, teacherName: string): string {
  return `${subjectName} — ${teacherName}`;
}

/**
 * The owner's rule: a «انتقاد» never goes straight to a teacher — it goes to the school's vice principal, principal or
 * counselor; to a teacher only «سؤال» and «پیشنهاد».
 */
export function isAllowedDestination(kind: MessageKind, destination: MessageDestination): boolean {
  return !(kind === "criticism" && destination === "teacher");
}

export function allowedDestinations(kind: MessageKind): MessageDestination[] {
  return MESSAGE_DESTINATIONS.filter((d) => isAllowedDestination(kind, d));
}

/** The one line the form shows when «انتقاد» is picked (owner's wording). */
export const CRITICISM_ROUTE_NOTE = "انتقاد به معاون یا مدیر مدرسه می‌رود";

export const MESSAGE_SUBJECT_MAX = 120;
export const MESSAGE_BODY_MAX = 2000;
/** The longest answer an addressee writes — the work item's transition note (workspace `ChangeStatusInput`, 500). */
export const ANSWER_MAX = 500;
/** At most `MESSAGE_RATE_LIMIT` messages per guardian and child in any `MESSAGE_RATE_WINDOW_MINUTES`. */
export const MESSAGE_RATE_LIMIT = 10;
export const MESSAGE_RATE_WINDOW_MINUTES = 60;

const max = (n: number) => `حداکثر ${formatNumberFa(n)} نویسه.`;

export const GUARDIAN_MESSAGE_MESSAGES = {
  subjectRequired: "موضوع پیام را بنویسید.",
  subjectTooLong: max(MESSAGE_SUBJECT_MAX),
  bodyRequired: "متن پیام را بنویسید.",
  bodyTooLong: max(MESSAGE_BODY_MAX),
  teacherCriticism: `${CRITICISM_ROUTE_NOTE}؛ برای دبیر «سؤال» یا «پیشنهاد» بفرستید.`,
  pickTeacher: "دبیر را انتخاب کنید.",
  notTheirTeacher: "این دبیر اکنون دبیر این فرزند نیست؛ فهرست را تازه کنید.",
  noSchool: "این فرزند اکنون در مدرسه‌ای ثبت‌نام ندارد؛ فرستادن پیام ممکن نیست.",
  noCounselor: "برای مدرسهٴ این فرزند مشاوری ثبت نشده است.",
  noVicePrincipal: "برای مدرسهٴ این فرزند معاونی ثبت نشده است.",
  noPrincipal: "برای مدرسهٴ این فرزند مدیری ثبت نشده است.",
  rateLimited: `در هر ساعت حداکثر ${formatNumberFa(MESSAGE_RATE_LIMIT)} پیام دربارهٴ هر فرزند می‌توانید بفرستید؛ کمی بعد دوباره امتحان کنید.`,
} as const;

/** «نشد» of a destination nobody holds at the child's school (teachers have their own message). */
export const NO_HOLDER_MESSAGE: Record<Exclude<MessageDestination, "teacher">, string> = {
  counselor: GUARDIAN_MESSAGE_MESSAGES.noCounselor,
  vice_principal: GUARDIAN_MESSAGE_MESSAGES.noVicePrincipal,
  principal: GUARDIAN_MESSAGE_MESSAGES.noPrincipal,
};

/** The subject on one line: trimmed, every run of whitespace (a pasted line break included) one space. */
export function cleanSubject(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** The body: trimmed, line breaks kept (CRLF → LF), no more than one empty line in a row. */
export function cleanBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The work item's title: «پیام ولی: <نوع> دربارهٴ <نام فرزند>» — the kind and the child only, NEVER the subject or the
 * body (titles are listed in «پنل من», copied into the bell and named — by length only — in the audit trail).
 */
export function guardianMessageTitle(kind: MessageKind, childName: string): string {
  return `پیام ولی: ${MESSAGE_KIND_LABELS[kind]} دربارهٴ ${childName}`.slice(0, 200);
}

const SUBJECT_PREFIX = "موضوع: ";

/** The work item's description — what its addressees read: «موضوع: <subject>», an empty line, the body. */
export function guardianMessageDescription(subject: string, body: string): string {
  return `${SUBJECT_PREFIX}${cleanSubject(subject)}\n\n${cleanBody(body)}`;
}

/** The inverse of `guardianMessageDescription` (the subject is one line by construction) — the guardian's list. */
export function splitGuardianMessageDescription(description: string | null): { subject: string; body: string } {
  const d = description ?? "";
  if (!d.startsWith(SUBJECT_PREFIX)) return { subject: "", body: d.trim() };
  const nl = d.indexOf("\n");
  if (nl === -1) return { subject: d.slice(SUBJECT_PREFIX.length).trim(), body: "" };
  return { subject: d.slice(SUBJECT_PREFIX.length, nl).trim(), body: d.slice(nl).trim() };
}

/** Where a counselor reads and answers the guardians' messages addressed to them (they have no «پنل من»). */
export const COUNSELOR_MESSAGES_HREF = "/counseling/messages";

/**
 * What the guardian reads of a message — display only, derived when read (no stored state): «ارسال‌شده», then after
 * `MESSAGE_WAITING_DAYS` without an answer the neutral «در انتظار پاسخ» (never «ارسال‌شده» for ever); «در حال ارجاع به
 * مدیریت» while no addressee is left on it at all (its last one removed and nobody at the school to take it —
 * ./guardian-message-routing); «پاسخ داده شد» once answered (security review 2026-10-19, D1).
 */
export type MessageState = "sent" | "waiting" | "routing" | "answered";
export const MESSAGE_STATE_LABELS: Record<MessageState, string> = {
  sent: "ارسال‌شده",
  waiting: "در انتظار پاسخ",
  routing: "در حال ارجاع به مدیریت",
  answered: "پاسخ داده شد",
};
/** Days without an answer after which «ارسال‌شده» reads «در انتظار پاسخ». */
export const MESSAGE_WAITING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The item's LATEST transition, as the guardian's list reads it. */
export interface LastTransition {
  /** The status category the transition led to. */
  category: string | null;
  /** Made by one of the item's addressees (an assignee row). */
  byAddressee: boolean | null;
  note: string | null;
}

/**
 * The answer a guardian may read: the note of the transition that CLOSED the message (its latest, to a done status),
 * made by one of its addressees, with text. Null otherwise — an open message, a «در حال بررسی», a transition by anyone
 * else: no other note of the item ever reaches the guardian (the counseling file's rule, security review 2026-10-14 D5).
 */
export function answerOf(last: LastTransition): string | null {
  return last.category === "done" && last.byAddressee === true && last.note ? last.note : null;
}

/** The facts of a message `messageState` reads besides its answer. */
export interface MessageFacts {
  /** The item is open (todo / doing, not archived). */
  open: boolean;
  /** No assignee of an active person is left on the item. */
  orphaned: boolean;
  sentAt: Date;
}

/**
 * The guardian's tag (`MessageState`): answered once `answerOf` gave an answer; else, on an open message, «در حال ارجاع
 * به مدیریت» while it is orphaned, «در انتظار پاسخ» from `MESSAGE_WAITING_DAYS` after it was sent, «ارسال‌شده» before.
 */
export function messageState(answer: string | null, facts: MessageFacts, now: Date): MessageState {
  if (answer !== null) return "answered";
  if (!facts.open) return "sent";
  if (facts.orphaned) return "routing";
  return now.getTime() - facts.sentAt.getTime() >= MESSAGE_WAITING_DAYS * DAY_MS ? "waiting" : "sent";
}

export function isMessageKind(v: string): v is MessageKind {
  return (MESSAGE_KINDS as readonly string[]).includes(v);
}

export function isMessageDestination(v: string): v is MessageDestination {
  return (MESSAGE_DESTINATIONS as readonly string[]).includes(v);
}
