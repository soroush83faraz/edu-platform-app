// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { can } from "@/modules/iam/can";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById, listSchoolPeriods } from "@/modules/tenancy/repo";
import { attendanceGaps, classAttendanceReport, defaultRange, getSessionForTaking, studentAttendanceSummary, teacherDay } from "./attendance";
import { AttendanceCellInput, ClassAttendanceInput, ClassGroupIdInput, MyAttendanceInput, OfferingIdInput, SchoolIdInput, StudentAttendanceInput } from "./dto";
import { findStudentProfile, getMyClass, listClassesForPicker } from "./repo";
import { getClassTimetable, getMyTimetable, getOfferingPage } from "./service";

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

/** زنگ‌بندی of one school for the admin editor; `canEdit` = structure write (org admin, principal). */
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

/** «امروز ثبت نشده» for the admin page, narrowed to the caller's schools (`academic.attendance.report`). */
export const attendanceGapsQuery = defineQuery({ permission: "academic.attendance.report", scope: "any" }, async (tx, _input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  return attendanceGaps(tx, scope.kind === "organization" ? null : scope.schoolIds);
});

/** The class picker of `/admin/attendance`: the caller's active classes (the admin scope filters them). */
export const attendanceClassesQuery = defineQuery({ permission: "academic.attendance.report", scope: "any" }, async (tx, _input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  return listClassesForPicker(tx, scope.kind === "organization" ? null : scope.schoolIds);
});
