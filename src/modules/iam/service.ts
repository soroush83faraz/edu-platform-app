// iam/service — people and accounts as ONE transaction each: createStudent / createStaff (person + profile +
// optional login account + membership + roles/enrollment), resetInitialPassword, unlockAccount, role assignment,
// and the admin scope rule (`getAdminScope`). Every function is `(tx, ctx, input)` inside the caller's tenant
// transaction. The global tables (user_account, auth_identity) have no RLS and are written in the same tx.
//
// Plaintext initial passwords exist only in the RETURN VALUE of createStudent/createStaff/resetInitialPassword
// (and, AES-GCM encrypted, in auth_identity.initial_password_enc for the credentials sheet). They are never
// logged and never written to the audit trail.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { conflict, forbidden, invalidReference, notFound, validation } from "@/lib/errors";
import { encryptInitialPassword } from "@/lib/crypto";
import { normalizeFa, normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";
import { enrollStudent } from "@/modules/academic/service";
import { findClassGroup, findSchoolById } from "@/modules/tenancy/repo";
import type { Assignment } from "./can";
import { generateInitialPassword, hashPassword } from "./password";
import { findAccountByIdentifier } from "./repo";
import { authIdentity, contactPoint, organizationMembership, person, role, roleAssignment, staffProfile, studentProfile, userAccount, userSession } from "./schema";

/** What the service needs from the request context. `assignments` (when present) drives the admin scope rule. */
export type IamCtx = AuditCtx & { orgId: string; personId: string; assignments?: readonly Assignment[] };

const fieldError = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

export const STUDENT_NUMBER_RE = /^[0-9A-Za-z-]{1,20}$/;
/** Lower-cased username: `<school code>-<student number>` by default; never phone-like (login treats digits as a phone). */
const USERNAME_RE = /^[a-z][a-z0-9_-]{1,40}$/;

export const MESSAGES = {
  phoneTaken: "این شماره قبلاً ثبت شده است.",
  usernameTaken: "این نام‌کاربری قبلاً ثبت شده است.",
  phoneInvalid: "شمارهٴ موبایل نامعتبر است.",
  usernameInvalid: "نام‌کاربری باید با حرف انگلیسی شروع شود و فقط حرف، رقم، خط تیره یا زیرخط داشته باشد.",
  studentNumberInvalid: "شمارهٴ دانش‌آموزی فقط می‌تواند رقم، حرف انگلیسی و خط تیره باشد (حداکثر ۲۰ نویسه).",
  studentNumberTaken: "این شمارهٴ دانش‌آموزی قبلاً ثبت شده است.",
  externalRefTaken: "این کد یکتا قبلاً برای فرد دیگری ثبت شده است.",
  nameRequired: "نام و نام خانوادگی را وارد کنید.",
  schoolRequired: "برای ساخت نام‌کاربری، مدرسهٴ دانش‌آموز مشخص نیست.",
  changed: "— تغییر داده شده",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// admin scope
// ---------------------------------------------------------------------------------------------------------------

export type AdminScope = { kind: "organization" } | { kind: "school"; schoolIds: string[] };

/**
 * Phase-1 scope rule: an organization-scoped assignment carrying `iam.admin.access` → the whole organization;
 * otherwise the schools of the caller's school/branch-scoped admin assignments. No admin assignment → FORBIDDEN.
 * Every admin list filters by it; every admin mutation on a school-owned entity checks `assertSchoolInScope`.
 */
export async function getAdminScope(tx: Tx, ctx: { orgId: string; assignments: readonly Assignment[] }): Promise<AdminScope> {
  const admin = ctx.assignments.filter((a) => a.permissions.includes("iam.admin.access"));
  if (admin.some((a) => a.scopeType === "organization")) return { kind: "organization" };
  const schoolIds = new Set<string>();
  for (const a of admin) {
    if (a.scopeId === null) continue;
    if (a.scopeType === "school") schoolIds.add(a.scopeId);
    if (a.scopeType === "branch") {
      const rows = await tx.execute<{ school_id: string }>(sql`select school_id from tenancy.branch where id = ${a.scopeId}`);
      for (const r of rows.rows) schoolIds.add(r.school_id);
    }
  }
  if (schoolIds.size === 0) throw forbidden();
  return { kind: "school", schoolIds: [...schoolIds] };
}

/** NOT_FOUND (never FORBIDDEN) for a school outside the caller's scope — the row must look nonexistent. */
export function assertSchoolInScope(scope: AdminScope, schoolId: string | null | undefined): void {
  if (!schoolId) throw notFound();
  if (scope.kind === "organization") return;
  if (!scope.schoolIds.includes(schoolId)) throw notFound();
}

export function isInScope(scope: AdminScope, schoolId: string | null | undefined): boolean {
  if (!schoolId) return false;
  return scope.kind === "organization" || scope.schoolIds.includes(schoolId);
}

// ---------------------------------------------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------------------------------------------

export interface ResolvedIdentifier {
  loginIdentifier: string;
  phoneE164: string | null;
}

/** Phone-looking input → E.164 (or a phone error); otherwise a lower-cased username. */
export function resolveIdentifier(raw: string, field = "identifier"): ResolvedIdentifier {
  const ascii = toAsciiDigits(raw.trim());
  if (/^[+\d][\d\s\-().]*$/.test(ascii)) {
    const phone = normalizePhoneIR(ascii);
    if (!phone) throw fieldError(field, MESSAGES.phoneInvalid);
    return { loginIdentifier: phone, phoneE164: phone };
  }
  const username = ascii.toLowerCase();
  if (!USERNAME_RE.test(username)) throw fieldError(field, MESSAGES.usernameInvalid);
  return { loginIdentifier: username, phoneE164: null };
}

export interface CreateAccountInput {
  personId: string;
  identifier: ResolvedIdentifier;
  /** Form field that carries a duplicate-identifier error (default `identifier`). */
  field?: string;
}

export interface CreateAccountResult {
  userAccountId: string;
  loginIdentifier: string;
  /** Plaintext, returned ONCE. */
  initialPassword: string;
}

/**
 * user_account + password identity (random initial password, must_change_password) + organization_membership.
 * A login identifier that already exists anywhere → CONFLICT with one message whether it belongs to this
 * organization or another (no enumeration of other tenants).
 */
export async function createAccountForPerson(tx: Tx, ctx: IamCtx, input: CreateAccountInput): Promise<CreateAccountResult> {
  const { loginIdentifier, phoneE164 } = input.identifier;
  const field = input.field ?? "identifier";
  if (await findAccountByIdentifier(tx, loginIdentifier)) throw conflict(phoneE164 ? MESSAGES.phoneTaken : MESSAGES.usernameTaken);
  if (phoneE164) {
    const byPhone = await tx.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.phoneE164, phoneE164)).limit(1);
    if (byPhone[0]) throw conflict(MESSAGES.phoneTaken);
  }
  const existingMembership = await tx.select({ id: organizationMembership.id }).from(organizationMembership).where(eq(organizationMembership.personId, input.personId)).limit(1);
  if (existingMembership[0]) throw fieldError(field, "این فرد قبلاً حساب کاربری دارد.");

  const initialPassword = generateInitialPassword();
  const secretHash = await hashPassword(initialPassword);
  const [acct] = await tx
    .insert(userAccount)
    .values({ loginIdentifier, phoneE164, status: "active", mustChangePassword: true })
    .returning({ id: userAccount.id });
  await tx.insert(authIdentity).values({ userAccountId: acct.id, provider: "password", secretHash, initialPasswordEnc: encryptInitialPassword(initialPassword) });
  await tx.insert(organizationMembership).values({ organizationId: ctx.orgId, userAccountId: acct.id, personId: input.personId, status: "active", isDefaultOrg: true });
  await audit(ctx, "iam.user_account.created", { schema: "iam", table: "user_account", id: acct.id }, null, { personId: input.personId, loginIdentifier, hasPhone: phoneE164 !== null }, tx);
  return { userAccountId: acct.id, loginIdentifier, initialPassword };
}

