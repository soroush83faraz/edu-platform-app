// counseling/service — «مشاوره», phase 1 (owner, 2026-10-13; docs/decisions.md «مشاوره — فاز ۱»). Every function is
// `(tx, ctx, input)` inside the caller's tenant transaction (defineAction / defineQuery); `organization_id`, the author
// and the school come from the session and the database, never from input; every write is audited in the SAME
// transaction WITHOUT its text (a note's body, a report's body, a referral's subject — ids, kinds and lengths only:
// the audit trail outlives the row and is read by people the note was never meant for).
//
// The scope rule (NOT_FOUND outside it, never FORBIDDEN — a student of another school must look nonexistent):
//   • a student belongs to the school of their LIVE school enrollment (`findStudentAnchor`); the file is readable by
//     a holder of `counseling.case.read` reaching that school — the school's counselor, principal, vice principal,
//     the organization admin — and by nobody else (teachers, students, other schools);
//   • every note / report / referral is written AT that school and read per school (`reachSql`): a student who moves
//     to another school does not carry the old school's file to the new school's counselor;
//   • notes: written, edited and archived by a counselor of the school (`counseling.note.write`), the last two by
//     their author only; management reads a note only when its visibility is `counselors_and_principal`;
//   • a teacher reports only on a student they teach NOW (`taughtOfferingsOfStudent` + `can` at that offering) and
//     reads back only their own reports;
//   • a referral goes to the school's management (`counseling.referral.receive` there — else the organization admin),
//     a report request to some of the student's current teachers — both as CONFIDENTIAL work items
//     (`createConfidentialWorkItem`: participants only, audited without their text).
// The database checks the same thing once more for app_rw (the RESTRICTIVE policies of migration 0018).
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { tehranToday } from "@/lib/attendance";
import { audit, type AuditCtx } from "@/lib/audit";
import { AppError, forbidden, invalidReference, notFound, validation } from "@/lib/errors";
import { tehranJalaliMonth } from "@/lib/format";
import { defaultReportMonth } from "@/lib/objective-rating";
import { countStudentAttendance } from "@/modules/academic/repo";
import { can, canAtAnyScope, type Assignment, type CanContext } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";
import { getPermissionScope } from "@/modules/iam/service";
import { createConfidentialWorkItem } from "@/modules/workspace/service";
import {
  type CounselingViewer,
  type GradeGroup,
  type NoteKind,
  type NoteVisibility,
  type ReferralKind,
  type ReportKind,
  type SchoolReach,
  NO_REACH,
  NOTE_MAX,
  REFERRAL_BODY_MAX,
  REFERRAL_SUBJECT_MAX,
  REPORT_MAX,
  REQUEST_MESSAGE_MAX,
  canEditNote,
  groupByGrade,
  inReach,
  isEmptyReach,
  noteVisibleTo,
  referralTitle,
  teacherRequestDescription,
  teacherRequestTitle,
} from "./policy";
import {
  type NoteRow,
  type ReferralRow,
  type SchoolOption,
  type StudentAnchor,
  type StudentTeacher,
  type TeacherReportRow,
  STUDENT_LIST_LIMIT,
  findNote,
  findReferralByWorkItem,
  findReferralIdOfWorkItem,
  findReport,
  findStudentAnchor,
  isAssigneeOf,
  listGuardianPhones,
  listNotes,
  listReferrals,
  listSchoolStudents,
  listSchoolsInReach,
  listStudentTeachers,
  listTeacherReports,
  lockActivePersons,
  managementOfSchool,
  reportCardMonths,
  studentNameOf,
  taughtOfferingsOfStudent,
  workItemStats,
} from "./repo";
import { counselorNote, referral, teacherReport } from "./schema";

/** What the service needs from the request context (src/lib/ctx `Ctx` satisfies it; tests and the seed build one). */
export type CounselingCtx = AuditCtx & CanContext & { orgId: string; personId: string; assignments: readonly Assignment[] };

