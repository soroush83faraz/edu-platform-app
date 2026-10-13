import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { person, studentProfile } from "./iam";
import { classOffering, orgFk, school } from "./tenancy";
import { workItem } from "./workspace";

/**
 * «مشاوره» (migration 0018; docs/decisions.md «مشاوره — فاز ۱»): the counseling file of a student. Its own schema so
 * the most sensitive rows of the product sit apart from the academic record. Every row carries the SCHOOL it was
 * written at (the student's school at that moment): who may read it is decided per school — a student who moves to
 * another school of the organization does not carry the old school's notes to the new school's counselor.
 *
 * Two layers decide who reads what (both fail closed):
 *   • the service (src/modules/counseling/service.ts): the reach of `counseling.*` permissions, NOT_FOUND outside it;
 *   • RLS: `tenant_isolation` (apply_rls) plus RESTRICTIVE policies for `app_rw` written by hand in 0018 — a note is
 *     readable only by a holder of `counseling.note.write` at its school, or, when its visibility allows, of
 *     `counseling.case.read` there; it is written and edited only by its author (`app.current_person_id()`).
 * The application never deletes these rows (DELETE revoked from app_rw in `app.apply_grants()`); a note or a report
 * is withdrawn with `status`/`archived_at`.
 */
export const counseling = pgSchema("counseling");

/**
 * «یادداشت مشاور» — the counselor's own note on a student. `visibility`: `counselors` = the counselors of the school
 * only; `counselors_and_principal` (default) = also the school's management (principal, vice principal, the
 * organization admin). Edited and archived by its AUTHOR only. The body is never copied into the audit trail.
 */
export const counselorNote = counseling.table(
  "counselor_note",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    authorPersonId: uuid("author_person_id").notNull(),
    kind: text("kind").notNull().default("general"),
    visibility: text("visibility").notNull().default("counselors_and_principal"),
    body: text("body").notNull(),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("counselor_note_org_id_uq").on(t.organizationId, t.id),
    index("counselor_note_org_student_idx").on(t.organizationId, t.studentProfileId, t.createdAt.desc()),
    index("counselor_note_org_author_idx").on(t.organizationId, t.authorPersonId),
    check("counselor_note_kind_chk", sql`${t.kind} IN ('general', 'academic', 'behavioral', 'family')`),
    check("counselor_note_visibility_chk", sql`${t.visibility} IN ('counselors', 'counselors_and_principal')`),
    check("counselor_note_body_chk", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
    check("counselor_note_status_chk", sql`${t.status} IN ('active', 'archived')`),
    check("counselor_note_archived_chk", sql`(${t.status} = 'archived') = (${t.archivedAt} IS NOT NULL)`),
    foreignKey({
      name: "counselor_note_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "counselor_note_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "counselor_note_author_fk",
      columns: [t.organizationId, t.authorPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * «گزارش دبیر به مشاور» — a short academic / behavioural report by a teacher who teaches the student (the service
 * checks the teaching; `class_offering_id` is the درس it came through). Read by the school's counselors and
 * management; the teacher reads back only their own.
 */
export const teacherReport = counseling.table(
  "teacher_report",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    authorPersonId: uuid("author_person_id").notNull(),
    classOfferingId: uuid("class_offering_id"),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("teacher_report_org_id_uq").on(t.organizationId, t.id),
    index("teacher_report_org_student_idx").on(t.organizationId, t.studentProfileId, t.createdAt.desc()),
    index("teacher_report_org_author_idx").on(t.organizationId, t.authorPersonId),
    check("teacher_report_kind_chk", sql`${t.kind} IN ('academic', 'behavioral')`),
    check("teacher_report_body_chk", sql`char_length(${t.body}) BETWEEN 1 AND 1000`),
    check("teacher_report_status_chk", sql`${t.status} IN ('active', 'archived')`),
    check("teacher_report_archived_chk", sql`(${t.status} = 'archived') = (${t.archivedAt} IS NOT NULL)`),
    foreignKey({
      name: "teacher_report_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "teacher_report_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "teacher_report_author_fk",
      columns: [t.organizationId, t.authorPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "teacher_report_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
  ],
);

/**
 * The link between a student and a work item the counselor opened about them: `management` = «ارجاع به مدیریت»
 * (an `admin_request` to the school's management), `teacher` = «درخواست گزارش از دبیر» (a `task` to some of the
 * student's teachers). The status, the answer and the people live on the work item; this row only says which student
 * it is about — so the file can list them and the item can lead back to the file. Immutable: no `updated_at`, and
 * app_rw may neither UPDATE nor DELETE it (`app.apply_grants()`).
 */
export const referral = counseling.table(
  "referral",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    workItemId: uuid("work_item_id").notNull(),
    kind: text("kind").notNull(),
    createdByPersonId: uuid("created_by_person_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("referral_org_id_uq").on(t.organizationId, t.id),
    unique("referral_work_item_uq").on(t.organizationId, t.workItemId),
    index("referral_org_student_idx").on(t.organizationId, t.studentProfileId, t.createdAt.desc()),
    check("referral_kind_chk", sql`${t.kind} IN ('management', 'teacher')`),
    foreignKey({
      name: "referral_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "referral_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "referral_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "referral_created_by_fk",
      columns: [t.organizationId, t.createdByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);