/** The account of a person in THIS organization (through its membership, under RLS), or null. */
export async function findAccountOfPerson(tx: Tx, personId: string): Promise<{ userAccountId: string; loginIdentifier: string; status: string; mustChangePassword: boolean; lockedUntil: Date | null } | null> {
  const rows = await tx
    .select({
      userAccountId: userAccount.id,
      loginIdentifier: userAccount.loginIdentifier,
      status: userAccount.status,
      mustChangePassword: userAccount.mustChangePassword,
      lockedUntil: userAccount.lockedUntil,
    })
    .from(organizationMembership)
    .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .where(eq(organizationMembership.personId, personId))
    .limit(1);
  return rows[0] ?? null;
}

/** The membership row proves the account belongs to the caller's organization (RLS hides other tenants'). */
async function requireAccountInOrg(tx: Tx, userAccountId: string): Promise<{ personId: string }> {
  const rows = await tx
    .select({ personId: organizationMembership.personId })
    .from(organizationMembership)
    .where(eq(organizationMembership.userAccountId, userAccountId))
    .limit(1);
  if (!rows[0]) throw notFound();
  return rows[0];
}

export interface SetPasswordInput {
  userAccountId: string;
  password: string;
  mustChangePassword: boolean;
  /** Keep the plaintext (encrypted) for the credentials sheet; false for passwords the admin typed themselves. */
  storeInitial?: boolean;
}

