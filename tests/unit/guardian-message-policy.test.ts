// «ارتباط ولی و مدرسه» (owner, 2026-10-19; src/modules/iam/guardian-message-policy.ts + guardian-message-dto.ts): the
// kind × destination rule («انتقاد» never straight to a teacher), the DTO's bounds and strictness, the labels, the work
// item's title and description (never the body in the title; the description splits back exactly), the answer the
// guardian may read, and the catalog rows the feature adds.
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, SYSTEM_WORK_ITEM_TYPES } from "../../scripts/catalog";
import { AnswerGuardianMessageInput, ChildMessagesInput, SendGuardianMessageInput } from "@/modules/iam/guardian-message-dto";
import {
  ANSWER_MAX,
  CRITICISM_ROUTE_NOTE,
  DESTINATION_LABELS,
  GUARDIAN_MESSAGE_MESSAGES,
  MESSAGE_BODY_MAX,
  MESSAGE_DESTINATIONS,
  MESSAGE_KIND_LABELS,
  MESSAGE_KINDS,
  MESSAGE_RATE_LIMIT,
  MESSAGE_STATE_LABELS,
  MESSAGE_SUBJECT_MAX,
  MESSAGE_WAITING_DAYS,
  allowedDestinations,
  answerOf,
  cleanBody,
  cleanSubject,
  guardianMessageDescription,
  guardianMessageTitle,
  isAllowedDestination,
  messageState,
  splitGuardianMessageDescription,
  teacherDestinationLabel,
} from "@/modules/iam/guardian-message-policy";

const CHILD = "0199a000-000d-7000-8000-0000000000a1";
const OFFERING = "0199a000-000c-7000-8000-0000000000a1";
const TEACHER = "0199a000-0006-7000-8000-0000000000a2";
const valid = { child: CHILD, kind: "question", destination: "principal", subject: "زمان جلسه", body: "سلام؛ جلسه کی است؟" };

describe("kind × destination (the owner's rule)", () => {
  it("«انتقاد» never goes straight to a teacher; to the counselor, vice principal or principal it goes; «سؤال» / «پیشنهاد» go anywhere", () => {
    expect(isAllowedDestination("criticism", "teacher")).toBe(false);
    for (const d of ["counselor", "vice_principal", "principal"] as const) expect(isAllowedDestination("criticism", d), d).toBe(true);
    for (const k of ["question", "suggestion"] as const) for (const d of MESSAGE_DESTINATIONS) expect(isAllowedDestination(k, d), `${k}→${d}`).toBe(true);
    expect(allowedDestinations("criticism")).toEqual(["counselor", "vice_principal", "principal"]);
    expect(allowedDestinations("question")).toEqual(["teacher", "counselor", "vice_principal", "principal"]);
  });

  it("the form's one line and the refusal both say where a criticism goes", () => {
    expect(CRITICISM_ROUTE_NOTE).toBe("انتقاد به معاون یا مدیر مدرسه می‌رود");
    expect(GUARDIAN_MESSAGE_MESSAGES.teacherCriticism.startsWith(CRITICISM_ROUTE_NOTE)).toBe(true);
  });
});

describe("labels", () => {
  it("the three kinds, the four destinations, the two states — all Persian", () => {
    expect(MESSAGE_KINDS.map((k) => MESSAGE_KIND_LABELS[k])).toEqual(["سؤال", "پیشنهاد", "انتقاد"]);
    expect(MESSAGE_DESTINATIONS.map((d) => DESTINATION_LABELS[d])).toEqual(["دبیر", "مشاور مدرسه", "معاون مدرسه", "مدیر مدرسه"]);
    expect(teacherDestinationLabel("ریاضی", "علی حسینی")).toBe("ریاضی — علی حسینی");
    expect(MESSAGE_STATE_LABELS).toEqual({ sent: "ارسال‌شده", waiting: "در انتظار پاسخ", routing: "در حال ارجاع به مدیریت", answered: "پاسخ داده شد" });
    for (const s of [...Object.values(MESSAGE_KIND_LABELS), ...Object.values(DESTINATION_LABELS), ...Object.values(GUARDIAN_MESSAGE_MESSAGES)]) expect(s, s).not.toMatch(/[A-Za-z]/);
    expect(GUARDIAN_MESSAGE_MESSAGES.rateLimited).toContain((MESSAGE_RATE_LIMIT).toLocaleString("fa-IR"));
  });
});

describe("the work item's title and description", () => {
  it("the title names the kind and the child only — never the subject or the body", () => {
    expect(guardianMessageTitle("question", "لیلا نیک‌خواه")).toBe("پیام ولی: سؤال دربارهٴ لیلا نیک‌خواه");
    expect(guardianMessageTitle("criticism", "لیلا نیک‌خواه")).toBe("پیام ولی: انتقاد دربارهٴ لیلا نیک‌خواه");
    expect(guardianMessageTitle("suggestion", "ب".repeat(300))).toHaveLength(200);
  });

  it("the description carries the subject on one line and the body; it splits back exactly", () => {
    const d = guardianMessageDescription("  تکلیف‌ها \n هفتهٴ گذشته ", "سلام.\r\n\r\n\r\n\r\nخط دوم  ");
    expect(d).toBe("موضوع: تکلیف‌ها هفتهٴ گذشته\n\nسلام.\n\nخط دوم");
    expect(splitGuardianMessageDescription(d)).toEqual({ subject: "تکلیف‌ها هفتهٴ گذشته", body: "سلام.\n\nخط دوم" });
    expect(splitGuardianMessageDescription(null)).toEqual({ subject: "", body: "" });
    expect(splitGuardianMessageDescription("متن بی‌موضوع")).toEqual({ subject: "", body: "متن بی‌موضوع" });
    expect(cleanSubject("\t الف \n ب ")).toBe("الف ب");
    expect(cleanBody("\n\nالف\r\nب\n\n\n\nپ\n")).toBe("الف\nب\n\nپ");
  });
});

