import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgSchema, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { person, staffProfile, studentProfile } from "./iam";
import { academicYear, classGroup, classOffering, gradeLevel, orgFk, school } from "./tenancy";

export const academic = pgSchema("academic");

/**
 * One row per student per academic year: "is enrolled at school S in year Y at grade G". It is also the student's
 * scope ANCHOR for school-scoped admins (docs/admin.md): `createStudent` with a school but no class writes a
 * `registered` row for the school's current year with `grade_level_id` NULL (nullable since migration 0012);
 * `enrollStudent` fills the grade and flips it to `active` when the first class is chosen.
 */
export const schoolEnrollment = academic.table(
  "school_enrollment",
  {
    id: id(),
    organizationId: orgFk(),
    studentProfileId: uuid("student_profile_id").notNull(),
    schoolId: uuid("school_id").notNull(),
    academicYearId: uuid("academic_year_id").notNull(),
    gradeLevelId: uuid("grade_level_id"),
    status: text("status").notNull().default("active"),
    startsOn: date("starts_on").notNull().default(sql`current_date`),
    endsOn: date("ends_on"),
    exitReason: text("exit_reason"),
    ...timestamps(),
  },
  (t) => [
    unique("school_enrollment_student_year_uq").on(t.organizationId, t.studentProfileId, t.academicYearId),
    unique("school_enrollment_org_id_uq").on(t.organizationId, t.id),
    index("school_enrollment_org_school_year_idx").on(t.organizationId, t.schoolId, t.academicYearId),
    check(
      "school_enrollment_status_chk",
      sql`${t.status} IN ('registered', 'active', 'transferred_out', 'withdrawn', 'graduated')`,
    ),
    check("school_enrollment_dates_chk", sql`${t.endsOn} IS NULL OR ${t.startsOn} <= ${t.endsOn}`),
    foreignKey({
      name: "school_enrollment_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "school_enrollment_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "school_enrollment_year_fk",
      columns: [t.organizationId, t.academicYearId],
      foreignColumns: [academicYear.organizationId, academicYear.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "school_enrollment_grade_fk",
      columns: [t.organizationId, t.gradeLevelId],
      foreignColumns: [gradeLevel.organizationId, gradeLevel.id],
    }).onDelete("restrict"),
  ],
);

/**
 * Dated membership of a student in a class_group. `student_profile_id` is denormalized from school_enrollment so
 * "who is in this class" is one indexed lookup. A student has at most ONE active enrollment per day: exclusion
 * constraint `class_enrollment_active_excl` (btree_gist, custom migration 0011 — Drizzle cannot express EXCLUDE):
 *   EXCLUDE USING gist (student_profile_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&) WHERE (status = 'active')
 */
export const classEnrollment = academic.table(
  "class_enrollment",
  {
    id: id(),
    organizationId: orgFk(),
    schoolEnrollmentId: uuid("school_enrollment_id").notNull(),
    classGroupId: uuid("class_group_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    status: text("status").notNull().default("active"),
    startsOn: date("starts_on").notNull().default(sql`current_date`),
    endsOn: date("ends_on"),
    changeReason: text("change_reason"),
    previousEnrollmentId: uuid("previous_enrollment_id"),
    changedByPersonId: uuid("changed_by_person_id"),
    ...timestamps(),
  },
  (t) => [
    unique("class_enrollment_org_id_uq").on(t.organizationId, t.id),
    index("class_enrollment_org_class_active_idx").on(t.organizationId, t.classGroupId).where(sql`${t.status} = 'active'`),
    index("class_enrollment_org_student_idx").on(t.organizationId, t.studentProfileId),
    index("class_enrollment_org_school_enrollment_idx").on(t.organizationId, t.schoolEnrollmentId),
    check("class_enrollment_status_chk", sql`${t.status} IN ('active', 'ended', 'transferred')`),
    check("class_enrollment_change_reason_chk", sql`${t.changeReason} IN ('transfer', 'level_change', 'admin')`),
    check("class_enrollment_dates_chk", sql`${t.endsOn} IS NULL OR ${t.startsOn} <= ${t.endsOn}`),
    foreignKey({
      name: "class_enrollment_school_enrollment_fk",
      columns: [t.organizationId, t.schoolEnrollmentId],
      foreignColumns: [schoolEnrollment.organizationId, schoolEnrollment.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_enrollment_class_group_fk",
      columns: [t.organizationId, t.classGroupId],
      foreignColumns: [classGroup.organizationId, classGroup.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_enrollment_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_enrollment_previous_fk",
      columns: [t.organizationId, t.previousEnrollmentId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_enrollment_changed_by_fk",
      columns: [t.organizationId, t.changedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * Teacher ↔ class_offering. The academic service derives ONE iam.role_assignment (role `teacher`, scope
 * `class_offering`, source_type `teacher_assignment`, source_id = this id) per row and revokes it when `valid_to`
 * is set — authorization never reads this table directly.
 */
export const teacherAssignment = academic.table(
  "teacher_assignment",
  {
    id: id(),
    organizationId: orgFk(),
    staffProfileId: uuid("staff_profile_id").notNull(),
    classOfferingId: uuid("class_offering_id").notNull(),
    role: text("role").notNull().default("main"),
    validFrom: date("valid_from").notNull().default(sql`current_date`),
    validTo: date("valid_to"),
    ...timestamps(),
  },
  (t) => [
    unique("teacher_assignment_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("teacher_assignment_active_uq")
      .on(t.classOfferingId, t.staffProfileId, t.role)
      .where(sql`${t.validTo} IS NULL`),
    index("teacher_assignment_org_staff_idx").on(t.organizationId, t.staffProfileId),
    index("teacher_assignment_org_offering_idx").on(t.organizationId, t.classOfferingId),
    check("teacher_assignment_role_chk", sql`${t.role} IN ('main', 'assistant', 'substitute')`),
    check("teacher_assignment_valid_range_chk", sql`${t.validTo} IS NULL OR ${t.validFrom} <= ${t.validTo}`),
    foreignKey({
      name: "teacher_assignment_staff_fk",
      columns: [t.organizationId, t.staffProfileId],
      foreignColumns: [staffProfile.organizationId, staffProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "teacher_assignment_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
  ],
);

/**
 * The weekly timetable («برنامهٴ هفتگی») of a class group: one row per occupied cell `(weekday, period_no)` pointing
 * at the offering taught then. `weekday` 0 = شنبه … 5 = پنجشنبه (6 = جمعه allowed by the CHECK, never offered by
 * the UI); `period_no` refers to the school's bell schedule (`tenancy.school_period`) by number — not by id, so a
 * re-defined زنگ‌بندی keeps the grid. Pure configuration: clearing a cell DELETES the row (the one table in the
 * product without soft delete — docs/decisions.md «برنامهٴ کلاسی»); every change is audited on the class group.
 */
export const timetableSlot = academic.table(
  "timetable_slot",
  {
    id: id(),
    organizationId: orgFk(),
    classGroupId: uuid("class_group_id").notNull(),
    weekday: smallint("weekday").notNull(),
    periodNo: smallint("period_no").notNull(),
    classOfferingId: uuid("class_offering_id").notNull(),
    room: text("room"),
    ...timestamps(),
  },
  (t) => [
    unique("timetable_slot_cell_uq").on(t.organizationId, t.classGroupId, t.weekday, t.periodNo),
    unique("timetable_slot_org_id_uq").on(t.organizationId, t.id),
    index("timetable_slot_org_offering_idx").on(t.organizationId, t.classOfferingId),
    check("timetable_slot_weekday_chk", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("timetable_slot_period_chk", sql`${t.periodNo} BETWEEN 1 AND 12`),
    check("timetable_slot_room_chk", sql`${t.room} IS NULL OR char_length(${t.room}) BETWEEN 1 AND 40`),
    foreignKey({
      name: "timetable_slot_class_group_fk",
      columns: [t.organizationId, t.classGroupId],
      foreignColumns: [classGroup.organizationId, classGroup.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "timetable_slot_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
  ],
);

/**
 * One roll call («حضور و غیاب») — a class group on a date, either at one زنگ (`period_no` = the bell number of
 * `tenancy.school_period`, the session the timetable puts there) or for the whole day (`period_no` NULL = the
 * homeroom roll call). `class_offering_id` is the درس the roll call belongs to when it was taken at a زنگ; it stays
 * NULL for a daily roll call. The natural key `(organization_id, class_group_id, date, period_no)` is
 * NULLS NOT DISTINCT, so re-taking the same roll call UPDATES the row instead of adding a second one.
 * `taken_by_person_id` / `taken_at` are the signature shown as «ثبت‌شده در …»; the trail of every change is in
 * `audit.audit_log` (`academic.attendance_session.taken`).
 */
export const attendanceSession = academic.table(
  "attendance_session",
  {
    id: id(),
    organizationId: orgFk(),
    classGroupId: uuid("class_group_id").notNull(),
    classOfferingId: uuid("class_offering_id"),
    date: date("date").notNull(),
    periodNo: smallint("period_no"),
    takenByPersonId: uuid("taken_by_person_id").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).defaultNow().notNull(),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("attendance_session_cell_uq").on(t.organizationId, t.classGroupId, t.date, t.periodNo).nullsNotDistinct(),
    unique("attendance_session_org_id_uq").on(t.organizationId, t.id),
    index("attendance_session_org_date_idx").on(t.organizationId, t.date),
    index("attendance_session_org_offering_idx").on(t.organizationId, t.classOfferingId),
    check("attendance_session_period_chk", sql`${t.periodNo} IS NULL OR ${t.periodNo} BETWEEN 1 AND 12`),
    check("attendance_session_note_chk", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 300`),
    foreignKey({
      name: "attendance_session_class_group_fk",
      columns: [t.organizationId, t.classGroupId],
      foreignColumns: [classGroup.organizationId, classGroup.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "attendance_session_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "attendance_session_taken_by_fk",
      columns: [t.organizationId, t.takenByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * One student's mark in a roll call: `present` / `absent` / `late` / `excused` (+ optional `minutes_late` and a
 * short note). One row per (session, student) — re-taking updates it in place; a student who left the class is
 * removed from the session. The `(organization_id, student_profile_id, status)` index serves «حضور و غیاب من» and
 * the per-student totals of the admin report.
 */
export const attendanceEntry = academic.table(
  "attendance_entry",
  {
    id: id(),
    organizationId: orgFk(),
    attendanceSessionId: uuid("attendance_session_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    status: text("status").notNull(),
    minutesLate: smallint("minutes_late"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("attendance_entry_session_student_uq").on(t.organizationId, t.attendanceSessionId, t.studentProfileId),
    unique("attendance_entry_org_id_uq").on(t.organizationId, t.id),
    index("attendance_entry_org_student_idx").on(t.organizationId, t.studentProfileId, t.status),
    check("attendance_entry_status_chk", sql`${t.status} IN ('present', 'absent', 'late', 'excused')`),
    check("attendance_entry_minutes_chk", sql`${t.minutesLate} IS NULL OR ${t.minutesLate} BETWEEN 0 AND 600`),
    check("attendance_entry_note_chk", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 300`),
    foreignKey({
      name: "attendance_entry_session_fk",
      columns: [t.organizationId, t.attendanceSessionId],
      foreignColumns: [attendanceSession.organizationId, attendanceSession.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "attendance_entry_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
  ],
);