/** Seed / import helper: sets a known password. Not exposed as an action. */
export async function setAccountPassword(tx: Tx, ctx: IamCtx, input: SetPasswordInput): Promise<void> {
  const secretHash = await hashPassword(input.password);
  const updated = await tx
    .update(authIdentity)
    .set({ secretHash, initialPasswordEnc: input.storeInitial ? encryptInitialPassword(input.password) : null })
    .where(and(eq(authIdentity.userAccountId, input.userAccountId), eq(authIdentity.provider, "password")))
    .returning({ id: authIdentity.id });
  if (!updated[0]) await tx.insert(authIdentity).values({ userAccountId: input.userAccountId, provider: "password", secretHash, initialPasswordEnc: input.storeInitial ? encryptInitialPassword(input.password) : null });
  await tx
    .update(userAccount)
    .set({ mustChangePassword: input.mustChangePassword, failedLoginCount: 0, lockedUntil: null, status: "active" })
    .where(eq(userAccount.id, input.userAccountId));
}

/**
 * «تعیین رمز موقت»: new random password, must_change_password, ALL sessions of the account revoked (a stolen
 * session dies with the old password), encrypted copy stored for the credentials sheet. Returns the plaintext once.
 */
export async function resetInitialPassword(tx: Tx, ctx: IamCtx, input: { userAccountId: string }): Promise<{ initialPassword: string; revokedSessions: number }> {
  const { personId } = await requireAccountInOrg(tx, input.userAccountId);
  const initialPassword = generateInitialPassword();
  const secretHash = await hashPassword(initialPassword);
  const updated = await tx
    .update(authIdentity)
    .set({ secretHash, initialPasswordEnc: encryptInitialPassword(initialPassword) })
    .where(and(eq(authIdentity.userAccountId, input.userAccountId), eq(authIdentity.provider, "password")))
    .returning({ id: authIdentity.id });
  if (!updated[0]) await tx.insert(authIdentity).values({ userAccountId: input.userAccountId, provider: "password", secretHash, initialPasswordEnc: encryptInitialPassword(initialPassword) });
  await tx.update(userAccount).set({ mustChangePassword: true, passwordChangedAt: null }).where(eq(userAccount.id, input.userAccountId));
  const revoked = await tx
    .update(userSession)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(userSession.userAccountId, input.userAccountId), isNull(userSession.revokedAt)))
    .returning({ id: userSession.id });
  await audit(ctx, "iam.account.password_reset", { schema: "iam", table: "user_account", id: input.userAccountId }, null, { personId, revokedSessions: revoked.length }, tx);
  return { initialPassword, revokedSessions: revoked.length };
}

