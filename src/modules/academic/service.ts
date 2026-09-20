// academic/service — business rules for enrollments and teacher assignments. Every function is `(tx, ctx, input)`
// and runs inside the caller's tenant transaction (defineAction, or the seed's own app_owner transaction with the
// org context set). `organization_id` and the acting person come from `ctx`, never from input.
//
// teacher_assignment is the source of truth for "who teaches what"; authorization only reads iam.role_assignment.
// Therefore assignTeacher writes BOTH rows in one transaction (role `teacher`, scope `class_offering`,
// source_type `teacher_assignment`, source_id = the assignment id) and endTeacherAssignment revokes the derived row.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { conflict, invalidReference, validation } from "@/lib/errors";
import { role, roleAssignment, staffProfile } from "@/modules/iam/schema";
import { branch, classGroup } from "@/modules/tenancy/schema";
import { classEnrollment, schoolEnrollment, teacherAssignment } from "./schema";

/** What the service needs from the request context (src/lib/ctx `Ctx` satisfies it; the seed builds one). */
export type ServiceCtx = AuditCtx & { orgId: string; personId: string };

export type TeacherRole = "main" | "assistant" | "substitute";
export type EnrollmentChangeReason = "transfer" | "level_change" | "admin";

const TEACHER_ROLE_CODE = "teacher";

export interface AssignTeacherInput {
  staffProfileId: string;
  classOfferingId: string;
  role?: TeacherRole;
  /** ISO date `YYYY-MM-DD`; defaults to today (DB `current_date`). */
  validFrom?: string;
}

export interface AssignTeacherResult {
  teacherAssignmentId: string;
  roleAssignmentId: string;
}

/**
 * Inserts academic.teacher_assignment AND the derived iam.role_assignment. The system `teacher` template is the
 * role (readable under any tenant via the tenant_isolation_select policy). Rejects with CONFLICT when the same
 * (offering, staff, role) is already active (partial unique `teacher_assignment_active_uq`).
 */
export async function assignTeacher(tx: Tx, ctx: ServiceCtx, input: AssignTeacherInput): Promise<AssignTeacherResult> {
  const teacherRole = input.role ?? "main";
  const [staff] = await tx
    .select({ id: staffProfile.id, personId: staffProfile.personId })
    .from(staffProfile)
    .where(eq(staffProfile.id, input.staffProfileId))
    .limit(1);
  if (!staff) throw invalidReference();

  const [tpl] = await tx
    .select({ id: role.id })
    .from(role)
    .where(and(isNull(role.organizationId), eq(role.code, TEACHER_ROLE_CODE)))
    .limit(1);
  if (!tpl) throw invalidReference("نقش سیستمی «معلم» یافت نشد.");

  const [existing] = await tx
    .select({ id: teacherAssignment.id })
    .from(teacherAssignment)
    .where(
      and(
        eq(teacherAssignment.classOfferingId, input.classOfferingId),
        eq(teacherAssignment.staffProfileId, input.staffProfileId),
        eq(teacherAssignment.role, teacherRole),
        isNull(teacherAssignment.validTo),
      ),
    )
    .limit(1);
  if (existing) throw conflict("این معلم هم‌اکنون به این درس تخصیص دارد.");

  const [ta] = await tx
    .insert(teacherAssignment)
    .values({
      organizationId: ctx.orgId,
      staffProfileId: input.staffProfileId,
      classOfferingId: input.classOfferingId,
      role: teacherRole,
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
    })
    .returning({ id: teacherAssignment.id, validFrom: teacherAssignment.validFrom });

  const [ra] = await tx
    .insert(roleAssignment)
    .values({
      organizationId: ctx.orgId,
      personId: staff.personId,
      roleId: tpl.id,
      scopeType: "class_offering",
      classOfferingId: input.classOfferingId,
      sourceType: "teacher_assignment",
      sourceId: ta.id,
      grantedByPersonId: ctx.personId,
      validFrom: ta.validFrom,
    })
    .returning({ id: roleAssignment.id });

  await audit(
    ctx,
    "academic.teacher_assignment.created",
    { schema: "academic", table: "teacher_assignment", id: ta.id },
    null,
    { staffProfileId: input.staffProfileId, classOfferingId: input.classOfferingId, role: teacherRole, validFrom: ta.validFrom, roleAssignmentId: ra.id },
    tx,
  );
  return { teacherAssignmentId: ta.id, roleAssignmentId: ra.id };
}