describe("what the guardian reads of the answer", () => {
  it("only the note of the transition that CLOSED the message, made by an addressee, with text", () => {
    expect(answerOf({ category: "done", byAddressee: true, note: "پاسخ" })).toBe("پاسخ");
    expect(answerOf({ category: "doing", byAddressee: true, note: "در حال بررسی" })).toBeNull();
    expect(answerOf({ category: "done", byAddressee: false, note: "کسی دیگر" })).toBeNull();
    expect(answerOf({ category: "done", byAddressee: true, note: null })).toBeNull();
    expect(answerOf({ category: null, byAddressee: null, note: null })).toBeNull();
  });
});

describe("the guardian's tag (security review 2026-10-19, D1 — display only, derived when read)", () => {
  const sentAt = new Date("2026-10-01T08:00:00Z");
  const after = (days: number, ms = 0) => new Date(sentAt.getTime() + days * 24 * 60 * 60 * 1000 + ms);
  const open = { open: true, orphaned: false, sentAt };
  it("«ارسال‌شده» for a week, then the neutral «در انتظار پاسخ» — never «ارسال‌شده» for ever", () => {
    expect(MESSAGE_WAITING_DAYS).toBe(7);
    expect(messageState(null, open, sentAt)).toBe("sent");
    expect(messageState(null, open, after(MESSAGE_WAITING_DAYS, -1))).toBe("sent");
    expect(messageState(null, open, after(MESSAGE_WAITING_DAYS))).toBe("waiting");
    expect(messageState(null, open, after(40))).toBe("waiting");
  });
  it("«در حال ارجاع به مدیریت» while no addressee is left on an open message, whatever its age; an answer wins over everything", () => {
    expect(messageState(null, { ...open, orphaned: true }, sentAt)).toBe("routing");
    expect(messageState(null, { ...open, orphaned: true }, after(30))).toBe("routing");
    expect(messageState("پاسخ", open, after(30))).toBe("answered");
    expect(messageState("پاسخ", { ...open, orphaned: true }, sentAt)).toBe("answered");
  });
  it("a closed message without an answer neither waits nor is routed", () => {
    expect(messageState(null, { open: false, orphaned: true, sentAt }, after(30))).toBe("sent");
  });
});

describe("the DTOs (strict, bounded, Persian)", () => {
  it("accepts a valid message; trims; rejects unknown keys, a bad kind or destination, empty or too long text", () => {
    expect(SendGuardianMessageInput.parse({ ...valid, subject: "  زمان جلسه  " }).subject).toBe("زمان جلسه");
    expect(SendGuardianMessageInput.safeParse({ ...valid, destination: "teacher", classOfferingId: OFFERING, teacherPersonId: TEACHER }).success).toBe(true);
    // Ids from the session only: an organization or a sender in the input is an unknown key.
    expect(SendGuardianMessageInput.safeParse({ ...valid, organizationId: CHILD }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, guardianPersonId: TEACHER }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, kind: "complaint" }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, destination: "org_admin" }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, child: "x" }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, subject: "   " }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, body: "" }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, subject: "ا".repeat(MESSAGE_SUBJECT_MAX) }).success).toBe(true);
    expect(SendGuardianMessageInput.safeParse({ ...valid, subject: "ا".repeat(MESSAGE_SUBJECT_MAX + 1) }).success).toBe(false);
    expect(SendGuardianMessageInput.safeParse({ ...valid, body: "ا".repeat(MESSAGE_BODY_MAX) }).success).toBe(true);
    expect(SendGuardianMessageInput.safeParse({ ...valid, body: "ا".repeat(MESSAGE_BODY_MAX + 1) }).success).toBe(false);
    const tooLong = SendGuardianMessageInput.safeParse({ ...valid, body: "ا".repeat(MESSAGE_BODY_MAX + 1) });
    expect(tooLong.success ? "" : tooLong.error.issues[0].message).toBe("حداکثر ۲٬۰۰۰ نویسه.");
  });

  it("the page input and the answer are strict too; an answer is required and at most the note's length", () => {
    expect(ChildMessagesInput.safeParse({}).success).toBe(true);
    expect(ChildMessagesInput.safeParse({ child: CHILD, extra: 1 }).success).toBe(false);
    expect(AnswerGuardianMessageInput.safeParse({ workItemId: OFFERING, answer: "  " }).success).toBe(false);
    expect(AnswerGuardianMessageInput.safeParse({ workItemId: OFFERING, answer: "ا".repeat(ANSWER_MAX) }).success).toBe(true);
    expect(AnswerGuardianMessageInput.safeParse({ workItemId: OFFERING, answer: "ا".repeat(ANSWER_MAX + 1) }).success).toBe(false);
  });
});

describe("the catalog rows of the feature", () => {
  it("the `parent_message` type: answered once, the action row's status codes; the guardian's «answered» notification", () => {
    const t = SYSTEM_WORK_ITEM_TYPES.find((x) => x.code === "parent_message")!;
    expect(t).toMatchObject({ name: "پیام ولی", requiresAssignee: true });
    expect(t.statuses.map((s) => [s.code, s.category])).toEqual([
      ["open", "todo"],
      ["in_review", "doing"],
      ["answered", "done"],
      ["rejected", "cancelled"],
    ]);
    expect(NOTIFICATION_TYPES.find((n) => n.code === "guardian.message_answered")).toMatchObject({ module: "guardian" });
  });
});