/** «رفع قفل»: status active, failed_login_count 0, locked_until null. */
export async function unlockAccount(tx: Tx, ctx: IamCtx, input: { userAccountId: string }): Promise<void> {
  const { personId } = await requireAccountInOrg(tx, input.userAccountId);
  const [before] = await tx
    .select({ status: userAccount.status, failedLoginCount: userAccount.failedLoginCount, lockedUntil: userAccount.lockedUntil })
    .from(userAccount)
    .where(eq(userAccount.id, input.userAccountId))
    .limit(1);
  await tx.update(userAccount).set({ status: "active", failedLoginCount: 0, lockedUntil: null }).where(eq(userAccount.id, input.userAccountId));
  await audit(ctx, "iam.account.unlocked", { schema: "iam", table: "user_account", id: input.userAccountId }, before ?? null, { personId, status: "active" }, tx);
}

// ---------------------------------------------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------------------------------------------

export const ASSIGNABLE_ROLES = ["org_admin", "school_principal", "vice_principal"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export interface AssignRoleInput {
  personId: string;
  roleCode: AssignableRole | "student";
  schoolId?: string | null;
  studentProfileId?: string | null;
}

async function findSystemRole(tx: Tx, code: string): Promise<{ id: string }> {
  const rows = await tx.select({ id: role.id }).from(role).where(and(isNull(role.organizationId), eq(role.code, code))).limit(1);
  if (!rows[0]) throw invalidReference(`نقش سیستمی «${code}» یافت نشد.`);
  return rows[0];
}

/**
 * Manual role assignment (source_type 'manual', granted_by = ctx.personId). `org_admin` is organization-scoped;
 * `school_principal` / `vice_principal` need a school. A school-scoped admin (ctx.assignments) may only grant
 * school-scoped roles inside their own schools — organization-level roles are FORBIDDEN for them.
 */
export async function assignRole(tx: Tx, ctx: IamCtx, input: AssignRoleInput): Promise<{ roleAssignmentId: string; created: boolean }> {
  const tpl = await findSystemRole(tx, input.roleCode);
  let scope: { scopeType: "organization" | "school" | "student"; schoolId?: string; studentProfileId?: string };
  let scopeId: string;
  if (input.roleCode === "org_admin") {
    scope = { scopeType: "organization" };
    scopeId = ctx.orgId;
  } else if (input.roleCode === "student") {
    if (!input.studentProfileId) throw invalidReference("پروفایل دانش‌آموز مشخص نیست.");
    scope = { scopeType: "student", studentProfileId: input.studentProfileId };
    scopeId = input.studentProfileId;
  } else {
    if (!input.schoolId) throw fieldError("schoolId", "برای این نقش، مدرسه را انتخاب کنید.");
    if (!(await findSchoolById(tx, input.schoolId))) throw notFound();
    scope = { scopeType: "school", schoolId: input.schoolId };
    scopeId = input.schoolId;
  }
  if (ctx.assignments && scope.scopeType !== "student") {
    const adminScope = await getAdminScope(tx, { orgId: ctx.orgId, assignments: ctx.assignments });
    if (adminScope.kind === "school") {
      if (scope.scopeType === "organization") throw forbidden("فقط مدیر سازمان می‌تواند نقش سطح سازمان بدهد.");
      assertSchoolInScope(adminScope, scope.schoolId);
    }
  }
  const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, input.personId)).limit(1);
  if (!p) throw notFound();
  const existing = await tx
    .select({ id: roleAssignment.id })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.personId, input.personId), eq(roleAssignment.roleId, tpl.id), eq(roleAssignment.scopeType, scope.scopeType), eq(roleAssignment.scopeId, scopeId), isNull(roleAssignment.revokedAt)))
    .limit(1);
  if (existing[0]) return { roleAssignmentId: existing[0].id, created: false };
  const [row] = await tx
    .insert(roleAssignment)
    .values({ organizationId: ctx.orgId, personId: input.personId, roleId: tpl.id, ...scope, sourceType: "manual", grantedByPersonId: ctx.personId })
    .returning({ id: roleAssignment.id });
  await audit(ctx, "iam.role_assignment.created", { schema: "iam", table: "role_assignment", id: row.id }, null, { personId: input.personId, roleCode: input.roleCode, ...scope }, tx);
  return { roleAssignmentId: row.id, created: true };
}

