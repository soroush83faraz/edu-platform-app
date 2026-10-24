import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgSchema, smallint, text, time, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { person, staffProfile, studentProfile } from "./iam";
import { academicYear, classGroup, classOffering, gradeLevel, orgFk, school, subject } from "./tenancy";
import { workItem } from "./workspace";

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
 * at the offering taught then. `weekday` 0 = شنبه … 5 = پنج‌شنبه (6 = جمعه allowed by the CHECK, never offered by
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

/**
 * «دفتر کلاسی — گزارش جلسه» (migration 0027): the end-of-session report a دبیر writes for ONE session — the same cell a
 * roll call is taken for, `(class_group, date, period_no)`, with the درس of that زنگ in `class_offering_id` (always set:
 * a report is about a subject, and the درس is the one the weekly timetable puts at that cell — never the client's).
 * One row per session AND درس (`session_report_cell_offering_uq`, migration 0031 — security review 2026-10-20 F1/F2:
 * when the timetable moves another درس into a past cell, its teacher writes a report of their own beside the earlier
 * one, never reads or overwrites it); writing again UPDATES it, clearing it is soft (`status = 'archived'` +
 * `archived_at`; `app_rw` may not DELETE). `topic` («موضوع تدریس‌شده», required),
 * `page_ref` («صفحه/فصل»), `work_item_id` («تکلیف این جلسه»: an existing non-confidential تکلیف of the SAME درس —
 * composite FK; the service checks the درس and the caller), `next_plan` («برنامهٴ جلسهٴ بعد») are read by whoever
 * opens the subject page; `private_note` («یادداشت دبیر») is for staff who can write the report only (the service
 * never selects it for anyone else — src/lib/session-report.ts). `author_person_id` is the last writer.
 * The audit trail carries ids and text LENGTHS, never the text (`academic.session_report.created` / `.updated` /
 * `.cleared`).
 */
export const sessionReport = academic.table(
  "session_report",
  {
    id: id(),
    organizationId: orgFk(),
    classGroupId: uuid("class_group_id").notNull(),
    classOfferingId: uuid("class_offering_id").notNull(),
    date: date("date").notNull(),
    periodNo: smallint("period_no").notNull(),
    topic: text("topic").notNull(),
    pageRef: text("page_ref"),
    workItemId: uuid("work_item_id"),
    privateNote: text("private_note"),
    nextPlan: text("next_plan"),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    authorPersonId: uuid("author_person_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("session_report_cell_offering_uq").on(t.organizationId, t.classGroupId, t.date, t.periodNo, t.classOfferingId),
    unique("session_report_org_id_uq").on(t.organizationId, t.id),
    index("session_report_org_offering_date_idx").on(t.organizationId, t.classOfferingId, t.date),
    check("session_report_period_chk", sql`${t.periodNo} BETWEEN 1 AND 12`),
    check("session_report_topic_chk", sql`char_length(${t.topic}) BETWEEN 1 AND 200`),
    check("session_report_page_ref_chk", sql`${t.pageRef} IS NULL OR char_length(${t.pageRef}) BETWEEN 1 AND 100`),
    check("session_report_private_note_chk", sql`${t.privateNote} IS NULL OR char_length(${t.privateNote}) BETWEEN 1 AND 1000`),
    check("session_report_next_plan_chk", sql`${t.nextPlan} IS NULL OR char_length(${t.nextPlan}) BETWEEN 1 AND 300`),
    check("session_report_status_chk", sql`${t.status} IN ('active', 'archived')`),
    check("session_report_archived_chk", sql`(${t.status} = 'archived') = (${t.archivedAt} IS NOT NULL)`),
    foreignKey({
      name: "session_report_class_group_fk",
      columns: [t.organizationId, t.classGroupId],
      foreignColumns: [classGroup.organizationId, classGroup.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "session_report_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "session_report_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "session_report_author_fk",
      columns: [t.organizationId, t.authorPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * «کارنامهٴ توصیفی» (migration 0017): one learning objective («هدف آموزشی») of a primary پایه for one Jalali month
 * and one درس — the school's documents as data, installed per organisation by the catalog seed from
 * scripts/data/primary-objectives.json (scripts/objectives-catalog.ts, every deploy). Seed-managed: app_rw may only
 * READ it (`app.apply_grants()`, migration 0017). `subject_name` is the canonical درس name
 * (src/modules/academic/primary-objectives.ts); `subject_id` links the organisation's own `tenancy.subject` row when
 * one matches that name (nullable — a درس like «شایستگی‌های عمومی» has no subject row). The natural key is the
 * CONTENT `(grade, month, subject_name, text_hash)` (migration 0019; it was the position until then): `text_hash` is
 * generated from the wording by `app.objective_text_hash` — orthography (spacing, ZWNJ, ی/ک, diacritics, punctuation,
 * digit script) does not count, any change of words does. So a reworded objective is a NEW row and the old one is
 * archived with its ratings (past report cards still show what was rated); a line inserted or removed mid-list only
 * moves `sort_order`, a plain column. A line the documents no longer have is archived (`status`/`archived_at`), never
 * deleted.
 */
export const learningObjective = academic.table(
  "learning_objective",
  {
    id: id(),
    organizationId: orgFk(),
    gradeLevelId: uuid("grade_level_id").notNull(),
    /** Jalali month 1..12 (7 = مهر … 2 = اردیبهشت). */
    month: smallint("month").notNull(),
    subjectName: text("subject_name").notNull(),
    subjectId: uuid("subject_id"),
    /** knowledge / application / reasoning («دانشی / کاربردی / استدلالی»); NULL = the school gave no domain. */
    domain: text("domain"),
    text: text("text").notNull(),
    /**
     * `GENERATED ALWAYS AS (app.objective_text_hash(text)) STORED` — the md5 of the wording with its orthography
     * folded (migration 0019): the content half of the natural key. Never change that function in place: stored
     * values are not recomputed, so a new normalisation needs the column dropped and re-added in the same migration.
     */
    textHash: text("text_hash")
      .notNull()
      .generatedAlwaysAs(sql`app.objective_text_hash(text)`),
    /** 1-based position inside (grade, month, درس) — the documents' order; a plain column, not part of the key. */
    sortOrder: smallint("sort_order").notNull(),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("learning_objective_text_uq").on(t.organizationId, t.gradeLevelId, t.month, t.subjectName, t.textHash),
    unique("learning_objective_org_id_uq").on(t.organizationId, t.id),
    index("learning_objective_org_subject_idx").on(t.organizationId, t.subjectId),
    check("learning_objective_month_chk", sql`${t.month} BETWEEN 1 AND 12`),
    check("learning_objective_domain_chk", sql`${t.domain} IS NULL OR ${t.domain} IN ('knowledge', 'application', 'reasoning')`),
    check("learning_objective_status_chk", sql`${t.status} IN ('active', 'archived')`),
    check("learning_objective_archived_chk", sql`(${t.status} = 'archived') = (${t.archivedAt} IS NOT NULL)`),
    check("learning_objective_text_chk", sql`char_length(${t.text}) BETWEEN 1 AND 400`),
    check("learning_objective_subject_name_chk", sql`char_length(${t.subjectName}) BETWEEN 1 AND 60`),
    check("learning_objective_sort_chk", sql`${t.sortOrder} BETWEEN 1 AND 500`),
    foreignKey({
      name: "learning_objective_grade_fk",
      columns: [t.organizationId, t.gradeLevelId],
      foreignColumns: [gradeLevel.organizationId, gradeLevel.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "learning_objective_subject_fk",
      columns: [t.organizationId, t.subjectId],
      foreignColumns: [subject.organizationId, subject.id],
    }).onDelete("restrict"),
  ],
);

/**
 * One student's rating on one objective in one academic year: `very_good` / `good` / `acceptable` / `needs_effort`
 * («خیلی خوب / خوب / قابل قبول / نیاز به تلاش»). UNIQUE `(organization, year, student, objective)` — saving again
 * UPDATES the row (upsert), clearing a rating DELETES it; every save is audited
 * (`academic.objective_rating.saved`, with each change). `rated_by_person_id` / `rated_at` are the last writer.
 */
export const objectiveRating = academic.table(
  "objective_rating",
  {
    id: id(),
    organizationId: orgFk(),
    academicYearId: uuid("academic_year_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    learningObjectiveId: uuid("learning_objective_id").notNull(),
    rating: text("rating").notNull(),
    ratedByPersonId: uuid("rated_by_person_id").notNull(),
    ratedAt: timestamp("rated_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("objective_rating_student_objective_uq").on(t.organizationId, t.academicYearId, t.studentProfileId, t.learningObjectiveId),
    unique("objective_rating_org_id_uq").on(t.organizationId, t.id),
    index("objective_rating_org_objective_idx").on(t.organizationId, t.learningObjectiveId),
    index("objective_rating_org_student_idx").on(t.organizationId, t.studentProfileId),
    check("objective_rating_rating_chk", sql`${t.rating} IN ('very_good', 'good', 'acceptable', 'needs_effort')`),
    foreignKey({
      name: "objective_rating_year_fk",
      columns: [t.organizationId, t.academicYearId],
      foreignColumns: [academicYear.organizationId, academicYear.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "objective_rating_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "objective_rating_objective_fk",
      columns: [t.organizationId, t.learningObjectiveId],
      foreignColumns: [learningObjective.organizationId, learningObjective.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "objective_rating_rated_by_fk",
      columns: [t.organizationId, t.ratedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * «درخواست مرخصی / غیبت موجه» (migration 0029; docs/attendance.md «مرخصی و خروج مجاز»): a guardian's request for ONE
 * child — a date range of at most 14 days (`from_date`..`to_date`, never starting in the past) or, for a single day,
 * a partial day (`from_period`..`to_period`) — with a reason category and an optional note (≤ 300). `pending` →
 * `approved` / `rejected` by a manager of the child's school (`decided_by_person_id`, `decided_at`, an optional
 * `decision_note`), or `cancelled` by the guardian who asked while it is still pending. Only an `approved` leave
 * touches attendance: the roll call opens with the covered students pre-marked «موجه» and their guardians' «غیبت» is
 * not sent (src/modules/academic/leave-coverage.ts). `school_id` is the child's school when the request was made (the
 * scope a manager decides at). Rows are never deleted (`app_rw` has a RESTRICTIVE no-DELETE policy); the guardian
 * who requests is `requested_by_person_id`. Notes are never copied into the audit trail or a notification.
 */
export const leaveRequest = academic.table(
  "leave_request",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    requestedByPersonId: uuid("requested_by_person_id").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    fromPeriod: smallint("from_period"),
    toPeriod: smallint("to_period"),
    category: text("category").notNull(),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    decidedByPersonId: uuid("decided_by_person_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps(),
  },
  (t) => [
    unique("leave_request_org_id_uq").on(t.organizationId, t.id),
    index("leave_request_org_school_status_idx").on(t.organizationId, t.schoolId, t.status, t.fromDate),
    index("leave_request_org_student_idx").on(t.organizationId, t.studentProfileId, t.fromDate),
    check("leave_request_category_chk", sql`${t.category} IN ('illness', 'family', 'travel', 'appointment', 'other')`),
    check("leave_request_status_chk", sql`${t.status} IN ('pending', 'approved', 'rejected', 'cancelled')`),
    check("leave_request_dates_chk", sql`${t.fromDate} <= ${t.toDate} AND ${t.toDate} - ${t.fromDate} <= 13`),
    check(
      "leave_request_periods_chk",
      sql`(${t.fromPeriod} IS NULL AND ${t.toPeriod} IS NULL) OR (${t.fromPeriod} IS NOT NULL AND ${t.toPeriod} IS NOT NULL AND ${t.fromPeriod} BETWEEN 1 AND 12 AND ${t.toPeriod} BETWEEN 1 AND 12 AND ${t.fromPeriod} <= ${t.toPeriod} AND ${t.fromDate} = ${t.toDate})`,
    ),
    check("leave_request_note_chk", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 300`),
    check("leave_request_decision_note_chk", sql`${t.decisionNote} IS NULL OR (${t.status} IN ('approved', 'rejected') AND char_length(${t.decisionNote}) BETWEEN 1 AND 300)`),
    check(
      "leave_request_decision_chk",
      sql`(${t.status} IN ('approved', 'rejected')) = (${t.decidedByPersonId} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: "leave_request_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "leave_request_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "leave_request_requested_by_fk",
      columns: [t.organizationId, t.requestedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "leave_request_decided_by_fk",
      columns: [t.organizationId, t.decidedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * «خروج مجاز» (migration 0029; docs/attendance.md): a principal / vice principal records that a student leaves school
 * at `exit_time` (Tehran wall clock) on `date` (today when recorded) — reason category, an optional note (≤ 300) and
 * an optional «تحویل‌گیرنده» name (≤ 60). Every later زنگ of that day (one that starts at or after `exit_time`) opens
 * pre-marked «موجه» with the tag «خروج مجاز», and the child's guardians get one notification. One `active` exit per
 * student per day (partial unique index); a mistaken one is `cancelled` (never deleted: `app_rw` has a RESTRICTIVE
 * no-DELETE policy). `recorded_by_person_id` is the manager from the session.
 */
export const earlyExit = academic.table(
  "early_exit",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    date: date("date").notNull(),
    exitTime: time("exit_time").notNull(),
    category: text("category").notNull(),
    note: text("note"),
    pickedUpBy: text("picked_up_by"),
    status: text("status").notNull().default("active"),
    recordedByPersonId: uuid("recorded_by_person_id").notNull(),
    cancelledByPersonId: uuid("cancelled_by_person_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("early_exit_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("early_exit_student_day_active_uq").on(t.organizationId, t.studentProfileId, t.date).where(sql`${t.status} = 'active'`),
    index("early_exit_org_school_date_idx").on(t.organizationId, t.schoolId, t.date),
    index("early_exit_org_student_idx").on(t.organizationId, t.studentProfileId, t.date),
    check("early_exit_category_chk", sql`${t.category} IN ('illness', 'family', 'appointment', 'emergency', 'other')`),
    check("early_exit_status_chk", sql`${t.status} IN ('active', 'cancelled')`),
    check("early_exit_note_chk", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 300`),
    check("early_exit_picked_up_by_chk", sql`${t.pickedUpBy} IS NULL OR char_length(${t.pickedUpBy}) BETWEEN 1 AND 60`),
    check(
      "early_exit_cancel_chk",
      sql`(${t.status} = 'cancelled') = (${t.cancelledByPersonId} IS NOT NULL AND ${t.cancelledAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: "early_exit_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "early_exit_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "early_exit_recorded_by_fk",
      columns: [t.organizationId, t.recordedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "early_exit_cancelled_by_fk",
      columns: [t.organizationId, t.cancelledByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);
