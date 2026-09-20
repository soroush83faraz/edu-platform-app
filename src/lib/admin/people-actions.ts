"use server";
// People actions of /admin: students, staff, accounts (reset / unlock / create), enrollment placement, roles.
// Each names its permission (held at ANY scope — the admin scope rule inside iam/admin narrows the reach to the
// caller's schools; out-of-scope people are NOT_FOUND). Plaintext passwords exist only in the returned Result.
import { sql } from "drizzle-orm";
import { defineAction } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { endTeacherAssignment } from "@/modules/academic/service";
import { adminCreateStaff, adminCreateStudent, adminPlaceStudent, adminResetInitialPassword, adminUnlockAccount, adminUpdatePerson, requirePersonInScope } from "@/modules/iam/admin";
import { assignRole, createAccountForPerson, getAdminScope, resolveIdentifier, revokeRoleAssignment, MESSAGES } from "@/modules/iam/service";
import { findSchoolById } from "@/modules/tenancy/repo";
import { getPersonDetail } from "./people";
import {
  AssignRoleInput,
  CreateAccountInput,
  CreateStaffInput,
  CreateStudentInput,
  EndTeachingInput,
  PersonIdInput,
  PlaceStudentInput,
  RevokeRoleInput,
  UpdateStaffInput,
  UpdateStudentInput,
} from "./people-dto";

export const createStudentAction = defineAction({ schema: CreateStudentInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) => {
  const res = await adminCreateStudent(tx, ctx, {
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender ?? null,
    studentNumber: input.studentNumber,
    externalRef: input.externalRef ?? null,
    contactPhone: input.contactPhone ?? null,
    guardianPhone: input.guardianPhone ?? null,
    schoolId: input.schoolId,
    login: { createAccount: input.createAccount, identifier: input.identifier ?? null },
    enrollment: input.classGroupId ? { classGroupId: input.classGroupId } : null,
  });
  return { personId: res.personId, loginIdentifier: res.loginIdentifier, initialPassword: res.initialPassword };
});

export const updateStudentAction = defineAction({ schema: UpdateStudentInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) => {
  await adminUpdatePerson(tx, ctx, input.personId, {
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender ?? null,
    externalRef: input.externalRef ?? null,
    studentNumber: input.studentNumber,
    contactPhone: input.contactPhone ?? null,
    guardianPhone: input.guardianPhone ?? null,
  });
  return { personId: input.personId };
});

export const createStaffAction = defineAction({ schema: CreateStaffInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) => {
  const res = await adminCreateStaff(tx, ctx, {
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender ?? null,
    phone: input.phone,
    employeeNumber: input.employeeNumber ?? null,
    employmentType: input.employmentType,
    schoolId: input.schoolId ?? null,
    roles: input.roles.map((r) => ({ roleCode: r.roleCode, schoolId: r.schoolId ?? null })),
  });
  return { personId: res.personId, loginIdentifier: res.loginIdentifier, initialPassword: res.initialPassword };
});

export const updateStaffAction = defineAction({ schema: UpdateStaffInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) => {
  await adminUpdatePerson(tx, ctx, input.personId, {
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender ?? null,
    employeeNumber: input.employeeNumber ?? null,
    employmentType: input.employmentType,
  });
  return { personId: input.personId };
});

/** «تعیین رمز موقت» — returns the plaintext ONCE. */
export const resetPasswordAction = defineAction({ schema: PersonIdInput, permission: "iam.account.reset_password", scope: "any" }, async (tx, input, ctx) =>
  adminResetInitialPassword(tx, ctx, input.personId),
);

/** «رفع قفل». */
export const unlockAccountAction = defineAction({ schema: PersonIdInput, permission: "iam.account.unlock", scope: "any" }, async (tx, input, ctx) => {
  await adminUnlockAccount(tx, ctx, input.personId);
  return { personId: input.personId };
});

/** Creates the login account of a person who was registered without one (students without a phone → username). */
export const createAccountAction = defineAction({ schema: CreateAccountInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const detail = await getPersonDetail(tx, scope, input.personId);
  if (detail.account) throw notFound("این فرد حساب کاربری دارد.");
  let identifier;
  if (input.identifier?.trim()) identifier = resolveIdentifier(input.identifier, "identifier");
  else if (detail.contactPhone) identifier = { loginIdentifier: detail.contactPhone, phoneE164: detail.contactPhone };
  else if (detail.student) {
    const schoolId = detail.enrollment?.schoolId ?? detail.schoolIds[0];
    const sch = schoolId ? await findSchoolById(tx, schoolId) : null;
    if (!sch) throw notFound(MESSAGES.schoolRequired);
    identifier = { loginIdentifier: `${sch.code.toLowerCase()}-${detail.student.studentNumber.toLowerCase()}`, phoneE164: null };
  } else throw notFound("برای کارکنان، شمارهٴ موبایل را وارد کنید.");
  const res = await createAccountForPerson(tx, ctx, { personId: input.personId, identifier });
  return { loginIdentifier: res.loginIdentifier, initialPassword: res.initialPassword };
});

/** Enroll into a class, or move from the current one (same academic year). */
export const placeStudentAction = defineAction({ schema: PlaceStudentInput, permission: "academic.enrollment.write", scope: "any" }, async (tx, input, ctx) =>
  adminPlaceStudent(tx, ctx, { personId: input.personId, classGroupId: input.classGroupId }),
);

export const assignRoleAction = defineAction({ schema: AssignRoleInput, permission: "iam.role_assignment.write", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, input.personId);
  return assignRole(tx, ctx, { personId: input.personId, roleCode: input.roleCode, schoolId: input.schoolId ?? null });
});

export const revokeRoleAction = defineAction({ schema: RevokeRoleInput, permission: "iam.role_assignment.write", scope: "any" }, async (tx, input, ctx) => {
  await revokeRoleAssignment(tx, ctx, { roleAssignmentId: input.roleAssignmentId });
  return { roleAssignmentId: input.roleAssignmentId };
});

/** Ends a teaching assignment (the derived `teacher` role is revoked with it). */
export const endTeachingAction = defineAction({ schema: EndTeachingInput, permission: "academic.teacher_assignment.write", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  // The school of the offering must be in scope; RLS already limits the organization.
  const rows = await tx.execute<{ school_id: string }>(
    sql`select b.school_id from academic.teacher_assignment ta join tenancy.class_offering o on o.id = ta.class_offering_id join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where ta.id = ${input.teacherAssignmentId}`,
  );
  const schoolId = rows.rows[0]?.school_id;
  if (!schoolId || (scope.kind === "school" && !scope.schoolIds.includes(schoolId))) throw notFound();
  await endTeacherAssignment(tx, ctx, { teacherAssignmentId: input.teacherAssignmentId });
  return { teacherAssignmentId: input.teacherAssignmentId };
});
