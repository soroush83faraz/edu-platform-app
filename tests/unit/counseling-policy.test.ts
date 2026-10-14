// «مشاوره» (owner, 2026-10-13; docs/decisions.md «مشاوره — فاز ۱»): the pure rules the service applies in SQL and the
// database once more in the RESTRICTIVE policies of migration 0018 — who reads a note (its school's counselors; its
// management only when the visibility allows; nobody else), who edits it (its author, still a counselor there), how
// a school's students are grouped (by پایه, in the catalog's order, «بدون پایه» last), what a referral's work-item
// status reads as — plus the strict inputs of the actions, the administrative request's «first answer closes» rule
// and the type-own status codes the work item page sends. The database-backed half is tests/int/counseling.test.ts.
import { describe, expect, it } from "vitest";
import { CounselingStudentsInput, CreateNoteInput, CreateTeacherReportInput, ReferInput, RequestReportInput, UpdateNoteInput } from "@/modules/counseling/dto";
import {
  NO_REACH,
  NOTE_MAX,
  canEditNote,
  counselingNotificationTitle,
  groupByGrade,
  inReach,
  initialsOf,
  isEmptyReach,
  noteVisibleTo,
  referralState,
  referralTitle,
  studentFileHref,
  teacherRequestDescription,
  TEACHER_REQUEST_GUIDE,
  type CounselingStudentRow,
  type CounselingViewer,
  type SchoolReach,
} from "@/modules/counseling/policy";
import { closesOnFirstAnswer } from "@/modules/workspace/manage-policy";
import { statusCodesOf } from "@/modules/workspace/status-codes";

const A = "0199a000-0001-7000-8000-0000000000aa";
const B = "0199a000-0001-7000-8000-0000000000bb";
const STUDENT = "0199a000-000d-7000-8000-0000000000a1";
const ME = "0199a000-0006-7000-8000-0000000000a2";
const OTHER = "0199a000-0006-7000-8000-0000000000a9";

const at = (...schoolIds: string[]): SchoolReach => ({ kind: "school", schoolIds });
const ORG: SchoolReach = { kind: "organization" };
const viewer = (over: Partial<CounselingViewer>): CounselingViewer => ({ personId: ME, read: NO_REACH, write: NO_REACH, refer: NO_REACH, ...over });

/** The catalog's hats as reaches: a counselor holds read + write + refer at their school; management read only. */
const counselorA = viewer({ read: at(A), write: at(A), refer: at(A) });
const counselorB = viewer({ read: at(B), write: at(B), refer: at(B) });
const principalA = viewer({ read: at(A) });
const principalB = viewer({ read: at(B) });
const orgAdmin = viewer({ read: ORG });
const teacher = viewer({});
const student = viewer({});

const note = (over: Partial<{ schoolId: string; visibility: "counselors" | "counselors_and_principal"; status: "active" | "archived"; authorPersonId: string }> = {}) => ({
  schoolId: A,
  visibility: "counselors_and_principal" as const,
  status: "active" as const,
  authorPersonId: ME,
  ...over,
});

describe("reach", () => {
  it("organization reaches every school, a school reach only its own; no reach holds nothing", () => {
    expect(inReach(ORG, A)).toBe(true);
    expect(inReach(at(A), A)).toBe(true);
    expect(inReach(at(A), B)).toBe(false);
    expect(inReach(NO_REACH, A)).toBe(false);
    expect(inReach(ORG, null)).toBe(false);
    expect(isEmptyReach(NO_REACH)).toBe(true);
    expect(isEmptyReach(ORG)).toBe(false);
    expect(isEmptyReach(at(A))).toBe(false);
  });
});

describe("noteVisibleTo — who reads a counselor's note", () => {
  it("its school's counselors read every note, «فقط مشاوران» included", () => {
    expect(noteVisibleTo(note(), counselorA)).toBe(true);
    expect(noteVisibleTo(note({ visibility: "counselors" }), counselorA)).toBe(true);
  });

  it("its school's management (principal, vice, the organization admin) reads it only when the visibility allows", () => {
    for (const v of [principalA, orgAdmin]) {
      expect(noteVisibleTo(note(), v)).toBe(true);
      expect(noteVisibleTo(note({ visibility: "counselors" }), v)).toBe(false);
    }
  });

  it("another school's counselor and principal, a teacher and a student read nothing", () => {
    for (const v of [counselorB, principalB, teacher, student]) {
      expect(noteVisibleTo(note(), v)).toBe(false);
      expect(noteVisibleTo(note({ visibility: "counselors" }), v)).toBe(false);
    }
  });

  it("an archived note is read by nobody — not even its author", () => {
    for (const v of [counselorA, principalA, orgAdmin]) expect(noteVisibleTo(note({ status: "archived" }), v)).toBe(false);
  });
});

