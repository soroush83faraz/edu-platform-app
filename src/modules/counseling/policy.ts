// counseling/policy — the pure rules of «مشاوره» (no database, no Next): who reads which note, who edits it, how the
// students of a school are grouped, what a referral's work-item status reads as, and the strings a referral is
// written with. The service applies the same rules in SQL (repo `reachSql`), the database once more in the
// RESTRICTIVE policies of migration 0018; tests/unit/counseling-policy.test.ts pins them.
import type { StatusCategory } from "@/modules/workspace/repo";

// ---------------------------------------------------------------------------------------------------------------
// reach
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where the viewer holds a `counseling.*` permission: the whole organization (an organization-scoped assignment —
 * the organization admin) or a set of schools (school-/branch-scoped — the counselor, the principal, the vice
 * principal). The shape of `AdminScope` (iam/service `getPermissionScope`), so a branch counts as its school.
 */
export type SchoolReach = { kind: "organization" } | { kind: "school"; schoolIds: readonly string[] };

/** No assignment carries the permission. */
export const NO_REACH: SchoolReach = { kind: "school", schoolIds: [] };

export function inReach(reach: SchoolReach, schoolId: string | null | undefined): boolean {
  if (!schoolId) return false;
  return reach.kind === "organization" || reach.schoolIds.includes(schoolId);
}

export function isEmptyReach(reach: SchoolReach): boolean {
  return reach.kind === "school" && reach.schoolIds.length === 0;
}

/**
 * The three reaches of one viewer: `read` = `counseling.case.read` (the file: the counselor and the school's
 * management), `write` = `counseling.note.write` (the counselors — they alone write notes and read the
 * counselors-only ones), `refer` = `counseling.referral.create` (the counselors' referrals and report requests).
 */
export interface CounselingViewer {
  personId: string;
  read: SchoolReach;
  write: SchoolReach;
  refer: SchoolReach;
}

// ---------------------------------------------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------------------------------------------

export const NOTE_KINDS = ["general", "academic", "behavioral", "family"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABELS: Record<NoteKind, string> = { general: "عمومی", academic: "تحصیلی", behavioral: "رفتاری", family: "خانوادگی" };

/** `counselors` = the counselors of the note's school only; `counselors_and_principal` (default) = also its management. */
export const NOTE_VISIBILITIES = ["counselors_and_principal", "counselors"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];
export const NOTE_VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  counselors_and_principal: "مشاوران و مدیریت مدرسه",
  counselors: "فقط مشاوران",
};

export const NOTE_MAX = 4000;
export const REPORT_MAX = 1000;
export const REFERRAL_SUBJECT_MAX = 120;
export const REFERRAL_BODY_MAX = 2000;
export const REQUEST_MESSAGE_MAX = 1000;

export interface NoteFacts {
  schoolId: string;
  visibility: NoteVisibility;
  status: "active" | "archived";
}

/**
 * May the viewer READ this note? An archived note: nobody. Otherwise a counselor of its school (`write` reach)
 * reads every note there; the school's other case readers (management) read it only when its visibility is
 * `counselors_and_principal`; anyone else — a teacher, a student, another school's counselor — nothing.
 */
export function noteVisibleTo(note: NoteFacts, viewer: Pick<CounselingViewer, "read" | "write">): boolean {
  if (note.status !== "active") return false;
  if (inReach(viewer.write, note.schoolId)) return true;
  return note.visibility === "counselors_and_principal" && inReach(viewer.read, note.schoolId);
}

/** May the viewer EDIT / ARCHIVE it? Its author only, while still a counselor of its school, and only an active note. */
export function canEditNote(note: NoteFacts & { authorPersonId: string }, viewer: Pick<CounselingViewer, "personId" | "write">): boolean {
  return note.status === "active" && note.authorPersonId === viewer.personId && inReach(viewer.write, note.schoolId);
}

// ---------------------------------------------------------------------------------------------------------------
// teacher reports
// ---------------------------------------------------------------------------------------------------------------

