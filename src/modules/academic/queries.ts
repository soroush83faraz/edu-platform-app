// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { can } from "@/modules/iam/can";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById, listSchoolPeriods } from "@/modules/tenancy/repo";
import { attendanceGaps, classAttendanceReport, defaultRange, getSessionForTaking, studentAttendanceSummary, teacherDay } from "./attendance";
import { attendanceReportReach } from "./attendance-report";
import {
  AttendanceCellInput,
  AttendanceReportInput,
  ClassAttendanceInput,
  ClassGroupIdInput,
  MyAttendanceInput,
  MyReportCardInput,
  OfferingIdInput,
  ReportClassInput,
  ReportPrintInput,
  ReportSheetInput,
  SchoolIdInput,
  SessionReportCellInput,
  StudentAttendanceInput,
} from "./dto";
import { pendingLeaveCount } from "./leave";
import { classReportCards, classReportOverview, getRatingSheet, listRatableClasses, myReportCard, reportCardReach } from "./report-card";
import { findStudentProfile, getMyClass, listClassesForPicker } from "./repo";
import { getClassTimetable, getMyTimetable, getOfferingLink, getOfferingPage } from "./service";
import { getSessionReportCell, listOfferingSessionReports } from "./session-report";

export type { MyClass, MyClassTeacher } from "./repo";
export type { ClassTimetable, DayPlan, MyTimetable, OfferingPage, Session, TimetableOffering } from "./service";

/** «کلاس من» of the signed-in student (null without an active enrollment). Personal read — checked at any scope. */
export const myClassQuery = defineQuery({ permission: "workspace.work_item.read", scope: "any" }, async (tx, _input, ctx) => getMyClass(tx, ctx.personId));

/** «برنامهٴ من»: the student's class timetable and/or the teacher's sessions, with today and the ringing زنگ. */
export const myTimetableQuery = defineQuery({ permission: "academic.timetable.read", scope: "any" }, async (tx, _input, ctx) => getMyTimetable(tx, ctx));

/** The grid of one class for the admin editor (`/admin/classes/[id]/timetable`); out of scope = NOT_FOUND. */
export const classTimetableQuery = defineQuery({ schema: ClassGroupIdInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) =>
  getClassTimetable(tx, ctx, input.classGroupId),
);

/** The subject page (`/subjects/[offeringId]`): the offering's facts, its sessions and the viewer's relation to it. */
export const offeringPageQuery = defineQuery({ schema: OfferingIdInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) =>
  getOfferingPage(tx, ctx, input.offeringId),
);

/** «برگشت» of a کار of a درس: the subject page's link when the viewer may open it (same gate), else NOT_FOUND. */
export const offeringLinkQuery = defineQuery({ schema: OfferingIdInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) =>
  getOfferingLink(tx, ctx, input.offeringId),
);

/** زنگ‌بندی of one school for the admin editor; `canEdit` = structure write at that school (org admin, principal, vice principal). */
export const schoolPeriodsQuery = defineQuery(
  { schema: SchoolIdInput, permission: "iam.admin.access", scope: "any" },
  async (tx, input, ctx) => {
    const scope = await getAdminScope(tx, ctx);
    assertSchoolInScope(scope, input.schoolId);
    const school = await findSchoolById(tx, input.schoolId);
    if (!school) throw notFound();
    const canEdit = await can(tx, ctx, "tenancy.structure.write", { scopeType: "school", id: school.id });
    return { school: { id: school.id, name: school.name }, periods: await listSchoolPeriods(tx, school.id), canEdit };
  },
);

// ---------------------------------------------------------------------------------------------------------------
// attendance («حضور و غیاب»)
// ---------------------------------------------------------------------------------------------------------------

export type { ClassAttendanceReport, ClassReportDay, ClassReportStudent, SessionForTaking, StudentAttendanceSummary, TakingRow, TeacherDayCell, TodayGaps } from "./attendance";

/** The roster of one cell for the taking page; out of scope (a class that is not yours) = NOT_FOUND. */
export const attendanceSessionQuery = defineQuery({ schema: AttendanceCellInput, permission: "academic.attendance.read", scope: "any" }, async (tx, input, ctx) =>
  getSessionForTaking(tx, ctx, { classGroupId: input.classGroupId, date: input.date, periodNo: input.periodNo ?? null }),
);

/** «حضور و غیاب من»: the signed-in student's own summary — null when the person is not a student. */
export const myAttendanceQuery = defineQuery({ schema: MyAttendanceInput, permission: "academic.attendance.read", scope: "any" }, async (tx, input, ctx) => {
  const mine = await findStudentProfile(tx, ctx.personId);
  if (!mine) return null;
  const range = defaultRange();
  return studentAttendanceSummary(tx, ctx, { studentProfileId: mine.id, from: input.from ?? range.from, to: input.to ?? range.to });
});

/** One student's attendance for staff (the admin report's drill-down); the service owns the scope rule. */
export const studentAttendanceQuery = defineQuery({ schema: StudentAttendanceInput, permission: "academic.attendance.read", scope: "any" }, async (tx, input, ctx) =>
  studentAttendanceSummary(tx, ctx, { studentProfileId: input.studentProfileId, from: input.from, to: input.to }),
);

/** Per-student totals and per-day rows of one class (admins of its school, and the teachers who teach in it). */
export const classAttendanceReportQuery = defineQuery({ schema: ClassAttendanceInput, permission: "academic.attendance.read", scope: "any" }, async (tx, input, ctx) =>
  classAttendanceReport(tx, ctx, { classGroupId: input.classGroupId, from: input.from, to: input.to }),
);

