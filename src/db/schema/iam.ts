import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  inet,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { branch, classGroup, classOffering, orgFk, organization, school } from "./tenancy";

export const iam = pgSchema("iam");

/** GLOBAL: one login per human, across organizations. */
export const userAccount = iam.table(
  "user_account",
  {
    id: id(),
    /** Normalized phone `+989…` OR username `^[a-z0-9]{2,12}-[a-z0-9]{1,20}$`. */
    loginIdentifier: text("login_identifier").notNull().unique("user_account_login_identifier_uq"),
    phoneE164: text("phone_e164"),
    status: text("status").notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("user_account_phone_uq").on(t.phoneE164).where(sql`${t.phoneE164} IS NOT NULL`),
    check("user_account_phone_chk", sql`${t.phoneE164} ~ '^\\+98[0-9]{10}$'`),
    check("user_account_status_chk", sql`${t.status} IN ('active', 'locked', 'disabled')`),
  ],
);

/** GLOBAL: credentials per provider (password today, sms_otp later). */
export const authIdentity = iam.table(
  "auth_identity",
  {
    id: id(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject"),
    /** argon2id PHC string. */
    secretHash: text("secret_hash"),
    /** AES-256-GCM base64 `iv:tag:ct`; nulled by cron after 72h. */
    initialPasswordEnc: text("initial_password_enc"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("auth_identity_account_provider_uq").on(t.userAccountId, t.provider),
    check("auth_identity_provider_chk", sql`${t.provider} IN ('password', 'sms_otp')`),
  ],
);

/** GLOBAL: opaque session tokens (sha256 hex stored). */
export const userSession = iam.table(
  "user_session",
  {
    id: id(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique("user_session_token_hash_uq"),
    currentOrgId: uuid("current_org_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    deviceLabel: text("device_label"),
    isPublicDevice: boolean("is_public_device").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("user_session_account_active_idx").on(t.userAccountId).where(sql`${t.revokedAt} IS NULL`)],
);

/** GLOBAL: rate limiting / lockout evidence. */
export const loginAttempt = iam.table(
  "login_attempt",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    ip: inet("ip"),
    succeeded: boolean("succeeded").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempt_identifier_at_idx").on(t.identifier, t.at), index("login_attempt_ip_at_idx").on(t.ip, t.at)],
);

export const person = iam.table(
  "person",
  {
    id: id(),
    organizationId: orgFk(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    gender: text("gender"),
    externalRef: text("external_ref"),
    /** `GENERATED ALWAYS AS (app.fa_norm(first_name || ' ' || last_name)) STORED` — trigram search key. */
    searchText: text("search_text").generatedAlwaysAs(sql`app.fa_norm(first_name || ' ' || last_name)`),
    status: text("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("person_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("person_org_external_ref_uq")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
    index("person_search_text_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    check("person_gender_chk", sql`${t.gender} IN ('female', 'male')`),
    check("person_status_chk", sql`${t.status} IN ('active', 'archived')`),
  ],
);

export const organizationMembership = iam.table(
  "organization_membership",
  {
    id: id(),
    organizationId: orgFk(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "restrict" }),
    personId: uuid("person_id").notNull().unique("organization_membership_person_uq"),
    status: text("status").notNull().default("active"),
    isDefaultOrg: boolean("is_default_org").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [
    unique("organization_membership_org_account_uq").on(t.organizationId, t.userAccountId),
    unique("organization_membership_org_id_uq").on(t.organizationId, t.id),
    // Login lists an account's memberships across organizations (account_memberships policy) — no org prefix.
    index("organization_membership_account_idx").on(t.userAccountId),
    check("organization_membership_status_chk", sql`${t.status} IN ('invited', 'active', 'suspended', 'left')`),
    foreignKey({
      name: "organization_membership_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

export const contactPoint = iam.table(
  "contact_point",
  {
    id: id(),
    organizationId: orgFk(),
    personId: uuid("person_id").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    /** e.g. 'ولی', 'منزل' */
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("contact_point_org_person_idx").on(t.organizationId, t.personId),
    check("contact_point_kind_chk", sql`${t.kind} IN ('mobile', 'landline', 'email', 'address')`),
    foreignKey({
      name: "contact_point_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

export const studentProfile = iam.table(
  "student_profile",
  {
    id: id(),
    organizationId: orgFk(),
    personId: uuid("person_id").notNull().unique("student_profile_person_uq"),
    studentNumber: text("student_number").notNull(),
    admittedOn: date("admitted_on"),
    status: text("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("student_profile_org_number_uq").on(t.organizationId, t.studentNumber),
    unique("student_profile_org_id_uq").on(t.organizationId, t.id),
    check("student_profile_status_chk", sql`${t.status} IN ('prospective', 'active', 'graduated', 'withdrawn')`),
    foreignKey({
      name: "student_profile_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

export const staffProfile = iam.table(
  "staff_profile",
  {
    id: id(),
    organizationId: orgFk(),
    personId: uuid("person_id").notNull().unique("staff_profile_person_uq"),
    employeeNumber: text("employee_number"),
    employmentType: text("employment_type").default("full_time"),
    hiredOn: date("hired_on"),
    leftOn: date("left_on"),
    ...timestamps(),
  },
  (t) => [
    unique("staff_profile_org_id_uq").on(t.organizationId, t.id),
    check("staff_profile_employment_type_chk", sql`${t.employmentType} IN ('full_time', 'part_time', 'contractor')`),
    foreignKey({
      name: "staff_profile_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * organization_id NULL = system template (seeded by app_owner, readable by every tenant).
 * RLS (per-command, migration 0004): SELECT sees NULL rows or the tenant's own; INSERT/UPDATE/DELETE only the own.
 * `cloned_from_role_id` must point at a template or at a role of the same organization — enforced by the
 * constraint trigger `role_cloned_from_tenant_trg` (migration 0006), not by the plain FK.
 */
export const role = iam.table(
  "role",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organization.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    allowedScopeTypes: text("allowed_scope_types").array().notNull(),
    clonedFromRoleId: uuid("cloned_from_role_id"),
    ...timestamps(),
  },
  (t) => [
    unique("role_org_code_uq").on(t.organizationId, t.code).nullsNotDistinct(),
    foreignKey({ name: "role_cloned_from_fk", columns: [t.clonedFromRoleId], foreignColumns: [t.id] }).onDelete("restrict"),
  ],
);

/** GLOBAL catalog, seed-managed: `module.resource.action`. app_rw: SELECT only. */
export const permission = iam.table("permission", {
  code: text("code").primaryKey(),
  module: text("module").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  minScopeType: text("min_scope_type"),
});

/** No organization_id (follows role); app_rw: SELECT only. */
export const rolePermission = iam.table(
  "role_permission",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "restrict" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permission.code, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ name: "role_permission_pk", columns: [t.roleId, t.permissionCode] }),
    // "which roles grant X" (permission catalog maintenance, FK checks from permission deletes).
    index("role_permission_permission_idx").on(t.permissionCode),
  ],
);

export const roleAssignment = iam.table(
  "role_assignment",
  {
    id: id(),
    organizationId: orgFk(),
    personId: uuid("person_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "restrict" }),
    scopeType: text("scope_type").notNull(),
    schoolId: uuid("school_id"),
    branchId: uuid("branch_id"),
    classGroupId: uuid("class_group_id"),
    classOfferingId: uuid("class_offering_id"),
    studentProfileId: uuid("student_profile_id"),
    /** No FK yet — the family table is phase 2. */
    familyId: uuid("family_id"),
    /** `GENERATED ALWAYS AS (coalesce(<scope columns>, organization_id)) STORED`. */
    scopeId: uuid("scope_id").generatedAlwaysAs(
      sql`coalesce(school_id, branch_id, class_group_id, class_offering_id, student_profile_id, family_id, organization_id)`,
    ),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    grantedByPersonId: uuid("granted_by_person_id"),
    validFrom: date("valid_from").default(sql`current_date`),
    validTo: date("valid_to"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("role_assignment_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("role_assignment_active_uq")
      .on(t.personId, t.roleId, t.scopeType, t.scopeId)
      .where(sql`${t.revokedAt} IS NULL`),
    index("role_assignment_org_person_scope_idx").on(t.organizationId, t.personId, t.scopeType),
    // FK-side lookups: "who holds role X" and the RESTRICT check when a role is deleted.
    index("role_assignment_role_idx").on(t.roleId),
    // Scope lookups ("everyone assigned at school S"); partial because most rows leave these NULL.
    index("role_assignment_org_school_idx").on(t.organizationId, t.schoolId).where(sql`${t.schoolId} IS NOT NULL`),
    index("role_assignment_org_branch_idx").on(t.organizationId, t.branchId).where(sql`${t.branchId} IS NOT NULL`),
    index("role_assignment_org_class_group_idx").on(t.organizationId, t.classGroupId).where(sql`${t.classGroupId} IS NOT NULL`),
    index("role_assignment_org_class_offering_idx").on(t.organizationId, t.classOfferingId).where(sql`${t.classOfferingId} IS NOT NULL`),
    index("role_assignment_org_student_profile_idx").on(t.organizationId, t.studentProfileId).where(sql`${t.studentProfileId} IS NOT NULL`),
    check(
      "role_assignment_scope_type_chk",
      sql`${t.scopeType} IN ('organization', 'school', 'branch', 'class_group', 'class_offering', 'student', 'family')`,
    ),
    check(
      "role_assignment_source_type_chk",
      sql`${t.sourceType} IN ('manual', 'guardian_relationship', 'teacher_assignment', 'counselor_assignment', 'enrollment')`,
    ),
    // Exclusive arc: exactly the scope column named by scope_type is set (none for 'organization').
    check(
      "role_assignment_scope_arc_chk",
      sql`(scope_type = 'organization' AND num_nonnulls(school_id, branch_id, class_group_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'school' AND school_id IS NOT NULL AND num_nonnulls(branch_id, class_group_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'branch' AND branch_id IS NOT NULL AND num_nonnulls(school_id, class_group_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'class_group' AND class_group_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'class_offering' AND class_offering_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_group_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'student' AND student_profile_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_group_id, class_offering_id, family_id) = 0)
       OR (scope_type = 'family' AND family_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_group_id, class_offering_id, student_profile_id) = 0)`,
    ),
    foreignKey({
      name: "role_assignment_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "role_assignment_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "role_assignment_branch_fk",
      columns: [t.organizationId, t.branchId],
      foreignColumns: [branch.organizationId, branch.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "role_assignment_class_group_fk",
      columns: [t.organizationId, t.classGroupId],
      foreignColumns: [classGroup.organizationId, classGroup.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "role_assignment_class_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "role_assignment_student_profile_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
  ],
);