/** Revokes a MANUAL assignment (derived teacher roles end with their teacher_assignment). */
export async function revokeRoleAssignment(tx: Tx, ctx: IamCtx, input: { roleAssignmentId: string }): Promise<void> {
  const [ra] = await tx
    .select({ id: roleAssignment.id, personId: roleAssignment.personId, roleId: roleAssignment.roleId, scopeType: roleAssignment.scopeType, schoolId: roleAssignment.schoolId, sourceType: roleAssignment.sourceType })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.id, input.roleAssignmentId), isNull(roleAssignment.revokedAt)))
    .limit(1);
  if (!ra) throw notFound();
  if (ra.sourceType !== "manual") throw validation(undefined, "این نقش از تخصیص درس مشتق شده و از این‌جا لغو نمی‌شود.");
  if (ctx.assignments) {
    const adminScope = await getAdminScope(tx, { orgId: ctx.orgId, assignments: ctx.assignments });
    if (adminScope.kind === "school") {
      if (ra.scopeType === "organization") throw forbidden("فقط مدیر سازمان می‌تواند نقش سطح سازمان را لغو کند.");
      if (ra.scopeType === "school") assertSchoolInScope(adminScope, ra.schoolId);
    }
  }
  if (ra.personId === ctx.personId && ra.scopeType === "organization") throw validation(undefined, "نمی‌توانید نقش سازمانی خودتان را لغو کنید.");
  await tx.update(roleAssignment).set({ revokedAt: sql`now()` }).where(eq(roleAssignment.id, ra.id));
  await audit(ctx, "iam.role_assignment.revoked", { schema: "iam", table: "role_assignment", id: ra.id }, ra, { revokedAt: "now" }, tx);
}

// ---------------------------------------------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------------------------------------------

export interface PersonNameInput {
  firstName: string;
  lastName: string;
  gender?: "female" | "male" | null;
}

function cleanNames(input: PersonNameInput): { firstName: string; lastName: string } {
  const firstName = normalizeFa(input.firstName);
  const lastName = normalizeFa(input.lastName);
  if (!firstName || !lastName) throw fieldError(firstName ? "lastName" : "firstName", MESSAGES.nameRequired);
  return { firstName, lastName };
}

function cleanPhone(raw: string | null | undefined, field: string): string | null {
  if (raw == null || raw.trim() === "") return null;
  const phone = normalizePhoneIR(raw);
  if (!phone) throw fieldError(field, MESSAGES.phoneInvalid);
  return phone;
}

export interface CreateStudentInput extends PersonNameInput {
  id?: string;
  studentNumber: string;
  externalRef?: string | null;
  contactPhone?: string | null;
  guardianPhone?: string | null;
  /** The student's school (username prefix + scope). Defaults to the school of `enrollment.classGroupId`. */
  schoolId?: string;
  login?: { createAccount: boolean; identifier?: string | null };
  enrollment?: { classGroupId: string } | null;
  /** Assign the system `student` role (default true). */
  assignStudentRole?: boolean;
}