export interface EndTeacherAssignmentInput {
  teacherAssignmentId: string;
  /** ISO date; defaults to today. */
  validTo?: string;
}

/** Sets `valid_to` on the assignment and `revoked_at` (+ `valid_to`) on its derived role_assignment(s). */
export async function endTeacherAssignment(tx: Tx, ctx: ServiceCtx, input: EndTeacherAssignmentInput): Promise<{ revokedRoleAssignments: number }> {
  const validTo = input.validTo ? sql`${input.validTo}::date` : sql`current_date`;
  const [ta] = await tx
    .update(teacherAssignment)
    .set({ validTo })
    .where(and(eq(teacherAssignment.id, input.teacherAssignmentId), isNull(teacherAssignment.validTo)))
    .returning({ id: teacherAssignment.id, validTo: teacherAssignment.validTo, staffProfileId: teacherAssignment.staffProfileId, classOfferingId: teacherAssignment.classOfferingId });
  if (!ta) throw invalidReference("تخصیص فعالی با این شناسه یافت نشد.");

  const revoked = await tx
    .update(roleAssignment)
    .set({ revokedAt: sql`now()`, validTo: ta.validTo })
    .where(and(eq(roleAssignment.sourceType, "teacher_assignment"), eq(roleAssignment.sourceId, ta.id), isNull(roleAssignment.revokedAt)))
    .returning({ id: roleAssignment.id });

  await audit(
    ctx,
    "academic.teacher_assignment.ended",
    { schema: "academic", table: "teacher_assignment", id: ta.id },
    { validTo: null },
    { validTo: ta.validTo, revokedRoleAssignments: revoked.map((r) => r.id) },
    tx,
  );
  return { revokedRoleAssignments: revoked.length };
}

export interface EnrollStudentInput {
  studentProfileId: string;
  classGroupId: string;
  /** ISO date; defaults to today. */
  startsOn?: string;
}

export interface EnrollStudentResult {
  schoolEnrollmentId: string;
  classEnrollmentId: string;
  /** false when the student already had a school_enrollment for that academic year (reused). */
  schoolEnrollmentCreated: boolean;
}

interface ClassGroupFacts {
  id: string;
  academicYearId: string;
  gradeLevelId: string;
  schoolId: string;
}

async function loadClassGroup(tx: Tx, classGroupId: string): Promise<ClassGroupFacts> {
  const [cg] = await tx
    .select({ id: classGroup.id, academicYearId: classGroup.academicYearId, gradeLevelId: classGroup.gradeLevelId, schoolId: branch.schoolId })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .where(eq(classGroup.id, classGroupId))
    .limit(1);
  if (!cg) throw invalidReference("کلاس یافت نشد.");
  return cg;
}

/**
 * Enrolls a student in a class: finds or creates the school_enrollment for the class's (school, academic year,
 * grade) and inserts an active class_enrollment. A second active class in the same period is rejected by the
 * exclusion constraint (`class_enrollment_active_excl`) — use moveEnrollment for a transfer.
 */
