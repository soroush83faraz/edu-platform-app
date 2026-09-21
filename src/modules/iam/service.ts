// iam/service — people and accounts as ONE transaction each: createStudent / createStaff (person + profile +
// optional login account + membership + roles/enrollment), resetInitialPassword, unlockAccount, role assignment,
// and the admin scope rule (`getAdminScope`). Every function is `(tx, ctx, input)` inside the caller's tenant
// transaction. The global tables (user_account, auth_identity) have no RLS and are written in the same tx.
//
// Plaintext initial passwords exist only in the RETURN VALUE of createStudent/createStaff/resetInitialPassword
// (and, AES-GCM encrypted, in auth_identity.initial_password_enc for the credentials sheet). They are never
// logged and never written to the audit trail.
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { conflict, forbidden, invalidReference, notFound, validation } from "@/lib/errors";
import { encryptInitialPassword } from "@/lib/crypto";
import { normalizeFa, normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";
import { schoolEnrollment } from "@/modules/academic/schema";
import { enrollStudent } from "@/modules/academic/service";
import { findClassGroup, findCurrentAcademicYear, findSchoolById, schoolIdOfBranch } from "@/modules/tenancy/repo";
import { can, canAtAnyScope, resolveScopeChain, type Assignment } from "./can";
import { generateInitialPassword, hashPassword } from "./password";
import { findAccountByIdentifier } from "./repo";
import { authIdentity, contactPoint, organizationMembership, person, role, roleAssignment, staffProfile, studentProfile, userAccount, userSession } from "./schema";

/**
 * What the service needs from the request context. `assignments` are REQUIRED: they drive the admin scope rule and
 * the permission checks of the role services (`can()`), so every caller path — actions, the importer running as
 * the real admin, the seed acting as the demo organization admin — is checked the same way. There is no
 * "trusted" ctx without assignments.
 */
export type IamCtx = AuditCtx & { orgId: string; personId: string; assignments: readonly Assignment[] };

const fieldError = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

export const STUDENT_NUMBER_RE = /^[0-9A-Za-z-]{1,20}$/;
/** Lower-cased username: `<school code>-<student number>` by default; never phone-like (login treats digits as a phone). */
const USERNAME_RE = /^[a-z][a-z0-9_-]{1,40}$/;
/** `login_identifier` is global while school codes are per organization: a generated username gets `-01`…`-05` on collision. */
const GENERATED_USERNAME_RETRIES = 5;

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
  studentSchoolRequired: "مدرسه یا کلاس دانش‌آموز را انتخاب کنید.",
  staffSchoolRequired: "مدرسهٴ همکار را انتخاب کنید.",
  noCurrentYear: "این مدرسه سال تحصیلی جاری ندارد؛ اول سال جاری را در بخش «سال‌ها» تعریف کنید.",
  schoolNotFound: "مدرسه یافت نشد.",
  roleNotManual: "این نقش به‌صورت دستی داده نمی‌شود.",
  roleScopeNotAllowed: "این نقش در این دامنه قابل تخصیص نیست.",
  roleSchoolRequired: "برای این نقش، مدرسه را انتخاب کنید.",
  orgRoleForbidden: "فقط مدیر سازمان می‌تواند نقش سطح سازمان بدهد.",
  orgRoleRevokeForbidden: "فقط مدیر سازمان می‌تواند نقش سطح سازمان را لغو کند.",
  principalRoleForbidden: "فقط مدیر سازمان می‌تواند نقش مدیر مدرسه بدهد.",
  principalRoleRevokeForbidden: "فقط مدیر سازمان می‌تواند نقش مدیر مدرسه را لغو کند.",
  roleGrantForbidden: "شما اجازهٴ دادن نقش مدیریتی در این مدرسه را ندارید.",
  roleRevokeForbidden: "شما اجازهٴ لغو این نقش را ندارید.",
  derivedRoleNotRevocable: "این نقش از تخصیص درس مشتق شده و از این‌جا لغو نمی‌شود.",
  studentProfileMismatch: "پروفایل دانش‌آموز به این فرد تعلق ندارد.",
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

/** `school_enrollment` statuses that anchor a student to a school (CHECK `school_enrollment_status_chk` lists the rest). */
export const LIVE_SCHOOL_ENROLLMENT_STATUSES: readonly string[] = ["registered", "active"];

/** SQL predicate «the school_enrollment row aliased `alias` still anchors the student»: live status and not ended. */
export function liveSchoolEnrollmentSql(alias: string): SQL {
  const a = columnRef(alias);
  return sql`(${a}.status = any(${sql.param([...LIVE_SCHOOL_ENROLLMENT_STATUSES], undefined)}::text[]) and (${a}.ends_on is null or ${a}.ends_on >= current_date))`;
}

/** Column references passed to the SQL predicates below are code constants, never input — still, keep them boring. */
const COLUMN_REF_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$/;

function columnRef(column: string): SQL {
  if (!COLUMN_REF_RE.test(column)) throw new Error(`invalid column reference: ${column}`);
  return sql.raw(column);
}

/**
 * SQL predicate «the person in `personColumn` is inside `scope`» — the ONE rule behind every admin people list,
 * detail page and account operation (docs/admin.md «قانون دامنه»):
 *   - organization scope → TRUE (organization admins reach everyone of the organization);
 *   - a person holding ANY unrevoked organization-scoped role assignment is outside EVERY school scope (the
 *     organization admin is managed by organization admins only);
 *   - otherwise the person needs a POSITIVE anchor in one of the caller's schools: a LIVE `school_enrollment`
 *     (students — `status IN ('registered','active')` and not ended: a student transferred out, withdrawn or
 *     graduated is no longer the old school's to manage), `staff_profile.school_id` (staff) or an unrevoked
 *     school-/branch-scoped role (managers).
 * Derived teacher roles (`class_offering` scope) never anchor: a school admin can create them himself, so they
 * must not widen his reach over a person anchored elsewhere. Unanchored persons are NOT_FOUND for school admins.
 */
export function personInScopeSql(scope: AdminScope, personColumn: string): SQL {
  if (scope.kind === "organization") return sql`true`;
  const p = columnRef(personColumn);
  const ids = sql`${sql.param(scope.schoolIds, undefined)}::uuid[]`;
  return sql`(
    not exists (select 1 from iam.role_assignment ra where ra.person_id = ${p} and ra.revoked_at is null and ra.scope_type = 'organization')
    and (
      exists (select 1 from academic.school_enrollment se join iam.student_profile sp on sp.id = se.student_profile_id
              where sp.person_id = ${p} and se.school_id = any(${ids}) and ${liveSchoolEnrollmentSql("se")})
      or exists (select 1 from iam.staff_profile st where st.person_id = ${p} and st.school_id = any(${ids}))
      or exists (select 1 from iam.role_assignment ra where ra.person_id = ${p} and ra.revoked_at is null and ra.school_id = any(${ids}))
      or exists (select 1 from iam.role_assignment ra join tenancy.branch b on b.id = ra.branch_id where ra.person_id = ${p} and ra.revoked_at is null and b.school_id = any(${ids}))
    )
  )`;
}

/** NOT_FOUND (never FORBIDDEN) unless the person exists in this organization and satisfies `personInScopeSql`. */
export async function requirePersonInScope(tx: Tx, scope: AdminScope, personId: string): Promise<{ id: string; firstName: string; lastName: string }> {
  const rows = await tx
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, inScope: sql<boolean>`${personInScopeSql(scope, "iam.person.id")}` })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  const p = rows[0];
  if (!p || !p.inScope) throw notFound();
  return { id: p.id, firstName: p.firstName, lastName: p.lastName };
}