describe("canEditNote — its author only, still a counselor of its school", () => {
  it("the author at their school edits; a colleague counselor, management and another school do not", () => {
    expect(canEditNote(note(), counselorA)).toBe(true);
    expect(canEditNote(note({ authorPersonId: OTHER }), counselorA)).toBe(false);
    expect(canEditNote(note(), principalA)).toBe(false);
    expect(canEditNote(note(), orgAdmin)).toBe(false);
    expect(canEditNote(note(), { ...counselorB })).toBe(false);
  });

  it("an author who is no longer the school's counselor, or an archived note: no edit", () => {
    expect(canEditNote(note(), viewer({ read: at(A) }))).toBe(false);
    expect(canEditNote(note({ status: "archived" }), counselorA)).toBe(false);
  });
});

describe("groupByGrade — a school's students by پایه", () => {
  const row = (over: Partial<CounselingStudentRow>): CounselingStudentRow => ({
    studentProfileId: STUDENT,
    firstName: "سارا",
    lastName: "احمدی",
    studentNumber: "14051001",
    classGroupName: "۷/۱",
    gradeLevelId: "g7",
    gradeName: "هفتم",
    gradeSequence: 7,
    ...over,
  });

  it("the پایه's catalog order (هفتم, هشتم, نهم), students without a پایه last, counts per group", () => {
    const groups = groupByGrade([
      row({ studentProfileId: "1", gradeLevelId: "g9", gradeName: "نهم", gradeSequence: 9, classGroupName: "۹/۱" }),
      row({ studentProfileId: "2", gradeLevelId: null, gradeName: null, gradeSequence: null, classGroupName: null }),
      row({ studentProfileId: "3" }),
      row({ studentProfileId: "4", gradeLevelId: "g8", gradeName: "هشتم", gradeSequence: 8, classGroupName: "۸/۱" }),
      row({ studentProfileId: "5", gradeLevelId: "g8", gradeName: "هشتم", gradeSequence: 8, classGroupName: "۸/۲" }),
    ]);
    expect(groups.map((g) => g.gradeName)).toEqual(["هفتم", "هشتم", "نهم", null]);
    expect(groups.map((g) => g.students.length)).toEqual([1, 2, 1, 1]);
    expect(groups.at(-1)?.key).toBe("none");
  });

  it("inside a پایه: by class (numeric, Persian digits), then family name, then first name", () => {
    const [g] = groupByGrade([
      row({ studentProfileId: "a", classGroupName: "۷/۱۰", lastName: "الف" }),
      row({ studentProfileId: "b", classGroupName: "۷/۲", lastName: "یوسفی", firstName: "مینا" }),
      row({ studentProfileId: "c", classGroupName: "۷/۲", lastName: "یوسفی", firstName: "آوا" }),
      row({ studentProfileId: "d", classGroupName: "۷/۲", lastName: "باقری" }),
    ]);
    expect(g.students.map((s) => s.studentProfileId)).toEqual(["d", "c", "b", "a"]);
  });

  it("no students, no groups", () => {
    expect(groupByGrade([])).toEqual([]);
  });
});

describe("referrals", () => {
  it("the work item's category reads «در انتظار / در جریان / انجام‌شده», a closed one apart", () => {
    expect(referralState("todo")).toBe("pending");
    expect(referralState("doing")).toBe("in_progress");
    expect(referralState("done")).toBe("done");
    expect(referralState("cancelled")).toBe("closed");
  });

  it("titles name the student and stay within the work item's 200 characters; a request ends with how to answer it", () => {
    expect(referralTitle("سارا احمدی", "  غیبت پیاپی ")).toBe("ارجاع مشاور — سارا احمدی: غیبت پیاپی");
    expect(referralTitle("سارا احمدی", "ب".repeat(400)).length).toBe(200);
    expect(teacherRequestDescription("  وضعیتش چطور است؟ ")).toBe(`وضعیتش چطور است؟\n\n${TEACHER_REQUEST_GUIDE}`);
    expect(teacherRequestDescription(null)).toBe(TEACHER_REQUEST_GUIDE);
  });

  it("the counselor's bell names the student and the kind of event only, and opens the student's file", () => {
    expect(counselingNotificationTitle("referral_answered", "سارا احمدی")).toBe("پاسخ مدیریت به ارجاع: سارا احمدی");
    expect(counselingNotificationTitle("teacher_report", "سارا احمدی")).toBe("گزارش دبیر دربارهٴ سارا احمدی");
    expect(counselingNotificationTitle("report_request_done", "سارا احمدی")).toBe("پاسخ دبیر به درخواست گزارش: سارا احمدی");
    expect(counselingNotificationTitle("teacher_report", "ب".repeat(400)).length).toBe(200);
    expect(studentFileHref(A)).toBe(`/counseling/students/${A}`);
  });

  it("an administrative request is closed by its first answer; every other type waits for every assignee", () => {
    expect(closesOnFirstAnswer("admin_request")).toBe(true);
    for (const t of ["task", "todo", "approval", "reminder"]) expect(closesOnFirstAnswer(t)).toBe(false);
  });

  it("the work item page sends the codes of the item's OWN type", () => {
    const adminRequest = [
      { code: "open", category: "todo" as const },
      { code: "in_review", category: "doing" as const },
      { code: "answered", category: "done" as const },
      { code: "rejected", category: "cancelled" as const },
    ];
    expect(statusCodesOf(adminRequest)).toEqual({ done: "answered", open: "open", cancelled: "rejected" });
    const task = [
      { code: "open", category: "todo" as const },
      { code: "in_progress", category: "doing" as const },
      { code: "done", category: "done" as const },
      { code: "cancelled", category: "cancelled" as const },
    ];
    expect(statusCodesOf(task)).toEqual({ done: "done", open: "open", cancelled: "cancelled" });
    expect(statusCodesOf([])).toEqual({ done: "done", open: "open", cancelled: "cancelled" });
  });
});