export async function enrollStudent(tx: Tx, ctx: ServiceCtx, input: EnrollStudentInput): Promise<EnrollStudentResult> {
  const cg = await loadClassGroup(tx, input.classGroupId);
  const startsOn = input.startsOn ? { startsOn: input.startsOn } : {};

  let schoolEnrollmentCreated = false;
  let [se] = await tx
    .select({ id: schoolEnrollment.id })
    .from(schoolEnrollment)
    .where(and(eq(schoolEnrollment.studentProfileId, input.studentProfileId), eq(schoolEnrollment.academicYearId, cg.academicYearId)))
    .limit(1);
  if (!se) {
    [se] = await tx
      .insert(schoolEnrollment)
      .values({
        organizationId: ctx.orgId,
        studentProfileId: input.studentProfileId,
        schoolId: cg.schoolId,
        academicYearId: cg.academicYearId,
        gradeLevelId: cg.gradeLevelId,
        status: "active",
        ...startsOn,
      })
      .returning({ id: schoolEnrollment.id });
    schoolEnrollmentCreated = true;
  }

  const [ce] = await tx
    .insert(classEnrollment)
    .values({
      organizationId: ctx.orgId,
      schoolEnrollmentId: se.id,
      classGroupId: cg.id,
      studentProfileId: input.studentProfileId,
      status: "active",
      changedByPersonId: ctx.personId,
      ...startsOn,
    })
    .returning({ id: classEnrollment.id, startsOn: classEnrollment.startsOn });

  await audit(
    ctx,
    "academic.class_enrollment.created",
    { schema: "academic", table: "class_enrollment", id: ce.id },
    null,
    { studentProfileId: input.studentProfileId, classGroupId: cg.id, schoolEnrollmentId: se.id, startsOn: ce.startsOn },
    tx,
  );
  return { schoolEnrollmentId: se.id, classEnrollmentId: ce.id, schoolEnrollmentCreated };
}

export interface MoveEnrollmentInput {
  classEnrollmentId: string;
  newClassGroupId: string;
  reason: EnrollmentChangeReason;
}

/**
 * Transfers a student to another class of the SAME academic year: the current row ends today
 * (`status = 'transferred'`, `ends_on = today`) and a new active row starts today with `previous_enrollment_id`.
 */
export async function moveEnrollment(tx: Tx, ctx: ServiceCtx, input: MoveEnrollmentInput): Promise<{ classEnrollmentId: string }> {
  const [current] = await tx
    .select({
      id: classEnrollment.id,
      schoolEnrollmentId: classEnrollment.schoolEnrollmentId,
      classGroupId: classEnrollment.classGroupId,
      studentProfileId: classEnrollment.studentProfileId,
      academicYearId: classGroup.academicYearId,
    })
    .from(classEnrollment)
    .innerJoin(classGroup, eq(classGroup.id, classEnrollment.classGroupId))
    .where(and(eq(classEnrollment.id, input.classEnrollmentId), eq(classEnrollment.status, "active")))
    .limit(1);
  if (!current) throw invalidReference("ثبت‌نام فعالی با این شناسه یافت نشد.");
  if (current.classGroupId === input.newClassGroupId) throw validation(undefined, "دانش‌آموز هم‌اکنون در همین کلاس است.");

  const target = await loadClassGroup(tx, input.newClassGroupId);
  if (target.academicYearId !== current.academicYearId) {
    throw validation(undefined, "انتقال فقط بین کلاس‌های همان سال تحصیلی ممکن است.");
  }

  await tx
    .update(classEnrollment)
    .set({ status: "transferred", endsOn: sql`current_date`, changeReason: input.reason, changedByPersonId: ctx.personId })
    .where(eq(classEnrollment.id, current.id));

  const [next] = await tx
    .insert(classEnrollment)
    .values({
      organizationId: ctx.orgId,
      schoolEnrollmentId: current.schoolEnrollmentId,
      classGroupId: target.id,
      studentProfileId: current.studentProfileId,
      status: "active",
      changeReason: input.reason,
      previousEnrollmentId: current.id,
      changedByPersonId: ctx.personId,
    })
    .returning({ id: classEnrollment.id });

  await audit(
    ctx,
    "academic.class_enrollment.moved",
    { schema: "academic", table: "class_enrollment", id: next.id },
    { classEnrollmentId: current.id, classGroupId: current.classGroupId },
    { classGroupId: target.id, reason: input.reason },
    tx,
  );
  return { classEnrollmentId: next.id };
}