export interface CreateStudentResult {
  personId: string;
  studentProfileId: string;
  userAccountId: string | null;
  loginIdentifier: string | null;
  /** Plaintext, returned ONCE; null when no account was created. */
  initialPassword: string | null;
  classEnrollmentId: string | null;
}

/**
 * person (+ contact points) + student_profile + optional user_account/membership (login = normalized phone, else
 * `<school code>-<student number>`) + `student` role + optional enrollment (school + class) — one transaction.
 */
export async function createStudent(tx: Tx, ctx: IamCtx, input: CreateStudentInput): Promise<CreateStudentResult> {
  const names = cleanNames(input);
  const studentNumber = toAsciiDigits(input.studentNumber.trim());
  if (!STUDENT_NUMBER_RE.test(studentNumber)) throw fieldError("studentNumber", MESSAGES.studentNumberInvalid);
  const dup = await tx.select({ id: studentProfile.id }).from(studentProfile).where(eq(studentProfile.studentNumber, studentNumber)).limit(1);
  if (dup[0]) throw fieldError("studentNumber", MESSAGES.studentNumberTaken);
  const externalRef = input.externalRef?.trim() ? toAsciiDigits(input.externalRef.trim()) : null;
  if (externalRef) {
    const dupRef = await tx.select({ id: person.id }).from(person).where(eq(person.externalRef, externalRef)).limit(1);
    if (dupRef[0]) throw fieldError("externalRef", MESSAGES.externalRefTaken);
  }
  const contactPhone = cleanPhone(input.contactPhone, "contactPhone");
  const guardianPhone = cleanPhone(input.guardianPhone, "guardianPhone");

  let schoolId = input.schoolId ?? null;
  let classGroupId: string | null = null;
  if (input.enrollment?.classGroupId) {
    const cg = await findClassGroup(tx, input.enrollment.classGroupId);
    if (!cg || cg.status !== "active") throw invalidReference("کلاس یافت نشد.");
    if (schoolId && schoolId !== cg.schoolId) throw fieldError("classGroupId", "کلاس به مدرسهٴ انتخاب‌شده تعلق ندارد.");
    schoolId = cg.schoolId;
    classGroupId = cg.id;
  }

  const [p] = await tx
    .insert(person)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, ...names, gender: input.gender ?? null, externalRef, status: "active" })
    .returning({ id: person.id });
  const [sp] = await tx
    .insert(studentProfile)
    .values({ organizationId: ctx.orgId, personId: p.id, studentNumber, status: "active", admittedOn: sql`current_date` })
    .returning({ id: studentProfile.id });
  if (contactPhone) await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId: p.id, kind: "mobile", value: contactPhone, isPrimary: true });
  if (guardianPhone) await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId: p.id, kind: "mobile", value: guardianPhone, label: "ولی", isPrimary: !contactPhone });
  await audit(ctx, "iam.person.created", { schema: "iam", table: "person", id: p.id }, null, { ...names, kind: "student", studentNumber, studentProfileId: sp.id, schoolId, classGroupId }, tx);

  let account: CreateAccountResult | null = null;
  if (input.login?.createAccount) {
    let identifier: ResolvedIdentifier;
    if (input.login.identifier && input.login.identifier.trim() !== "") {
      identifier = resolveIdentifier(input.login.identifier, "identifier");
    } else if (contactPhone) {
      identifier = { loginIdentifier: contactPhone, phoneE164: contactPhone };
    } else {
      if (!schoolId) throw fieldError("identifier", MESSAGES.schoolRequired);
      const sch = await findSchoolById(tx, schoolId);
      if (!sch) throw notFound();
      identifier = { loginIdentifier: `${sch.code.toLowerCase()}-${studentNumber.toLowerCase()}`, phoneE164: null };
    }
    account = await createAccountForPerson(tx, ctx, { personId: p.id, identifier, field: "identifier" });
  }
  if (input.assignStudentRole ?? true) await assignRole(tx, ctx, { personId: p.id, roleCode: "student", studentProfileId: sp.id });

  let classEnrollmentId: string | null = null;
  if (classGroupId) classEnrollmentId = (await enrollStudent(tx, ctx, { studentProfileId: sp.id, classGroupId })).classEnrollmentId;

  return {
    personId: p.id,
    studentProfileId: sp.id,
    userAccountId: account?.userAccountId ?? null,
    loginIdentifier: account?.loginIdentifier ?? null,
    initialPassword: account?.initialPassword ?? null,
    classEnrollmentId,
  };
}