/** The teacher's own زنگ‌های today, marked «ثبت‌شده» or not — what `/attendance` opens on for a teacher. */
export const teacherDayQuery = defineQuery({ permission: "academic.attendance.write", scope: "any" }, async (tx, _input, ctx) => teacherDay(tx, ctx));

/**
 * The school `/admin/attendance?school=` is filtered to — its name for the title and the way back to its hub.
 * Out of the caller's admin scope (or of the tenant) → NOT_FOUND (`attendanceReportReach`).
 */
export const attendanceReportSchoolQuery = defineQuery({ schema: SchoolIdInput, permission: "academic.attendance.report", scope: "any" }, async (tx, input, ctx) => {
  const reach = await attendanceReportReach(tx, ctx, input.schoolId);
  if (!reach.school) throw notFound();
  return reach.school;
});

/** «امروز ثبت نشده» for the admin page, narrowed to the caller's schools — or the ONE school of `?school=`. */
export const attendanceGapsQuery = defineQuery({ schema: AttendanceReportInput, permission: "academic.attendance.report", scope: "any" }, async (tx, input, ctx) => {
  const reach = await attendanceReportReach(tx, ctx, input.schoolId);
  return attendanceGaps(tx, reach.schoolIds);
});

/** The class picker of `/admin/attendance`: the caller's active classes (the admin scope — or `?school=` — filters them). */
export const attendanceClassesQuery = defineQuery({ schema: AttendanceReportInput, permission: "academic.attendance.report", scope: "any" }, async (tx, input, ctx) => {
  const reach = await attendanceReportReach(tx, ctx, input.schoolId);
  return listClassesForPicker(tx, reach.schoolIds);
});

/** Guardians' leave requests waiting for the caller's schools — the badge on Home's «درخواست‌های مرخصی» tile (the other leave reads: ./leave-queries). */
export const pendingLeaveCountQuery = defineQuery({ permission: "academic.leave.decide", scope: "any" }, async (tx, _input, ctx) => pendingLeaveCount(tx, ctx));

// ---------------------------------------------------------------------------------------------------------------
// «کارنامهٴ توصیفی» (descriptive report card) — the service decides the scope inside the transaction (NOT_FOUND)
// ---------------------------------------------------------------------------------------------------------------

export type { ClassReportOverview, ClassStudentSummary, ClassSubjectProgress, RatableClass, RatingSheet, ReportCardReach, ReportCardSubject, SheetRow, StudentReportCard } from "./report-card";

/** Whether Home shows «کارنامهٴ توصیفی» (staff of a primary class) / «کارنامهٴ من» (a primary student). */
export const reportCardReachQuery = defineQuery({ permission: "academic.objective_rating.read", scope: "any" }, async (tx, _input, ctx) => reportCardReach(tx, ctx));

/** The classes whose report cards the caller may open (admins: their schools; teachers: the classes they teach). */
export const reportCardClassesQuery = defineQuery({ permission: "academic.objective_rating.read", scope: "any" }, async (tx, _input, ctx) => listRatableClasses(tx, ctx));

/** One class × month: درس‌ها with progress and the per-student summary («کارنامهٴ کلاس»). */
export const classReportQuery = defineQuery({ schema: ReportClassInput, permission: "academic.objective_rating.read", scope: "any" }, async (tx, input, ctx) =>
  classReportOverview(tx, ctx, { classGroupId: input.classGroupId, month: input.month }),
);

/** The entry roster of one class × month × درس. */
export const ratingSheetQuery = defineQuery({ schema: ReportSheetInput, permission: "academic.objective_rating.read", scope: "any" }, async (tx, input, ctx) =>
  getRatingSheet(tx, ctx, { classGroupId: input.classGroupId, month: input.month, subjectName: input.subjectName }),
);

/** The printable cards of a class (all students, or one). */
export const classReportCardsQuery = defineQuery({ schema: ReportPrintInput, permission: "academic.objective_rating.read", scope: "any" }, async (tx, input, ctx) =>
  classReportCards(tx, ctx, { classGroupId: input.classGroupId, month: input.month, studentProfileId: input.studentProfileId }),
);

// ---------------------------------------------------------------------------------------------------------------
// «دفتر کلاسی — گزارش جلسه»
// ---------------------------------------------------------------------------------------------------------------

export type { OfferingSessionReport, OfferingSessionReports, SessionReportCell, WorkItemChoice } from "./session-report";

/** The «گزارش جلسه» card under the roll call: null unless the caller may write the report of that cell. */
export const sessionReportCellQuery = defineQuery({ schema: SessionReportCellInput, permission: "academic.session_report.write", scope: "any" }, async (tx, input, ctx) =>
  getSessionReportCell(tx, ctx, { classGroupId: input.classGroupId, date: input.date, periodNo: input.periodNo }),
);

/** «دفتر کلاسی» of the subject page — the same gate as the page; the private note only for a writer. */
export const offeringSessionReportsQuery = defineQuery({ schema: OfferingIdInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) =>
  listOfferingSessionReports(tx, ctx, input.offeringId),
);

/** «کارنامهٴ من» — null when the person is not a primary student. */
export const myReportCardQuery = defineQuery({ schema: MyReportCardInput, permission: "academic.objective_rating.read", scope: "any" }, async (tx, input, ctx) => myReportCard(tx, ctx, { month: input.month }));