export const COUNSELING_MESSAGES = {
  notCounselor: "یادداشت مشاوره را فقط مشاور این مدرسه می‌نویسد.",
  notAuthor: "فقط نویسندهٴ یادداشت می‌تواند آن را ویرایش یا بایگانی کند.",
  notReportAuthor: "فقط نویسندهٴ گزارش می‌تواند آن را بایگانی کند.",
  notReferrer: "ارجاع و درخواست گزارش را فقط مشاور این مدرسه می‌فرستد.",
  noManagement: "برای این مدرسه مدیری ثبت نشده است؛ ارجاع ممکن نیست.",
  notTheirTeacher: "یکی از دبیران انتخاب‌شده دبیر این دانش‌آموز نیست.",
  pickTeacher: "دست‌کم یک دبیر را انتخاب کنید.",
  bodyRequired: "متن را وارد کنید.",
  subjectRequired: "موضوع ارجاع را وارد کنید.",
} as const;

const tooLong = (field: string, max: number) => validation({ fieldErrors: { [field]: [`حداکثر ${max.toLocaleString("fa-IR")} نویسه.`] } });
const required = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

// ---------------------------------------------------------------------------------------------------------------
// reach
// ---------------------------------------------------------------------------------------------------------------

/** Where the caller holds `permission` through a broad (organization/school/branch) assignment; NO_REACH when nowhere. */
export async function reachOf(tx: Tx, ctx: CounselingCtx, permission: Permission): Promise<SchoolReach> {
  if (!ctx.assignments.some((a) => a.permissions.includes(permission))) return NO_REACH;
  try {
    return await getPermissionScope(tx, ctx, permission);
  } catch (err) {
    // Held only at a narrow scope (a teacher's class offering) — that reaches no school.
    if (AppError.is(err) && err.code === "FORBIDDEN") return NO_REACH;
    throw err;
  }
}

export async function viewerOf(tx: Tx, ctx: CounselingCtx): Promise<CounselingViewer> {
  return {
    personId: ctx.personId,
    read: await reachOf(tx, ctx, "counseling.case.read"),
    write: await reachOf(tx, ctx, "counseling.note.write"),
    refer: await reachOf(tx, ctx, "counseling.referral.create"),
  };
}

/** The student, when the viewer's `read` reach holds their school — NOT_FOUND otherwise (no existence oracle). */
async function requireStudent(tx: Tx, viewer: CounselingViewer, studentProfileId: string): Promise<StudentAnchor> {
  const s = await findStudentAnchor(tx, studentProfileId);
  if (!s || !inReach(viewer.read, s.schoolId)) throw notFound();
  return s;
}

