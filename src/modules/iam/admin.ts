// Admin-facing wrappers around iam/service that enforce the phase-1 scope rule (docs/admin.md): a school-scoped
// admin only reaches people of their own schools — anything else is NOT_FOUND. The actions in src/lib/admin call
// these; the services themselves stay scope-agnostic so the seed and the importer can reuse them.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { enrollStudent, moveEnrollment } from "@/modules/academic/service";
import { classEnrollment, schoolEnrollment } from "@/modules/academic/schema";
import { findClassGroup, schoolIdOfClassOffering } from "@/modules/tenancy/repo";
import type { Assignment } from "./can";
import { organizationMembership, person, roleAssignment, studentProfile } from "./schema";
import {
  assertSchoolInScope,
  createStaff,
  createStudent,
  findAccountOfPerson,
  getAdminScope,
  resetInitialPassword,
  setPersonPhones,
  unlockAccount,
  updatePerson,
  type AdminScope,
  type CreateStaffInput,
  type CreateStaffResult,
  type CreateStudentInput,
  type CreateStudentResult,
  type IamCtx,
  type UpdatePersonInput,
} from "./service";

export type AdminCtx = IamCtx & { assignments: readonly Assignment[] };

/**
 * The schools a person "belongs to" for scoping: school enrollments (students), school-scoped role assignments
 * (staff). Staff without any school-scoped assignment (e.g. a teacher whose roles are offering-scoped) belong to
 * the schools of the classes they teach — resolved through the derived teacher role's offering.
 */
export async function schoolIdsOfPerson(tx: Tx, personId: string): Promise<string[]> {
  const out = new Set<string>();
  const enrolled = await tx
    .select({ schoolId: schoolEnrollment.schoolId })
    .from(schoolEnrollment)
    .innerJoin(studentProfile, eq(studentProfile.id, schoolEnrollment.studentProfileId))
    .where(eq(studentProfile.personId, personId));
  for (const r of enrolled) out.add(r.schoolId);
  const roles = await tx
    .select({ schoolId: roleAssignment.schoolId, classOfferingId: roleAssignment.classOfferingId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.personId, personId), isNull(roleAssignment.revokedAt)));
  for (const r of roles) {
    if (r.schoolId) out.add(r.schoolId);
    if (r.classOfferingId) {
      const schoolId = await schoolIdOfClassOffering(tx, r.classOfferingId);
      if (schoolId) out.add(schoolId);
    }
  }
  return [...out];
}

/**
 * NOT_FOUND unless the person exists and is inside the caller's scope. A person anchored to no school at all (a
 * student not yet enrolled, a staff member without roles or teaching) is visible to every admin of the
 * organization — otherwise the school admin who just created them could not see them (docs/admin.md).
 */
export async function requirePersonInScope(tx: Tx, scope: AdminScope, personId: string): Promise<{ id: string; firstName: string; lastName: string }> {
  const rows = await tx.select({ id: person.id, firstName: person.firstName, lastName: person.lastName }).from(person).where(eq(person.id, personId)).limit(1);
  if (!rows[0]) throw notFound();
  if (scope.kind === "organization") return rows[0];
  const schools = await schoolIdsOfPerson(tx, personId);
  if (schools.length > 0 && !schools.some((s) => scope.schoolIds.includes(s))) throw notFound();
  return rows[0];
}

export async function adminCreateStudent(tx: Tx, ctx: AdminCtx, input: CreateStudentInput): Promise<CreateStudentResult> {
  const scope = await getAdminScope(tx, ctx);
  let schoolId = input.schoolId ?? null;
  if (input.enrollment?.classGroupId) {
    const cg = await findClassGroup(tx, input.enrollment.classGroupId);
    if (!cg) throw notFound();
    schoolId = cg.schoolId;
  }
  assertSchoolInScope(scope, schoolId);
  return createStudent(tx, ctx, { ...input, schoolId: schoolId ?? undefined });
}

export async function adminCreateStaff(tx: Tx, ctx: AdminCtx, input: CreateStaffInput & { schoolId?: string | null }): Promise<CreateStaffResult> {
  const scope = await getAdminScope(tx, ctx);
  // A school admin must anchor new staff to one of their schools (a role there, or the plain membership scope).
  if (scope.kind === "school") {
    for (const r of input.roles ?? []) assertSchoolInScope(scope, r.schoolId);
    assertSchoolInScope(scope, input.schoolId ?? input.roles?.[0]?.schoolId);
  }
  return createStaff(tx, ctx, input);
}

export async function adminUpdatePerson(tx: Tx, ctx: AdminCtx, personId: string, input: UpdatePersonInput & { contactPhone?: string | null; guardianPhone?: string | null }): Promise<void> {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, personId);
  const { contactPhone, guardianPhone, ...rest } = input;
  await updatePerson(tx, ctx, personId, rest);
  if (contactPhone !== undefined || guardianPhone !== undefined) await setPersonPhones(tx, ctx, personId, { contactPhone, guardianPhone });
}

export async function adminResetInitialPassword(tx: Tx, ctx: AdminCtx, personId: string): Promise<{ initialPassword: string; loginIdentifier: string }> {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, personId);
  const account = await findAccountOfPerson(tx, personId);
  if (!account) throw notFound("این فرد حساب کاربری ندارد.");
  const res = await resetInitialPassword(tx, ctx, { userAccountId: account.userAccountId });
  return { initialPassword: res.initialPassword, loginIdentifier: account.loginIdentifier };
}

export async function adminUnlockAccount(tx: Tx, ctx: AdminCtx, personId: string): Promise<void> {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, personId);
  const account = await findAccountOfPerson(tx, personId);
  if (!account) throw notFound("این فرد حساب کاربری ندارد.");
  await unlockAccount(tx, ctx, { userAccountId: account.userAccountId });
}

/** Enroll (no active class) or move (active class elsewhere) a student into `classGroupId`. */
export async function adminPlaceStudent(tx: Tx, ctx: AdminCtx, input: { personId: string; classGroupId: string }): Promise<{ classEnrollmentId: string; moved: boolean }> {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, input.personId);
  const cg = await findClassGroup(tx, input.classGroupId);
  if (!cg || cg.status !== "active") throw notFound();
  assertSchoolInScope(scope, cg.schoolId);
  const [sp] = await tx.select({ id: studentProfile.id }).from(studentProfile).where(eq(studentProfile.personId, input.personId)).limit(1);
  if (!sp) throw notFound();
  const [active] = await tx
    .select({ id: classEnrollment.id, classGroupId: classEnrollment.classGroupId })
    .from(classEnrollment)
    .where(and(eq(classEnrollment.studentProfileId, sp.id), eq(classEnrollment.status, "active")))
    .limit(1);
  if (!active) {
    const res = await enrollStudent(tx, ctx, { studentProfileId: sp.id, classGroupId: cg.id });
    return { classEnrollmentId: res.classEnrollmentId, moved: false };
  }
  if (active.classGroupId === cg.id) return { classEnrollmentId: active.id, moved: false };
  const res = await moveEnrollment(tx, ctx, { classEnrollmentId: active.id, newClassGroupId: cg.id, reason: "admin" });
  return { classEnrollmentId: res.classEnrollmentId, moved: true };
}

/** Persons (students or staff) of the caller's scope that hold an account — used by list filters. */
export async function personIdsWithAccounts(tx: Tx, personIds: string[]): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await tx.select({ personId: organizationMembership.personId }).from(organizationMembership).where(inArray(organizationMembership.personId, personIds));
  return new Set(rows.map((r) => r.personId));
}