/**
 * SQL predicate «the staff member may be given a teaching assignment by an admin of `scope`»: anchored in the
 * scope (`personInScopeSql`) OR already teaching there (placed by an organization admin). Re-using such a teacher
 * for another class of the same school widens nothing, because teaching never grants account reach.
 */
export function staffAssignableSql(scope: AdminScope, staffProfileColumn: string, personColumn: string): SQL {
  if (scope.kind === "organization") return sql`true`;
  const ids = sql`${sql.param(scope.schoolIds, undefined)}::uuid[]`;
  return sql`(${personInScopeSql(scope, personColumn)} or exists (
    select 1 from academic.teacher_assignment ta
    join tenancy.class_offering o on o.id = ta.class_offering_id
    join tenancy.class_group cg on cg.id = o.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    where ta.staff_profile_id = ${columnRef(staffProfileColumn)} and ta.valid_to is null and b.school_id = any(${ids})))`;
}

/** NOT_FOUND unless the staff profile exists here and `staffAssignableSql` holds for the caller's scope. */
export async function requireStaffAssignable(tx: Tx, scope: AdminScope, staffProfileId: string): Promise<{ staffProfileId: string; personId: string }> {
  const rows = await tx
    .select({ id: staffProfile.id, personId: staffProfile.personId, ok: sql<boolean>`${staffAssignableSql(scope, "iam.staff_profile.id", "iam.staff_profile.person_id")}` })
    .from(staffProfile)
    .where(eq(staffProfile.id, staffProfileId))
    .limit(1);
  const s = rows[0];
  if (!s || !s.ok) throw notFound();
  return { staffProfileId: s.id, personId: s.personId };
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
/** Manager roles scoped to a school (they need a `schoolId`), in picker order. */
export const SCHOOL_ROLES: readonly AssignableRole[] = ["school_principal", "vice_principal"];
/**
 * Owner's matrix (docs/admin.md «ماتریس اعطای نقش»): `org_admin` AND `school_principal` are granted and revoked by
 * an ORGANIZATION-scoped holder of `iam.role_assignment.write` only — a principal cannot mint or unseat a principal.
 */
export const ORG_GRANTED_ROLES: readonly AssignableRole[] = ["org_admin", "school_principal"];
/** What a SCHOOL-scoped holder of `iam.role_assignment.write` (a principal) may grant/revoke, at their own schools. */
export const SCHOOL_GRANTABLE_ROLES: readonly AssignableRole[] = ["vice_principal"];

/**
 * Pure mirror of the permission step of `resolveRoleGrant` / `revokeRoleAssignment` for the UI (pickers, «لغو»
 * buttons) — the server re-runs the real check. `schoolId` is the role's school (`null` for organization roles).
 * Organization-scoped holders manage every role everywhere; a school-scoped holder manages `vice_principal` at the
 * schools of the assignments that carry the permission; anyone else (vice principals) manages nothing.
 */
export function canManageRole(assignments: readonly Assignment[], roleCode: string, schoolId: string | null): boolean {
  const holders = assignments.filter((a) => a.permissions.includes("iam.role_assignment.write"));
  if (holders.some((a) => a.scopeType === "organization")) return true;
  if (!(SCHOOL_GRANTABLE_ROLES as readonly string[]).includes(roleCode) || !schoolId) return false;
  return holders.some((a) => a.scopeType === "school" && a.scopeId === schoolId);
}

/** The only role codes `assignRole` writes; `teacher` is derived by `assignTeacher`, guardian roles are phase 2. */
const MANUAL_ROLE_CODES: ReadonlySet<string> = new Set<string>([...ASSIGNABLE_ROLES, "student"]);

export interface AssignRoleInput {
  personId: string;
  roleCode: AssignableRole | "student";
  schoolId?: string | null;
  studentProfileId?: string | null;
}

export interface RoleGrantOptions<S> {
  /** Manager roles the caller may grant, in picker order; empty = no role picker at all. */
  roles: AssignableRole[];
  /** Schools (of the caller's scope) where the school roles may be granted. */
  schools: S[];
}

/**
 * Which manager roles the caller may grant and where — the picker-side mirror of the `can(iam.role_assignment.write)`
 * check `assignRole` enforces (docs/admin.md «ماتریس اعطای نقش»): an organization-scoped holder grants every role
 * at every school; a school-scoped holder (a principal) grants `vice_principal` only, at the schools of the
 * assignments that carry the permission; anyone else (vice principals) grants nothing. `schools` are the scope's
 * schools, so an option here is never a school the caller cannot see.
 */
export function roleGrantOptions<S extends { value: string }>(assignments: readonly Assignment[], schools: readonly S[]): RoleGrantOptions<S> {
  const holders = assignments.filter((a) => a.permissions.includes("iam.role_assignment.write"));
  if (holders.some((a) => a.scopeType === "organization")) return { roles: [...SCHOOL_ROLES, "org_admin"], schools: [...schools] };
  const grantable = schools.filter((s) => canManageRole(assignments, SCHOOL_GRANTABLE_ROLES[0], s.value));
  if (grantable.length === 0) return { roles: [], schools: [] };
  return { roles: [...SCHOOL_GRANTABLE_ROLES], schools: grantable };
}

async function findSystemRole(tx: Tx, code: string): Promise<{ id: string; allowedScopeTypes: string[] }> {
  const rows = await tx.select({ id: role.id, allowedScopeTypes: role.allowedScopeTypes }).from(role).where(and(isNull(role.organizationId), eq(role.code, code))).limit(1);
  if (!rows[0]) throw invalidReference(`نقش سیستمی «${code}» یافت نشد.`);
  return rows[0];
}

type RoleTarget =
  | { scopeType: "organization"; scopeId: string }
  | { scopeType: "school"; scopeId: string; schoolId: string }
  | { scopeType: "student"; scopeId: string; studentProfileId: string };

interface ResolvedRoleGrant {
  roleId: string;
  target: RoleTarget;
  adminScope: AdminScope;
}

/**
 * Everything a manual role grant must satisfy BEFORE the person is looked at — shared by `assignRole` and the
 * up-front check of `createStaff` (so nothing is written for a grant the caller may not make):
 *   1. the caller is an admin at all (`getAdminScope`, FORBIDDEN otherwise — checked first so a non-admin learns
 *      nothing about school ids);
 *   2. the code is manual and the role's `allowed_scope_types` accept the target scope;
 *   3. a school role's school exists here (NOT_FOUND) and, for a school-scoped caller, is one of theirs
 *      (NOT_FOUND — another school's id must look nonexistent, whether or not it exists);
 *   4. the caller holds the permission the grant needs (FORBIDDEN — the caller is known and the permission is a
 *      declared capability): `iam.role_assignment.write` at the ORGANIZATION for `org_admin` and `school_principal`
 *      (owner's rule: only the organization admin appoints principals — a principal may not mint a principal), at
 *      the school for `vice_principal`; for the `student` role `iam.person.write` at any scope (the role is the
 *      marker of a registered student, not an admin capability — the person must additionally be in scope, which
 *      `assignRole` checks once the person exists). docs/admin.md «ماتریس اعطای نقش».
 */
async function resolveRoleGrant(tx: Tx, ctx: IamCtx, input: Omit<AssignRoleInput, "personId">): Promise<ResolvedRoleGrant> {
  const adminScope = await getAdminScope(tx, ctx);
  if (!MANUAL_ROLE_CODES.has(input.roleCode)) throw validation(undefined, MESSAGES.roleNotManual);
  const tpl = await findSystemRole(tx, input.roleCode);
  let target: RoleTarget;
  if (input.roleCode === "org_admin") {
    target = { scopeType: "organization", scopeId: ctx.orgId };
  } else if (input.roleCode === "student") {
    if (!input.studentProfileId) throw invalidReference("پروفایل دانش‌آموز مشخص نیست.");
    target = { scopeType: "student", scopeId: input.studentProfileId, studentProfileId: input.studentProfileId };
  } else {
    if (!input.schoolId) throw fieldError("schoolId", MESSAGES.roleSchoolRequired);
    if (!(await findSchoolById(tx, input.schoolId))) throw notFound();
    assertSchoolInScope(adminScope, input.schoolId);
    target = { scopeType: "school", scopeId: input.schoolId, schoolId: input.schoolId };
  }
  if (!tpl.allowedScopeTypes.includes(target.scopeType)) throw validation(undefined, MESSAGES.roleScopeNotAllowed);
  if (target.scopeType === "student") {
    if (!canAtAnyScope(ctx.assignments, "iam.person.write")) throw forbidden(MESSAGES.roleGrantForbidden);
  } else if ((ORG_GRANTED_ROLES as readonly string[]).includes(input.roleCode)) {
    // Organization-level permission only (no school ref): a school-scoped principal fails here even at their own school.
    if (!(await can(tx, ctx, "iam.role_assignment.write"))) throw forbidden(input.roleCode === "org_admin" ? MESSAGES.orgRoleForbidden : MESSAGES.principalRoleForbidden);
  } else {
    if (target.scopeType !== "school") throw validation(undefined, MESSAGES.roleScopeNotAllowed);
    if (!(await can(tx, ctx, "iam.role_assignment.write", { scopeType: "school", id: target.schoolId }))) throw forbidden(MESSAGES.roleGrantForbidden);
  }
  return { roleId: tpl.id, target, adminScope };
}

/**
 * Manual role assignment (source_type 'manual', granted_by = ctx.personId). Runtime guards for EVERY caller (actions,
 * importer, seed): `resolveRoleGrant` (manual code, allowed scope type, school in scope, `iam.role_assignment.write`
 * at the role's scope — FORBIDDEN otherwise), then the person must exist and, for a school-scoped caller, be inside
 * their scope (NOT_FOUND) — for the `student` role too, whose profile must belong to that very person.
 */
export async function assignRole(tx: Tx, ctx: IamCtx, input: AssignRoleInput): Promise<{ roleAssignmentId: string; created: boolean }> {
  const { roleId, target, adminScope } = await resolveRoleGrant(tx, ctx, input);
  await requirePersonInScope(tx, adminScope, input.personId);
  if (target.scopeType === "student") {
    // A profile of another person would hand `personId` the reach over that student's items.
    const [sp] = await tx.select({ personId: studentProfile.personId }).from(studentProfile).where(eq(studentProfile.id, target.studentProfileId)).limit(1);
    if (!sp || sp.personId !== input.personId) throw invalidReference(MESSAGES.studentProfileMismatch);
  }
  const { scopeId, ...scope } = target;
  const existing = await tx
    .select({ id: roleAssignment.id })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.personId, input.personId), eq(roleAssignment.roleId, roleId), eq(roleAssignment.scopeType, scope.scopeType), eq(roleAssignment.scopeId, scopeId), isNull(roleAssignment.revokedAt)))
    .limit(1);
  if (existing[0]) return { roleAssignmentId: existing[0].id, created: false };
  const [row] = await tx
    .insert(roleAssignment)
    .values({ organizationId: ctx.orgId, personId: input.personId, roleId, ...scope, sourceType: "manual", grantedByPersonId: ctx.personId })
    .returning({ id: roleAssignment.id });
  await audit(ctx, "iam.role_assignment.created", { schema: "iam", table: "role_assignment", id: row.id }, null, { personId: input.personId, roleCode: input.roleCode, ...scope }, tx);
  return { roleAssignmentId: row.id, created: true };
}

