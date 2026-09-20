// Admin-facing wrappers around iam/service that enforce the phase-1 scope rule (docs/admin.md «قانون دامنه»): a
// school-scoped admin only reaches people POSITIVELY anchored in their own schools (`personInScopeSql` in
// iam/service) — anything else is NOT_FOUND. The actions in src/lib/admin call these; the services themselves stay
// scope-agnostic so the seed and the importer can reuse them.
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { forbidden, notFound, validation } from "@/lib/errors";
import { enrollStudent, moveEnrollment } from "@/modules/academic/service";
import { classEnrollment } from "@/modules/academic/schema";
import { findClassGroup } from "@/modules/tenancy/repo";
import type { Assignment } from "./can";
import { organizationMembership, studentProfile } from "./schema";
import {
  assertSchoolInScope,
  createStaff,
  createStudent,
  findAccountOfPerson,
  getAdminScope,
  MESSAGES,
  requirePersonInScope,
  resetInitialPassword,
  setPersonPhones,
  unlockAccount,
  updatePerson,
  type CreateStaffInput,
  type CreateStaffResult,
  type CreateStudentInput,
  type CreateStudentResult,
  type IamCtx,
  type UpdatePersonInput,
} from "./service";

export type AdminCtx = IamCtx & { assignments: readonly Assignment[] };

export { personInScopeSql, requirePersonInScope, requireStaffAssignable, staffAssignableSql } from "./service";

const fieldError = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

/**
 * Every student needs a school (from the chosen class, else the explicit `schoolId`) so that `createStudent` can
 * anchor them; the school must be inside the caller's scope (NOT_FOUND otherwise, even for the class's school).
 */
export async function adminCreateStudent(tx: Tx, ctx: AdminCtx, input: CreateStudentInput): Promise<CreateStudentResult> {
  const scope = await getAdminScope(tx, ctx);
  let schoolId = input.schoolId ?? null;
  if (input.enrollment?.classGroupId) {
    const cg = await findClassGroup(tx, input.enrollment.classGroupId);
    if (!cg) throw notFound();
    schoolId = cg.schoolId;
  }
  if (!schoolId) throw fieldError("schoolId", MESSAGES.studentSchoolRequired);
  assertSchoolInScope(scope, schoolId);
  return createStudent(tx, ctx, { ...input, schoolId });
}

/**
 * New staff carry a primary school (`staff_profile.school_id`): explicit, else the school of the first school-scoped
 * role. A school-scoped admin must anchor the person inside their scope (otherwise they could never see them
 * again); an organization admin may leave it empty (reachable by organization admins only).
 */
export async function adminCreateStaff(tx: Tx, ctx: AdminCtx, input: CreateStaffInput): Promise<CreateStaffResult> {
  const scope = await getAdminScope(tx, ctx);
  const schoolId = input.schoolId ?? input.roles?.find((r) => r.schoolId)?.schoolId ?? null;
  for (const r of input.roles ?? []) {
    if (!r.schoolId) {
      if (scope.kind === "school") throw forbidden("فقط مدیر سازمان می‌تواند نقش سطح سازمان بدهد.");
      continue;
    }
    assertSchoolInScope(scope, r.schoolId);
  }
  if (scope.kind === "school" && !schoolId) throw fieldError("schoolId", MESSAGES.staffSchoolRequired);
  if (schoolId) assertSchoolInScope(scope, schoolId);
  return createStaff(tx, ctx, { ...input, schoolId });
}

export async function adminUpdatePerson(tx: Tx, ctx: AdminCtx, personId: string, input: UpdatePersonInput & { contactPhone?: string | null; guardianPhone?: string | null }): Promise<void> {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, personId);
  // Re-anchoring staff: a school admin may only move them between their own schools, never detach them.
  if (input.schoolId !== undefined) {
    if (input.schoolId === null) {
      if (scope.kind === "school") throw fieldError("schoolId", MESSAGES.staffSchoolRequired);
    } else assertSchoolInScope(scope, input.schoolId);
  }
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