export const REPORT_KINDS = ["academic", "behavioral"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_KIND_LABELS: Record<ReportKind, string> = { academic: "درسی", behavioral: "رفتاری" };

// ---------------------------------------------------------------------------------------------------------------
// the students of a school, grouped by پایه
// ---------------------------------------------------------------------------------------------------------------

export interface CounselingStudentRow {
  studentProfileId: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
  classGroupName: string | null;
  gradeLevelId: string | null;
  gradeName: string | null;
  gradeSequence: number | null;
}

export interface GradeGroup {
  /** The پایه id, or `none` for students not yet placed in a پایه. */
  key: string;
  /** «پایهٴ هفتم», or null for the «بدون پایه» group. */
  gradeName: string | null;
  students: CounselingStudentRow[];
}

const collator = new Intl.Collator("fa", { numeric: true });

/**
 * One group per پایه the school's students are in, in the پایه's own order (هفتم, هشتم, نهم — the fixed catalog's
 * sequence), the students not placed in a پایه last; inside a group by class, then family name, then first name.
 */
export function groupByGrade(rows: readonly CounselingStudentRow[]): GradeGroup[] {
  const groups = new Map<string, GradeGroup & { sequence: number }>();
  for (const r of rows) {
    const key = r.gradeLevelId ?? "none";
    let g = groups.get(key);
    if (!g) {
      g = { key, gradeName: r.gradeLevelId ? r.gradeName : null, students: [], sequence: r.gradeLevelId ? (r.gradeSequence ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER };
      groups.set(key, g);
    }
    g.students.push(r);
  }
  const byStudent = (a: CounselingStudentRow, b: CounselingStudentRow) =>
    collator.compare(a.classGroupName ?? "￿", b.classGroupName ?? "￿") || collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);
  return [...groups.values()]
    .sort((a, b) => a.sequence - b.sequence || collator.compare(a.gradeName ?? "", b.gradeName ?? ""))
    .map(({ key, gradeName, students }) => ({ key, gradeName, students: [...students].sort(byStudent) }));
}

/** «ع‌ر» — the first letter of the first name and of the family name, joined by a ZWNJ so the two never connect. */
export function initialsOf(firstName: string, lastName: string): string {
  const first = [...firstName.trim()][0] ?? "";
  const last = [...lastName.trim()][0] ?? "";
  return first && last ? `${first}‌${last}` : first || last;
}

// ---------------------------------------------------------------------------------------------------------------
// referrals
// ---------------------------------------------------------------------------------------------------------------

export const REFERRAL_KINDS = ["management", "teacher"] as const;
export type ReferralKind = (typeof REFERRAL_KINDS)[number];
export const REFERRAL_KIND_LABELS: Record<ReferralKind, string> = { management: "ارجاع به مدیریت", teacher: "درخواست گزارش از دبیر" };

/** What the counselor reads for the work item's status: «در انتظار / در جریان / انجام‌شده», or closed without it. */
export type ReferralState = "pending" | "in_progress" | "done" | "closed";
export const REFERRAL_STATE_LABELS: Record<ReferralState, string> = { pending: "در انتظار", in_progress: "در جریان", done: "انجام‌شده", closed: "بسته‌شده" };

export function referralState(category: StatusCategory): ReferralState {
  switch (category) {
    case "todo":
      return "pending";
    case "doing":
      return "in_progress";
    case "done":
      return "done";
    case "cancelled":
      return "closed";
  }
}

/** The work item's title of «ارجاع به مدیریت»: who it is about, then the counselor's subject (≤ 200 like every title). */
export function referralTitle(studentName: string, subject: string): string {
  return `ارجاع مشاور — ${studentName}: ${subject.trim()}`.slice(0, 200);
}

/** The work item's title of «درخواست گزارش از دبیر». */
export function teacherRequestTitle(studentName: string): string {
  return `درخواست گزارش مشاور — ${studentName}`.slice(0, 200);
}

/**
 * The counselor's bell (owner, 2026-10-14): what happened and about whom — the student's name and the kind of event,
 * NEVER a note's, a report's or an answer's text, nor a referral's subject (a notification row is a copy that lives
 * outside the RESTRICTIVE policies of 0018). Every one of them opens the student's file.
 */
export type CounselingEvent = "referral_answered" | "teacher_report" | "report_request_done";

export function counselingNotificationTitle(event: CounselingEvent, studentName: string): string {
  const title = {
    referral_answered: `پاسخ مدیریت به ارجاع: ${studentName}`,
    teacher_report: `گزارش دبیر دربارهٴ ${studentName}`,
    report_request_done: `پاسخ دبیر به درخواست گزارش: ${studentName}`,
  }[event];
  return title.slice(0, 200);
}

/** Where a counselor's notification leads: the student's «پروندهٴ مشاوره». */
export function studentFileHref(studentProfileId: string): string {
  return `/counseling/students/${studentProfileId}`;
}

/** The fixed last paragraph of a report request: how the teacher answers it. */
export const TEACHER_REQUEST_GUIDE = "لطفاً گزارش خود را با «ثبت گزارش برای مشاور» در همین صفحه بفرستید و بعد «انجام شد» را بزنید.";

/** The description of a report request: the counselor's message (optional), then the guide. */
export function teacherRequestDescription(message: string | null | undefined): string {
  const m = message?.trim();
  return m ? `${m}\n\n${TEACHER_REQUEST_GUIDE}` : TEACHER_REQUEST_GUIDE;
}
