// «دفتر کلاسی — گزارش جلسه» (migration 0027): the pure rules — the input bounds the DTO enforces (the CHECKs of
// academic.session_report repeat them), how a text is cleaned, WHO sees the private note, and that the audit snapshot
// carries lengths and ids only. The database half (scope, one report per session, the stored audit row) is
// tests/int/session-report.test.ts.
import { describe, expect, it } from "vitest";
import { SaveSessionReportInput, SessionReportCellInput } from "@/modules/academic/dto";
import {
  SESSION_REPORT_LIMITS,
  cleanReportLine,
  cleanReportNote,
  hasPrivateNote,
  reportAuditShape,
  shapeSessionReport,
  type SessionReportStaff,
} from "@/lib/session-report";

const UUID_A = "0199a000-0000-7000-8000-000000000001";
const UUID_B = "0199a000-0000-7000-8000-000000000002";
const base = { classGroupId: UUID_A, date: "2026-09-22", periodNo: 2, topic: "ضرب کسرها" };

describe("SaveSessionReportInput", () => {
  it("accepts the smallest report: a topic and nothing else", () => {
    const r = SaveSessionReportInput.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("requires a topic and bounds every field to the database's CHECKs", () => {
    expect(SaveSessionReportInput.safeParse({ ...base, topic: "   " }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, topic: "ا".repeat(SESSION_REPORT_LIMITS.topic) }).success).toBe(true);
    expect(SaveSessionReportInput.safeParse({ ...base, topic: "ا".repeat(SESSION_REPORT_LIMITS.topic + 1) }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, pageRef: "ب".repeat(SESSION_REPORT_LIMITS.pageRef + 1) }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, privateNote: "پ".repeat(SESSION_REPORT_LIMITS.privateNote) }).success).toBe(true);
    expect(SaveSessionReportInput.safeParse({ ...base, privateNote: "پ".repeat(SESSION_REPORT_LIMITS.privateNote + 1) }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, nextPlan: "ن".repeat(SESSION_REPORT_LIMITS.nextPlan) }).success).toBe(true);
    expect(SaveSessionReportInput.safeParse({ ...base, nextPlan: "ن".repeat(SESSION_REPORT_LIMITS.nextPlan + 1) }).success).toBe(false);
  });

  it("answers in Persian", () => {
    const r = SaveSessionReportInput.safeParse({ ...base, topic: "ا".repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("موضوع تدریس‌شده حداکثر ۲۰۰ نویسه است.");
    const empty = SaveSessionReportInput.safeParse({ ...base, topic: "" });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0].message).toBe("موضوع تدریس‌شده را بنویسید.");
  });

  it("is strict: no organization, author or status can ride along, and ids must be UUIDs", () => {
    expect(SaveSessionReportInput.safeParse({ ...base, organizationId: UUID_B }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, authorPersonId: UUID_B }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, status: "archived" }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, classGroupId: "not-a-uuid" }).success).toBe(false);
    expect(SaveSessionReportInput.safeParse({ ...base, workItemId: "x" }).success).toBe(false);
  });

  it("takes an empty workItemId (the form's «بدون تکلیف») as none, and a UUID as is", () => {
    const none = SaveSessionReportInput.parse({ ...base, workItemId: "" });
    expect(none.workItemId).toBeNull();
    expect(SaveSessionReportInput.parse({ ...base, workItemId: UUID_B }).workItemId).toBe(UUID_B);
  });

  it("needs a real زنگ: 1..12, an integer, never null (a report belongs to a زنگ, unlike the daily roll call)", () => {
    for (const periodNo of [0, 13, 1.5, null, "2"]) expect(SaveSessionReportInput.safeParse({ ...base, periodNo }).success).toBe(false);
    for (const periodNo of [1, 12]) expect(SaveSessionReportInput.safeParse({ ...base, periodNo }).success).toBe(true);
    expect(SessionReportCellInput.safeParse({ classGroupId: UUID_A, date: "2026-09-22", periodNo: 2 }).success).toBe(true);
    expect(SessionReportCellInput.safeParse({ classGroupId: UUID_A, date: "22/09/2026", periodNo: 2 }).success).toBe(false);
  });
});

describe("cleaning", () => {
  it("normalises a line (Arabic ي/ك, runs of spaces, edges) and turns empty into null", () => {
    expect(cleanReportLine("  كتاب   رياضي  ")).toBe("کتاب ریاضی");
    expect(cleanReportLine("   ")).toBeNull();
    expect(cleanReportLine(null)).toBeNull();
    expect(cleanReportLine(undefined)).toBeNull();
  });

  it("keeps line breaks of a note, collapses blank runs, normalises each line", () => {
    expect(cleanReportNote("اول  ي\r\n\r\n\r\n\r\nدوم  \n")).toBe("اول ی\n\nدوم");
    expect(cleanReportNote("\n  \n")).toBeNull();
  });
});

describe("who sees the private note", () => {
  const row: SessionReportStaff = {
    id: "r1",
    date: "2026-09-22",
    periodNo: 2,
    topic: "ضرب کسرها",
    pageRef: "فصل ۳",
    nextPlan: "تمرین صفحهٴ ۴۶",
    workItem: { id: "w1", title: "تمرین کسرها" },
    privateNote: "علی امروز بی‌حوصله بود",
  };

  it("a writer gets the note", () => {
    const shaped = shapeSessionReport(row, true);
    expect(hasPrivateNote(shaped)).toBe(true);
    expect(hasPrivateNote(shaped) && shaped.privateNote).toBe("علی امروز بی‌حوصله بود");
  });

  it("anyone else gets an object with NO privateNote key at all — it cannot reach props or JSON", () => {
    const shaped = shapeSessionReport(row, false);
    expect(hasPrivateNote(shaped)).toBe(false);
    expect("privateNote" in shaped).toBe(false);
    expect(JSON.stringify(shaped)).not.toContain("بی‌حوصله");
    // …but the public fields are all there.
    expect(shaped).toEqual({ id: "r1", date: "2026-09-22", periodNo: 2, topic: "ضرب کسرها", pageRef: "فصل ۳", nextPlan: "تمرین صفحهٴ ۴۶", workItem: { id: "w1", title: "تمرین کسرها" } });
  });
});

describe("the audit snapshot", () => {
  it("carries ids and text lengths only — never a word the teacher wrote", () => {
    const shape = reportAuditShape({
      classGroupId: UUID_A,
      classOfferingId: UUID_B,
      date: "2026-09-22",
      periodNo: 2,
      workItemId: null,
      topic: "ضرب کسرها",
      pageRef: null,
      privateNote: "یادداشت خصوصی",
      nextPlan: "تمرین",
    });
    expect(shape).toEqual({
      classGroupId: UUID_A,
      classOfferingId: UUID_B,
      date: "2026-09-22",
      periodNo: 2,
      workItemId: null,
      topicLength: 9,
      pageRefLength: 0,
      privateNoteLength: 13,
      nextPlanLength: 5,
    });
    const json = JSON.stringify(shape);
    for (const secret of ["ضرب", "یادداشت", "تمرین"]) expect(json).not.toContain(secret);
  });
});