/** The school an existing role assignment lives under (null for organization/student scopes; NOT_FOUND for scopes phase 1 does not cover). */
async function roleAssignmentSchoolId(
  tx: Tx,
  orgId: string,
  ra: { scopeType: string; schoolId: string | null; branchId: string | null; classGroupId: string | null; classOfferingId: string | null },
): Promise<string | null> {
  switch (ra.scopeType) {
    case "organization":
    case "student":
      return null;
    case "school":
      return ra.schoolId;
    case "branch":
      return ra.branchId ? await schoolIdOfBranch(tx, ra.branchId) : null;
    case "class_group":
    case "class_offering": {
      const id = ra.scopeType === "class_group" ? ra.classGroupId : ra.classOfferingId;
      const chain = id ? await resolveScopeChain(tx, orgId, { scopeType: ra.scopeType, id }) : null;
      return chain?.find((n) => n.scopeType === "school")?.id ?? null;
    }
    default:
      throw notFound();
  }
}

/**
 * Revokes a MANUAL assignment. Order matters (no existence oracle): a school-scoped caller must have the person in
 * scope AND the assignment's school inside their schools (`school` / `branch` / derived `class_*` scopes; `student`
 * is covered by the person check) — anything else is NOT_FOUND before the row's nature is mentioned; organization
 * roles stay FORBIDDEN for them. Every caller needs `iam.role_assignment.write` at the scope the role is GRANTED
 * from (FORBIDDEN) — the revoke rules mirror the grant rules: `org_admin` and `school_principal` roles need the
 * organization-level permission (a principal cannot unseat a principal), `vice_principal` the school's. Only then
 * a derived teacher role is refused with its explanation (it ends with the teaching).
 */