const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`;

// ---------------------------------------------------------------------------------------------------------------
// «مشاوره» — the students of a school
// ---------------------------------------------------------------------------------------------------------------

export interface CounselingStudents {
  /** The schools of the viewer's reach (a switcher when there are several). */
  schools: SchoolOption[];
  /** The school shown. */
  school: SchoolOption | null;
  groups: GradeGroup[];
  total: number;
  /** More students than one list draws (`STUDENT_LIST_LIMIT`) — the page asks for a search. */
  truncated: boolean;
  /** The viewer writes notes at this school (a counselor), or only reads (management). */
  canWrite: boolean;
}

/**
 * The students of ONE school of the viewer's `read` reach (`schoolId`, else the first), grouped by پایه, searchable
 * by name or student number. A `schoolId` outside the reach is NOT_FOUND.
 */
export async function listCounselingStudents(tx: Tx, ctx: CounselingCtx, input: { schoolId?: string; q?: string }): Promise<CounselingStudents> {
  const viewer = await viewerOf(tx, ctx);
  if (isEmptyReach(viewer.read)) throw notFound();
  const schools = await listSchoolsInReach(tx, viewer.read);
  const school = input.schoolId ? (schools.find((s) => s.id === input.schoolId) ?? null) : (schools[0] ?? null);
  if (input.schoolId && !school) throw notFound();
  if (!school) return { schools, school: null, groups: [], total: 0, truncated: false, canWrite: false };
  const rows = await listSchoolStudents(tx, school.id, input.q ?? "");
  return { schools, school, groups: groupByGrade(rows), total: rows.length, truncated: rows.length >= STUDENT_LIST_LIMIT, canWrite: inReach(viewer.write, school.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// «پروندهٴ مشاوره» — one student's file
// ---------------------------------------------------------------------------------------------------------------

export interface StudentFile {
  student: {
    studentProfileId: string;
    firstName: string;
    lastName: string;
    studentNumber: string;
    schoolName: string;
    academicYearName: string;
    classGroupName: string | null;
    gradeName: string | null;
    guardianPhones: string[];
  };
  academic: {
    /** Since the academic year's first day, through today (Tehran). */
    attendance: { absent: number; late: number; excused: number; from: string; to: string };
    work: { given: number; done: number; overdue: number };
    /** A primary student's «کارنامهٴ توصیفی» (the print page of their card), when the viewer may open it. */
    reportCard: { href: string; month: number } | null;
  };
  notes: Array<NoteRow & { mine: boolean; editable: boolean }>;
  reports: TeacherReportRow[];
  referrals: ReferralRow[];
  /** The student's current teachers — whom a report request can go to (counselors only; empty otherwise). */
  teachers: StudentTeacher[];
  viewer: { canWrite: boolean; canRefer: boolean };
}

/**
 * Everything the file shows, for a viewer whose `read` reach holds the student's school (NOT_FOUND otherwise): the
 * student and the guardian's phones, the year's attendance (غیبت / تأخیر / موجه) and تکالیف (done / given, overdue),
 * a primary student's report card, the notes the viewer may read (`listNotes`), the teachers' reports, the referrals
 * with their work item's live status and last note.
 */
export async function getStudentFile(tx: Tx, ctx: CounselingCtx, studentProfileId: string, now = new Date()): Promise<StudentFile> {
  const viewer = await viewerOf(tx, ctx);
  const s = await requireStudent(tx, viewer, studentProfileId);
  const guardianPhones = await listGuardianPhones(tx, s.personId);

  const today = tehranToday(now);
  const from = s.yearStartsOn <= today ? s.yearStartsOn : today;
  const counts = { absent: 0, late: 0, excused: 0 };
  for (const r of await countStudentAttendance(tx, s.studentProfileId, from, today)) {
    if (r.status === "absent" || r.status === "late" || r.status === "excused") counts[r.status] = r.n;
  }
  const work = await workItemStats(tx, s.personId, new Date(`${from}T00:00:00+03:30`), now);

  let reportCard: StudentFile["academic"]["reportCard"] = null;
  if (s.classGroupId && s.gradeLevelId) {
    const months = await reportCardMonths(tx, s.gradeLevelId);
    const month = defaultReportMonth(months, tehranJalaliMonth(now));
    if (month !== null && (await can(tx, ctx, "academic.objective_rating.read", { scopeType: "class_group", id: s.classGroupId }))) {
      reportCard = { href: `/report-card/${s.classGroupId}/print?month=${month}&student=${s.studentProfileId}`, month };
    }
  }

  const notes = (await listNotes(tx, s.studentProfileId, viewer)).map((n) => ({
    ...n,
    mine: n.authorPersonId === ctx.personId,
    editable: canEditNote(n, viewer),
  }));
  const canRefer = inReach(viewer.refer, s.schoolId);
  return {
    student: {
      studentProfileId: s.studentProfileId,
      firstName: s.firstName,
      lastName: s.lastName,
      studentNumber: s.studentNumber,
      schoolName: s.schoolName,
      academicYearName: s.academicYearName,
      classGroupName: s.classGroupName,
      gradeName: s.gradeName,
      guardianPhones,
    },
    academic: { attendance: { ...counts, from, to: today }, work, reportCard },
    notes,
    reports: await listTeacherReports(tx, s.studentProfileId, { read: viewer.read }),
    referrals: await listReferrals(tx, s.studentProfileId, viewer.read),
    teachers: canRefer ? (await listStudentTeachers(tx, s.studentProfileId, s.schoolId)).filter((t) => t.personId !== ctx.personId) : [],
    viewer: { canWrite: inReach(viewer.write, s.schoolId), canRefer },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------------------------------------------

export interface CreateNoteInput {
  studentProfileId: string;
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
}

function cleanBody(body: string, max: number, field = "body"): string {
  const b = body.trim();
  if (b === "") throw required(field, COUNSELING_MESSAGES.bodyRequired);
  if (b.length > max) throw tooLong(field, max);
  return b;
}

/** «یادداشت جدید»: a counselor of the student's school, in their own name, at that school. */
export async function createCounselorNote(tx: Tx, ctx: CounselingCtx, input: CreateNoteInput): Promise<{ id: string }> {
  const viewer = await viewerOf(tx, ctx);
  const s = await requireStudent(tx, viewer, input.studentProfileId);
  if (!inReach(viewer.write, s.schoolId)) throw forbidden(COUNSELING_MESSAGES.notCounselor);
  const body = cleanBody(input.body, NOTE_MAX);
  const [row] = await tx
    .insert(counselorNote)
    .values({ organizationId: ctx.orgId, schoolId: s.schoolId, studentProfileId: s.studentProfileId, authorPersonId: ctx.personId, kind: input.kind, visibility: input.visibility, body })
    .returning({ id: counselorNote.id });
  await audit(
    ctx,
    "counseling.counselor_note.created",
    { schema: "counseling", table: "counselor_note", id: row.id },
    null,
    { studentProfileId: s.studentProfileId, schoolId: s.schoolId, kind: input.kind, visibility: input.visibility, length: body.length },
    tx,
  );
  return { id: row.id };
}

/**
 * A note the caller may READ — else NOT_FOUND — and may EDIT — its author, still a counselor there — else FORBIDDEN;
 * then the same row under its lock (the UPDATE policy of 0018 admits its author only).
 */
async function noteForEdit(tx: Tx, ctx: CounselingCtx, noteId: string) {
  const viewer = await viewerOf(tx, ctx);
  const note = await findNote(tx, noteId);
  if (!note || !noteVisibleTo(note, viewer)) throw notFound();
  if (!canEditNote(note, viewer)) throw forbidden(COUNSELING_MESSAGES.notAuthor);
  const locked = await findNote(tx, noteId, { lock: true });
  if (!locked || locked.status !== "active") throw notFound();
  return locked;
}

export interface UpdateNoteInput {
  noteId: string;
  kind?: NoteKind;
  visibility?: NoteVisibility;
  body?: string;
}

/** «ویرایش یادداشت» — a PATCH by its author; nothing changed → nothing written. The audit row says WHAT changed, not to what text. */
export async function updateCounselorNote(tx: Tx, ctx: CounselingCtx, input: UpdateNoteInput): Promise<{ changed: Array<"kind" | "visibility" | "body"> }> {
  const note = await noteForEdit(tx, ctx, input.noteId);
  const body = input.body === undefined ? undefined : cleanBody(input.body, NOTE_MAX);
  const set: Partial<{ kind: NoteKind; visibility: NoteVisibility; body: string }> = {};
  if (input.kind !== undefined && input.kind !== note.kind) set.kind = input.kind;
  if (input.visibility !== undefined && input.visibility !== note.visibility) set.visibility = input.visibility;
  if (body !== undefined && body !== note.body) set.body = body;
  const changed = Object.keys(set) as Array<"kind" | "visibility" | "body">;
  if (changed.length === 0) return { changed };
  await tx.update(counselorNote).set(set).where(eq(counselorNote.id, note.id));
  await audit(
    ctx,
    "counseling.counselor_note.updated",
    { schema: "counseling", table: "counselor_note", id: note.id },
    { kind: note.kind, visibility: note.visibility, length: note.body.length },
    { kind: set.kind ?? note.kind, visibility: set.visibility ?? note.visibility, length: (set.body ?? note.body).length, bodyChanged: set.body !== undefined },
    tx,
  );
  return { changed };
}

/** «بایگانی یادداشت» — soft (status/archived_at), by its author; it leaves every list. */
export async function archiveCounselorNote(tx: Tx, ctx: CounselingCtx, input: { noteId: string }): Promise<{ archived: true }> {
  const note = await noteForEdit(tx, ctx, input.noteId);
  await tx.update(counselorNote).set({ status: "archived", archivedAt: sql`now()` }).where(eq(counselorNote.id, note.id));
  await audit(ctx, "counseling.counselor_note.archived", { schema: "counseling", table: "counselor_note", id: note.id }, { status: "active" }, { status: "archived", studentProfileId: note.studentProfileId, kind: note.kind }, tx);
  return { archived: true };
}

// ---------------------------------------------------------------------------------------------------------------
// «گزارش به مشاور» — the teacher's side
// ---------------------------------------------------------------------------------------------------------------

/**
 * The student, when the caller teaches them NOW and holds `counseling.teacher_report.write` at one of those
 * offerings (the teacher role) — the offering the report is filed under; NOT_FOUND otherwise.
 */
async function requireTaughtStudent(tx: Tx, ctx: CounselingCtx, studentProfileId: string): Promise<{ student: StudentAnchor; classOfferingId: string }> {
  if (!canAtAnyScope(ctx.assignments, "counseling.teacher_report.write")) throw notFound();
  const s = await findStudentAnchor(tx, studentProfileId);
  if (!s) throw notFound();
  for (const offeringId of await taughtOfferingsOfStudent(tx, ctx.personId, s.studentProfileId, s.schoolId)) {
    if (await can(tx, ctx, "counseling.teacher_report.write", { scopeType: "class_offering", id: offeringId })) return { student: s, classOfferingId: offeringId };
  }
  throw notFound();
}

export interface TeacherReportPage {
  student: { studentProfileId: string; name: string; classGroupName: string | null; schoolName: string };
  /** The caller's own reports on this student, newest first — never anyone else's, never a note. */
  mine: TeacherReportRow[];
}

export async function getTeacherReportPage(tx: Tx, ctx: CounselingCtx, studentProfileId: string): Promise<TeacherReportPage> {
  const { student } = await requireTaughtStudent(tx, ctx, studentProfileId);
  return {
    student: { studentProfileId: student.studentProfileId, name: fullName(student), classGroupName: student.classGroupName, schoolName: student.schoolName },
    mine: await listTeacherReports(tx, student.studentProfileId, { authorPersonId: ctx.personId }),
  };
}

/** «گزارش به مشاور»: a teacher of the student files a short academic / behavioural report for the school's counselors. */
export async function createTeacherReport(tx: Tx, ctx: CounselingCtx, input: { studentProfileId: string; kind: ReportKind; body: string }): Promise<{ id: string }> {
  const { student, classOfferingId } = await requireTaughtStudent(tx, ctx, input.studentProfileId);
  const body = cleanBody(input.body, REPORT_MAX);
  const [row] = await tx
    .insert(teacherReport)
    .values({ organizationId: ctx.orgId, schoolId: student.schoolId, studentProfileId: student.studentProfileId, authorPersonId: ctx.personId, classOfferingId, kind: input.kind, body })
    .returning({ id: teacherReport.id });
  await audit(
    ctx,
    "counseling.teacher_report.created",
    { schema: "counseling", table: "teacher_report", id: row.id },
    null,
    { studentProfileId: student.studentProfileId, schoolId: student.schoolId, classOfferingId, kind: input.kind, length: body.length },
    tx,
  );
  return { id: row.id };
}

/** «حذف گزارش» — soft, by its author (who may have stopped teaching the student since; the report is theirs). */
export async function archiveTeacherReport(tx: Tx, ctx: CounselingCtx, input: { reportId: string }): Promise<{ archived: true }> {
  const report = await findReport(tx, input.reportId);
  if (!report || report.status !== "active") throw notFound();
  if (report.authorPersonId !== ctx.personId) {
    // A case reader sees every report but owns none of them; anyone else does not see it at all.
    if (inReach(await reachOf(tx, ctx, "counseling.case.read"), report.schoolId)) throw forbidden(COUNSELING_MESSAGES.notReportAuthor);
    throw notFound();
  }
  const locked = await findReport(tx, input.reportId, { lock: true });
  if (!locked || locked.status !== "active") throw notFound();
  await tx.update(teacherReport).set({ status: "archived", archivedAt: sql`now()` }).where(eq(teacherReport.id, locked.id));
  await audit(ctx, "counseling.teacher_report.archived", { schema: "counseling", table: "teacher_report", id: locked.id }, { status: "active" }, { status: "archived", studentProfileId: locked.studentProfileId, kind: locked.kind }, tx);
  return { archived: true };
}

// ---------------------------------------------------------------------------------------------------------------
// referrals
// ---------------------------------------------------------------------------------------------------------------

/** The student, when the caller is a counselor who may refer at their school (NOT_FOUND / FORBIDDEN as the notes). */
async function requireReferrer(tx: Tx, ctx: CounselingCtx, studentProfileId: string): Promise<StudentAnchor> {
  const viewer = await viewerOf(tx, ctx);
  const s = await requireStudent(tx, viewer, studentProfileId);
  if (!inReach(viewer.refer, s.schoolId)) throw forbidden(COUNSELING_MESSAGES.notReferrer);
  return s;
}

/** The referral row of a new (or, on a replayed form, the existing) work item. */
async function linkReferral(tx: Tx, ctx: CounselingCtx, s: StudentAnchor, kind: ReferralKind, workItemId: string, duplicate: boolean): Promise<string> {
  if (duplicate) {
    const existing = await findReferralIdOfWorkItem(tx, workItemId);
    if (existing) return existing;
  }
  const [row] = await tx
    .insert(referral)
    .values({ organizationId: ctx.orgId, schoolId: s.schoolId, studentProfileId: s.studentProfileId, workItemId, kind, createdByPersonId: ctx.personId })
    .returning({ id: referral.id });
  return row.id;
}

export interface ReferInput {
  studentProfileId: string;
  subject: string;
  description?: string | null;
  urgent?: boolean;
  idempotencyKey?: string | null;
}

export interface ReferralResult {
  referralId: string;
  workItemId: string;
  recipients: number;
  duplicate: boolean;
}

/**
 * «ارجاع به مدیریت»: an `admin_request` to the school's management (`managementOfSchool` — its principal and vice
 * principals, else the organization admin; VALIDATION when there is nobody), CONFIDENTIAL — only they and the
 * counselor see it. They handle it in «پنل من»; the first answer closes it and its note is the decision the file shows.
 * Recipients are locked (FOR KEY SHARE) before the item is written — person rows before work items.
 */
export async function referToManagement(tx: Tx, ctx: CounselingCtx, input: ReferInput): Promise<ReferralResult> {
  const s = await requireReferrer(tx, ctx, input.studentProfileId);
  const subject = input.subject.trim();
  if (subject === "") throw required("subject", COUNSELING_MESSAGES.subjectRequired);
  if (subject.length > REFERRAL_SUBJECT_MAX) throw tooLong("subject", REFERRAL_SUBJECT_MAX);
  const description = input.description?.trim() || null;
  if (description && description.length > REFERRAL_BODY_MAX) throw tooLong("description", REFERRAL_BODY_MAX);
  const recipients = await lockActivePersons(tx, await managementOfSchool(tx, s.schoolId, ctx.personId));
  if (recipients.length === 0) throw validation(undefined, COUNSELING_MESSAGES.noManagement);
  const name = fullName(s);
  const wi = await createConfidentialWorkItem(tx, ctx, {
    typeCode: "admin_request",
    title: referralTitle(name, subject),
    description,
    priority: input.urgent ? "urgent" : "normal",
    dueAt: null,
    recipientIds: recipients,
    notificationTitle: `ارجاع مشاور: ${name}`,
    idempotencyKey: input.idempotencyKey ?? null,
    auditContext: { studentProfileId: s.studentProfileId, schoolId: s.schoolId, referral: "management" },
  });
  const referralId = await linkReferral(tx, ctx, s, "management", wi.id, wi.duplicate === true);
  if (!wi.duplicate) {
    await audit(
      ctx,
      "counseling.referral.created",
      { schema: "counseling", table: "referral", id: referralId },
      null,
      { kind: "management", studentProfileId: s.studentProfileId, schoolId: s.schoolId, workItemId: wi.id, recipients: wi.assigneeCount, subjectLength: subject.length, descriptionLength: description?.length ?? 0, urgent: input.urgent === true },
      tx,
    );
  }
  return { referralId, workItemId: wi.id, recipients: wi.assigneeCount, duplicate: wi.duplicate === true };
}

export interface RequestReportInput {
  studentProfileId: string;
  teacherPersonIds: readonly string[];
  message?: string | null;
  idempotencyKey?: string | null;
}

/**
 * «درخواست گزارش از دبیر»: a CONFIDENTIAL `task` to some of the student's CURRENT teachers (INVALID_REFERENCE for
 * anyone else — the answer an unknown id gets). Each teacher answers with «گزارش به مشاور» (the item links to it)
 * and «انجام شد»; the file shows who has.
 */
export async function requestTeacherReport(tx: Tx, ctx: CounselingCtx, input: RequestReportInput): Promise<ReferralResult> {
  const s = await requireReferrer(tx, ctx, input.studentProfileId);
  const wanted = [...new Set(input.teacherPersonIds)];
  if (wanted.length === 0) throw required("teacherPersonIds", COUNSELING_MESSAGES.pickTeacher);
  const message = input.message?.trim() || null;
  if (message && message.length > REQUEST_MESSAGE_MAX) throw tooLong("message", REQUEST_MESSAGE_MAX);
  const teachers = new Set((await listStudentTeachers(tx, s.studentProfileId, s.schoolId)).map((t) => t.personId));
  if (wanted.some((id) => !teachers.has(id) || id === ctx.personId)) throw invalidReference(COUNSELING_MESSAGES.notTheirTeacher);
  const recipients = await lockActivePersons(tx, wanted);
  if (recipients.length !== wanted.length) throw invalidReference(COUNSELING_MESSAGES.notTheirTeacher);
  const name = fullName(s);
  const wi = await createConfidentialWorkItem(tx, ctx, {
    typeCode: "task",
    title: teacherRequestTitle(name),
    description: teacherRequestDescription(message),
    priority: "normal",
    dueAt: null,
    recipientIds: recipients,
    notificationTitle: `درخواست گزارش مشاور: ${name}`,
    idempotencyKey: input.idempotencyKey ?? null,
    auditContext: { studentProfileId: s.studentProfileId, schoolId: s.schoolId, referral: "teacher" },
  });
  const referralId = await linkReferral(tx, ctx, s, "teacher", wi.id, wi.duplicate === true);
  if (!wi.duplicate) {
    await audit(
      ctx,
      "counseling.referral.created",
      { schema: "counseling", table: "referral", id: referralId },
      null,
      { kind: "teacher", studentProfileId: s.studentProfileId, schoolId: s.schoolId, workItemId: wi.id, recipients: wi.assigneeCount, messageLength: message?.length ?? 0 },
      tx,
    );
  }
  return { referralId, workItemId: wi.id, recipients: wi.assigneeCount, duplicate: wi.duplicate === true };
}

// ---------------------------------------------------------------------------------------------------------------
// the way from a work item back to the file
// ---------------------------------------------------------------------------------------------------------------

export interface CounselingLink {
  /** `report` — a teacher a report request went to: their «گزارش به مشاور» page; `file` — a case reader: the file. */
  kind: "report" | "file";
  href: string;
  studentName: string;
}

/**
 * For the work item page (`/inbox/[id]`): where this item leads in «مشاوره» for THIS reader — a teacher the request
 * went to → their report page (while they still teach the student); a case reader of the referral's school → the
 * student file; anyone else (or an item that is no referral) → null. RLS hides the referral row from everyone else.
 */
export async function counselingLinkForWorkItem(tx: Tx, ctx: CounselingCtx, workItemId: string): Promise<CounselingLink | null> {
  const r = await findReferralByWorkItem(tx, workItemId);
  if (!r) return null;
  const name = (await studentNameOf(tx, r.studentProfileId)) ?? "";
  if (r.kind === "teacher" && (await isAssigneeOf(tx, ctx.personId, workItemId))) {
    try {
      await requireTaughtStudent(tx, ctx, r.studentProfileId);
      return { kind: "report", href: `/counseling/report/${r.studentProfileId}`, studentName: name };
    } catch (err) {
      if (!(AppError.is(err) && err.code === "NOT_FOUND")) throw err;
    }
  }
  // The file opens on the student's CURRENT school (`requireStudent`), so the link is offered only when that is in reach.
  const read = await reachOf(tx, ctx, "counseling.case.read");
  if (inReach(read, r.schoolId)) {
    const s = await findStudentAnchor(tx, r.studentProfileId);
    if (s && inReach(read, s.schoolId)) return { kind: "file", href: `/counseling/students/${r.studentProfileId}`, studentName: name };
  }
  return null;
}
