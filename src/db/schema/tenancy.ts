import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, orgId, timestamps } from "./_common";

export const tenancy = pgSchema("tenancy");

/** GLOBAL table (no organization_id, no RLS): the tenant itself. */
export const organization = tenancy.table(
  "organization",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique("organization_slug_uq"),
    status: text("status").notNull().default("active"),
    plan: text("plan").default("core"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check("organization_slug_chk", sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check("organization_status_chk", sql`${t.status} IN ('active', 'suspended', 'trial')`),
  ],
);

/** `organization_id uuid NOT NULL REFERENCES tenancy.organization(id) ON DELETE RESTRICT`. */
export const orgFk = () => orgId().references(() => organization.id, { onDelete: "restrict" });

export const school = tenancy.table(
  "school",
  {
    id: id(),
    organizationId: orgFk(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    genderPolicy: text("gender_policy").default("mixed"),
    isDefault: boolean("is_default").notNull().default(false),
    timezone: text("timezone").default("Asia/Tehran"),
    ...timestamps(),
  },
  (t) => [
    unique("school_org_code_uq").on(t.organizationId, t.code),
    unique("school_org_id_uq").on(t.organizationId, t.id),
    check("school_gender_policy_chk", sql`${t.genderPolicy} IN ('girls', 'boys', 'mixed')`),
  ],
);

export const branch = tenancy.table(
  "branch",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("branch_org_id_uq").on(t.organizationId, t.id),
    index("branch_org_school_idx").on(t.organizationId, t.schoolId),
    foreignKey({
      name: "branch_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
  ],
);

export const academicYear = tenancy.table(
  "academic_year",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id").notNull(),
    /** e.g. '۱۴۰۵-۱۴۰۶' */
    name: text("name").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("academic_year_org_id_uq").on(t.organizationId, t.id),
    index("academic_year_org_school_idx").on(t.organizationId, t.schoolId),
    uniqueIndex("academic_year_current_uq").on(t.schoolId).where(sql`${t.isCurrent}`),
    check("academic_year_dates_chk", sql`${t.startsOn} < ${t.endsOn}`),
    foreignKey({
      name: "academic_year_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
  ],
);

export const term = tenancy.table(
  "term",
  {
    id: id(),
    organizationId: orgFk(),
    academicYearId: uuid("academic_year_id").notNull(),
    name: text("name").notNull(),
    sequence: integer("sequence").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("term_year_sequence_uq").on(t.academicYearId, t.sequence),
    unique("term_org_id_uq").on(t.organizationId, t.id),
    index("term_org_year_idx").on(t.organizationId, t.academicYearId),
    foreignKey({
      name: "term_academic_year_fk",
      columns: [t.organizationId, t.academicYearId],
      foreignColumns: [academicYear.organizationId, academicYear.id],
    }).onDelete("restrict"),
  ],
);

export const educationLevel = tenancy.table(
  "education_level",
  {
    id: id(),
    organizationId: orgFk(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sequence: integer("sequence").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("education_level_org_code_uq").on(t.organizationId, t.code),
    unique("education_level_org_id_uq").on(t.organizationId, t.id),
  ],
);

export const gradeLevel = tenancy.table(
  "grade_level",
  {
    id: id(),
    organizationId: orgFk(),
    educationLevelId: uuid("education_level_id").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sequence: integer("sequence").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("grade_level_org_code_uq").on(t.organizationId, t.code),
    unique("grade_level_org_id_uq").on(t.organizationId, t.id),
    index("grade_level_org_level_idx").on(t.organizationId, t.educationLevelId),
    foreignKey({
      name: "grade_level_education_level_fk",
      columns: [t.organizationId, t.educationLevelId],
      foreignColumns: [educationLevel.organizationId, educationLevel.id],
    }).onDelete("restrict"),
  ],
);

export const subject = tenancy.table(
  "subject",
  {
    id: id(),
    organizationId: orgFk(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    parentSubjectId: uuid("parent_subject_id"),
    ...timestamps(),
  },
  (t) => [
    unique("subject_org_code_uq").on(t.organizationId, t.code),
    unique("subject_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      name: "subject_parent_fk",
      columns: [t.organizationId, t.parentSubjectId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete("restrict"),
  ],
);

export const classGroup = tenancy.table(
  "class_group",
  {
    id: id(),
    organizationId: orgFk(),
    branchId: uuid("branch_id").notNull(),
    academicYearId: uuid("academic_year_id").notNull(),
    gradeLevelId: uuid("grade_level_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    /** FK to iam.staff_profile is added in step 2 (avoids the tenancy <-> iam cycle today). */
    homeroomStaffId: uuid("homeroom_staff_id"),
    status: text("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("class_group_year_branch_name_uq").on(t.academicYearId, t.branchId, t.name),
    unique("class_group_org_id_uq").on(t.organizationId, t.id),
    index("class_group_org_branch_idx").on(t.organizationId, t.branchId),
    check("class_group_status_chk", sql`${t.status} IN ('active', 'archived')`),
    foreignKey({
      name: "class_group_branch_fk",
      columns: [t.organizationId, t.branchId],
      foreignColumns: [branch.organizationId, branch.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_group_academic_year_fk",
      columns: [t.organizationId, t.academicYearId],
      foreignColumns: [academicYear.organizationId, academicYear.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_group_grade_level_fk",
      columns: [t.organizationId, t.gradeLevelId],
      foreignColumns: [gradeLevel.organizationId, gradeLevel.id],
    }).onDelete("restrict"),
  ],
);

export const classOffering = tenancy.table(
  "class_offering",
  {
    id: id(),
    organizationId: orgFk(),
    classGroupId: uuid("class_group_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    termId: uuid("term_id").notNull(),
    weeklyHours: numeric("weekly_hours", { precision: 4, scale: 1 }),
    status: text("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("class_offering_group_subject_term_uq").on(t.classGroupId, t.subjectId, t.termId),
    unique("class_offering_org_id_uq").on(t.organizationId, t.id),
    index("class_offering_org_group_idx").on(t.organizationId, t.classGroupId),
    check("class_offering_status_chk", sql`${t.status} IN ('planned', 'active', 'closed')`),
    foreignKey({
      name: "class_offering_class_group_fk",
      columns: [t.organizationId, t.classGroupId],
      foreignColumns: [classGroup.organizationId, classGroup.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_offering_subject_fk",
      columns: [t.organizationId, t.subjectId],
      foreignColumns: [subject.organizationId, subject.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "class_offering_term_fk",
      columns: [t.organizationId, t.termId],
      foreignColumns: [term.organizationId, term.id],
    }).onDelete("restrict"),
  ],
);