export async function revokeRoleAssignment(tx: Tx, ctx: IamCtx, input: { roleAssignmentId: string }): Promise<void> {
  const [ra] = await tx
    .select({
      id: roleAssignment.id,
      personId: roleAssignment.personId,
      roleId: roleAssignment.roleId,
      roleCode: role.code,
      scopeType: roleAssignment.scopeType,
      schoolId: roleAssignment.schoolId,
      branchId: roleAssignment.branchId,
      classGroupId: roleAssignment.classGroupId,
      classOfferingId: roleAssignment.classOfferingId,
      sourceType: roleAssignment.sourceType,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(and(eq(roleAssignment.id, input.roleAssignmentId), isNull(roleAssignment.revokedAt)))
    .limit(1);
  if (!ra) throw notFound();
  const adminScope = await getAdminScope(tx, ctx);
  if (adminScope.kind === "school" && ra.scopeType === "organization") throw forbidden(MESSAGES.orgRoleRevokeForbidden);
  await requirePersonInScope(tx, adminScope, ra.personId);
  const schoolId = await roleAssignmentSchoolId(tx, ctx.orgId, ra);
  if (adminScope.kind === "school" && ra.scopeType !== "student") assertSchoolInScope(adminScope, schoolId);
  const orgLevel = ra.scopeType === "organization" || (ORG_GRANTED_ROLES as readonly string[]).includes(ra.roleCode);
  const permitted =
    ra.scopeType === "student"
      ? canAtAnyScope(ctx.assignments, "iam.role_assignment.write")
      : await can(tx, ctx, "iam.role_assignment.write", !orgLevel && schoolId ? { scopeType: "school", id: schoolId } : undefined);
  if (!permitted) {
    throw forbidden(ra.scopeType === "organization" ? MESSAGES.orgRoleRevokeForbidden : ra.roleCode === "school_principal" ? MESSAGES.principalRoleRevokeForbidden : MESSAGES.roleRevokeForbidden);
  }
  if (ra.sourceType !== "manual") throw validation(undefined, MESSAGES.derivedRoleNotRevocable);
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
  /**
   * The student's school (username prefix + scope anchor). Defaults to the school of `enrollment.classGroupId`.
   * Without a class, a `registered` school_enrollment for the school's CURRENT academic year anchors the student
   * (a school-scoped admin only ever sees anchored persons); no current year → field error.
   */
  schoolId?: string;
  login?: { createAccount: boolean; identifier?: string | null };
  enrollment?: { classGroupId: string } | null;
  /** Assign the system `student` role (default true). */
  assignStudentRole?: boolean;
}

/** `<base>`, then `<base>-01` … `<base>-05`: the first generated username that is free in the GLOBAL account table. */
async function freeGeneratedUsername(tx: Tx, base: string): Promise<ResolvedIdentifier> {
  for (let i = 0; i <= GENERATED_USERNAME_RETRIES; i++) {
    const candidate = i === 0 ? base : `${base}-${String(i).padStart(2, "0")}`;
    if (!(await findAccountByIdentifier(tx, candidate))) return { loginIdentifier: candidate, phoneE164: null };
  }
  throw conflict(MESSAGES.usernameTaken);
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
  const school = schoolId ? await findSchoolById(tx, schoolId) : null;
  if (schoolId && !school) throw invalidReference(MESSAGES.schoolNotFound);
  // Anchor without a class: the school's current year (the class path anchors through enrollStudent below).
  const anchorYear = school && !classGroupId ? await findCurrentAcademicYear(tx, school.id) : null;
  if (school && !classGroupId && !anchorYear) throw fieldError("schoolId", MESSAGES.noCurrentYear);

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

  if (school && anchorYear) {
    const [se] = await tx
      .insert(schoolEnrollment)
      .values({ organizationId: ctx.orgId, studentProfileId: sp.id, schoolId: school.id, academicYearId: anchorYear.id, gradeLevelId: null, status: "registered" })
      .returning({ id: schoolEnrollment.id });
    await audit(
      ctx,
      "academic.school_enrollment.registered",
      { schema: "academic", table: "school_enrollment", id: se.id },
      null,
      { studentProfileId: sp.id, schoolId: school.id, academicYearId: anchorYear.id },
      tx,
    );
  }

  let account: CreateAccountResult | null = null;
  if (input.login?.createAccount) {
    let identifier: ResolvedIdentifier;
    if (input.login.identifier && input.login.identifier.trim() !== "") {
      identifier = resolveIdentifier(input.login.identifier, "identifier");
    } else if (contactPhone) {
      identifier = { loginIdentifier: contactPhone, phoneE164: contactPhone };
    } else {
      if (!school) throw fieldError("identifier", MESSAGES.schoolRequired);
      identifier = await freeGeneratedUsername(tx, `${school.code.toLowerCase()}-${studentNumber.toLowerCase()}`);
    }
    account = await createAccountForPerson(tx, ctx, { personId: p.id, identifier, field: "identifier" });
  }
  // Enroll BEFORE the role: the class enrollment is the student's scope anchor, and `assignRole` requires a
  // school-scoped caller to have the person in scope (the no-class path anchored them above).
  let classEnrollmentId: string | null = null;
  if (classGroupId) classEnrollmentId = (await enrollStudent(tx, ctx, { studentProfileId: sp.id, classGroupId })).classEnrollmentId;
  if (input.assignStudentRole ?? true) await assignRole(tx, ctx, { personId: p.id, roleCode: "student", studentProfileId: sp.id });

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
  /**
   * Primary school (`staff_profile.school_id`) — the scope anchor of staff without a manager role. Defaults to the
   * school of the first school-scoped role; null = anchored nowhere (reachable by organization admins only).
   */
  schoolId?: string | null;
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
 * NEVER granted here — it is derived from class offerings by `assignTeacher`. Roles need `iam.role_assignment.write`
 * at their scope (`resolveRoleGrant`): a vice principal, who may register staff, cannot mint a principal.
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
  const schoolId = input.schoolId ?? input.roles?.find((r) => r.schoolId)?.schoolId ?? null;
  if (schoolId && !(await findSchoolById(tx, schoolId))) throw invalidReference(MESSAGES.schoolNotFound);
  // A grant the caller may not make (school outside their scope → NOT_FOUND, missing `iam.role_assignment.write`
  // → FORBIDDEN) is refused BEFORE anything is written; assignRole re-checks per role once the person exists.
  for (const r of input.roles ?? []) await resolveRoleGrant(tx, ctx, { roleCode: r.roleCode, schoolId: r.schoolId ?? null });
  const [p] = await tx
    .insert(person)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, ...names, gender: input.gender ?? null, externalRef, status: "active" })
    .returning({ id: person.id });
  const [st] = await tx
    .insert(staffProfile)
    .values({
      organizationId: ctx.orgId,
      personId: p.id,
      schoolId,
      employeeNumber: input.employeeNumber?.trim() ? toAsciiDigits(input.employeeNumber.trim()) : null,
      employmentType: input.employmentType ?? "full_time",
      hiredOn: sql`current_date`,
    })
    .returning({ id: staffProfile.id });
  await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId: p.id, kind: "mobile", value: phone, isPrimary: true });
  await audit(ctx, "iam.person.created", { schema: "iam", table: "person", id: p.id }, null, { ...names, kind: "staff", staffProfileId: st.id, schoolId }, tx);

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
  /** staff_profile fields (staff only). `schoolId` = primary school / scope anchor (null = none). */
  employeeNumber?: string | null;
  employmentType?: "full_time" | "part_time" | "contractor";
  schoolId?: string | null;
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
  const personSet = {
    ...(names ?? {}),
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    ...(externalRef !== undefined ? { externalRef } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
  if (Object.keys(personSet).length > 0) await tx.update(person).set(personSet).where(eq(person.id, personId));
  if (input.studentNumber !== undefined) {
    const studentNumber = toAsciiDigits(input.studentNumber.trim());
    if (!STUDENT_NUMBER_RE.test(studentNumber)) throw fieldError("studentNumber", MESSAGES.studentNumberInvalid);
    const dup = await tx.select({ id: studentProfile.id, personId: studentProfile.personId }).from(studentProfile).where(eq(studentProfile.studentNumber, studentNumber)).limit(1);
    if (dup[0] && dup[0].personId !== personId) throw fieldError("studentNumber", MESSAGES.studentNumberTaken);
    await tx.update(studentProfile).set({ studentNumber }).where(eq(studentProfile.personId, personId));
  }
  if (input.employeeNumber !== undefined || input.employmentType !== undefined || input.schoolId !== undefined) {
    if (input.schoolId && !(await findSchoolById(tx, input.schoolId))) throw invalidReference(MESSAGES.schoolNotFound);
    await tx
      .update(staffProfile)
      .set({
        ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber?.trim() ? toAsciiDigits(input.employeeNumber.trim()) : null } : {}),
        ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
        ...(input.schoolId !== undefined ? { schoolId: input.schoolId } : {}),
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