export interface CreateStaffInput extends PersonNameInput {
  id?: string;
  employeeNumber?: string | null;
  employmentType?: "full_time" | "part_time" | "contractor";
  /** Required: the login identifier of staff is always their phone. */
  phone: string;
  externalRef?: string | null;
  roles?: Array<{ roleCode: AssignableRole; schoolId?: string | null }>;
  /** false → person + profile only (the importer creates the account separately); default true. */
  createAccount?: boolean;
}

export interface CreateStaffResult {
  personId: string;
  staffProfileId: string;
  userAccountId: string | null;
  loginIdentifier: string;
  initialPassword: string | null;
  roleAssignmentIds: string[];
}

/**
 * person + staff_profile + user_account (phone) + membership + manual role assignments. The `teacher` role is
 * NEVER granted here — it is derived from class offerings by `assignTeacher`.
 */
export async function createStaff(tx: Tx, ctx: IamCtx, input: CreateStaffInput): Promise<CreateStaffResult> {
  const names = cleanNames(input);
  const phone = cleanPhone(input.phone, "phone");
  if (!phone) throw fieldError("phone", "شمارهٴ موبایل کارکنان الزامی است.");
  if (input.createAccount ?? true) {
    if (await findAccountByIdentifier(tx, phone)) throw conflict(MESSAGES.phoneTaken);
  }
  const externalRef = input.externalRef?.trim() ? toAsciiDigits(input.externalRef.trim()) : null;
  if (externalRef) {
    const dupRef = await tx.select({ id: person.id }).from(person).where(eq(person.externalRef, externalRef)).limit(1);
    if (dupRef[0]) throw fieldError("externalRef", MESSAGES.externalRefTaken);
  }
  const [p] = await tx
    .insert(person)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, ...names, gender: input.gender ?? null, externalRef, status: "active" })
    .returning({ id: person.id });
  const [st] = await tx
    .insert(staffProfile)
    .values({
      organizationId: ctx.orgId,
      personId: p.id,
      employeeNumber: input.employeeNumber?.trim() ? toAsciiDigits(input.employeeNumber.trim()) : null,
      employmentType: input.employmentType ?? "full_time",
      hiredOn: sql`current_date`,
    })
    .returning({ id: staffProfile.id });
  await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId: p.id, kind: "mobile", value: phone, isPrimary: true });
  await audit(ctx, "iam.person.created", { schema: "iam", table: "person", id: p.id }, null, { ...names, kind: "staff", staffProfileId: st.id }, tx);

  let account: CreateAccountResult | null = null;
  if (input.createAccount ?? true) {
    account = await createAccountForPerson(tx, ctx, { personId: p.id, identifier: { loginIdentifier: phone, phoneE164: phone }, field: "phone" });
  }
  const roleAssignmentIds: string[] = [];
  for (const r of input.roles ?? []) roleAssignmentIds.push((await assignRole(tx, ctx, { personId: p.id, roleCode: r.roleCode, schoolId: r.schoolId ?? null })).roleAssignmentId);
  return { personId: p.id, staffProfileId: st.id, userAccountId: account?.userAccountId ?? null, loginIdentifier: phone, initialPassword: account?.initialPassword ?? null, roleAssignmentIds };
}