describe("initialsOf — the photo's stand-in", () => {
  it("the first letter of each name, joined by a ZWNJ so they never connect", () => {
    expect(initialsOf("سارا", "احمدی")).toBe("س‌ا");
    expect(initialsOf(" علی ", "")).toBe("ع");
  });
});

describe("the actions' strict inputs", () => {
  it("a note: text required and capped, موضوع and visibility from their lists (defaults), no unknown key", () => {
    expect(CreateNoteInput.parse({ studentProfileId: STUDENT, body: "  متن " })).toEqual({ studentProfileId: STUDENT, body: "متن", kind: "general", visibility: "counselors_and_principal" });
    expect(CreateNoteInput.safeParse({ studentProfileId: STUDENT, body: "   " }).success).toBe(false);
    expect(CreateNoteInput.safeParse({ studentProfileId: STUDENT, body: "x".repeat(NOTE_MAX + 1) }).success).toBe(false);
    expect(CreateNoteInput.safeParse({ studentProfileId: STUDENT, body: "x", kind: "medical" }).success).toBe(false);
    expect(CreateNoteInput.safeParse({ studentProfileId: STUDENT, body: "x", visibility: "everyone" }).success).toBe(false);
    // The author, the school and the organization never come from the client.
    expect(CreateNoteInput.safeParse({ studentProfileId: STUDENT, body: "x", authorPersonId: ME }).success).toBe(false);
    expect(CreateNoteInput.safeParse({ studentProfileId: STUDENT, body: "x", schoolId: A }).success).toBe(false);
    expect(CreateNoteInput.safeParse({ studentProfileId: "not-a-uuid", body: "x" }).success).toBe(false);
  });

  it("an edit is a PATCH: only the note id is required", () => {
    expect(UpdateNoteInput.parse({ noteId: STUDENT })).toEqual({ noteId: STUDENT });
    expect(UpdateNoteInput.safeParse({ noteId: STUDENT, body: "" }).success).toBe(false);
    expect(UpdateNoteInput.safeParse({ noteId: STUDENT, status: "archived" }).success).toBe(false);
  });

  it("a teacher's report: a kind of the two, text capped at 1000", () => {
    expect(CreateTeacherReportInput.safeParse({ studentProfileId: STUDENT, kind: "behavioral", body: "x" }).success).toBe(true);
    expect(CreateTeacherReportInput.safeParse({ studentProfileId: STUDENT, kind: "family", body: "x" }).success).toBe(false);
    expect(CreateTeacherReportInput.safeParse({ studentProfileId: STUDENT, kind: "academic", body: "x".repeat(1001) }).success).toBe(false);
  });

  it("a referral needs a subject; a report request at least one teacher; neither names its recipients' school or the author", () => {
    expect(ReferInput.parse({ studentProfileId: STUDENT, subject: " غیبت " })).toEqual({ studentProfileId: STUDENT, subject: "غیبت", urgent: false });
    expect(ReferInput.safeParse({ studentProfileId: STUDENT, subject: "" }).success).toBe(false);
    expect(ReferInput.safeParse({ studentProfileId: STUDENT, subject: "x", recipientIds: [ME] }).success).toBe(false);
    expect(RequestReportInput.safeParse({ studentProfileId: STUDENT, teacherPersonIds: [] }).success).toBe(false);
    expect(RequestReportInput.safeParse({ studentProfileId: STUDENT, teacherPersonIds: [ME] }).success).toBe(true);
  });

  it("the list's search is bounded and the school is an id", () => {
    expect(CounselingStudentsInput.safeParse({ q: "x".repeat(81) }).success).toBe(false);
    expect(CounselingStudentsInput.safeParse({ schoolId: "s1" }).success).toBe(false);
    expect(CounselingStudentsInput.parse({})).toEqual({});
  });
});