export interface UpdatePersonInput {
  firstName?: string;
  lastName?: string;
  gender?: "female" | "male" | null;
  externalRef?: string | null;
  status?: "active" | "archived";
  /** student_profile.student_number (students only). */
  studentNumber?: string;
  /** staff_profile fields (staff only). */
  employeeNumber?: string | null;
  employmentType?: "full_time" | "part_time" | "contractor";
}

export async function updatePerson(tx: Tx, ctx: IamCtx, personId: string, input: UpdatePersonInput): Promise<void> {
  const [before] = await tx
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, gender: person.gender, externalRef: person.externalRef, status: person.status })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  if (!before) throw notFound();
  const names = input.firstName !== undefined || input.lastName !== undefined ? cleanNames({ firstName: input.firstName ?? before.firstName, lastName: input.lastName ?? before.lastName }) : null;
  const externalRef = input.externalRef === undefined ? undefined : input.externalRef?.trim() ? toAsciiDigits(input.externalRef.trim()) : null;
  if (externalRef) {
    const dupRef = await tx.select({ id: person.id }).from(person).where(eq(person.externalRef, externalRef)).limit(1);
    if (dupRef[0] && dupRef[0].id !== personId) throw fieldError("externalRef", MESSAGES.externalRefTaken);
  }
  await tx
    .update(person)
    .set({
      ...(names ?? {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(externalRef !== undefined ? { externalRef } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .where(eq(person.id, personId));
  if (input.studentNumber !== undefined) {
    const studentNumber = toAsciiDigits(input.studentNumber.trim());
    if (!STUDENT_NUMBER_RE.test(studentNumber)) throw fieldError("studentNumber", MESSAGES.studentNumberInvalid);
    const dup = await tx.select({ id: studentProfile.id, personId: studentProfile.personId }).from(studentProfile).where(eq(studentProfile.studentNumber, studentNumber)).limit(1);
    if (dup[0] && dup[0].personId !== personId) throw fieldError("studentNumber", MESSAGES.studentNumberTaken);
    await tx.update(studentProfile).set({ studentNumber }).where(eq(studentProfile.personId, personId));
  }
  if (input.employeeNumber !== undefined || input.employmentType !== undefined) {
    await tx
      .update(staffProfile)
      .set({
        ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber?.trim() ? toAsciiDigits(input.employeeNumber.trim()) : null } : {}),
        ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
      })
      .where(eq(staffProfile.personId, personId));
  }
  await audit(ctx, "iam.person.updated", { schema: "iam", table: "person", id: personId }, before, input, tx);
}

/** Replaces the guardian / own mobile contact points of a person (label 'ولی' = guardian). */
export async function setPersonPhones(tx: Tx, ctx: IamCtx, personId: string, input: { contactPhone?: string | null; guardianPhone?: string | null }): Promise<void> {
  const contactPhone = input.contactPhone === undefined ? undefined : cleanPhone(input.contactPhone, "contactPhone");
  const guardianPhone = input.guardianPhone === undefined ? undefined : cleanPhone(input.guardianPhone, "guardianPhone");
  if (contactPhone !== undefined) {
    await tx.delete(contactPoint).where(and(eq(contactPoint.personId, personId), eq(contactPoint.kind, "mobile"), isNull(contactPoint.label)));
    if (contactPhone) await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId, kind: "mobile", value: contactPhone, isPrimary: true });
  }
  if (guardianPhone !== undefined) {
    await tx.delete(contactPoint).where(and(eq(contactPoint.personId, personId), eq(contactPoint.kind, "mobile"), eq(contactPoint.label, "ولی")));
    if (guardianPhone) await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId, kind: "mobile", value: guardianPhone, label: "ولی" });
  }
  await audit(ctx, "iam.person.phones_updated", { schema: "iam", table: "person", id: personId }, null, { hasContactPhone: !!contactPhone, hasGuardianPhone: !!guardianPhone }, tx);
}
