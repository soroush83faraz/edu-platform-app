// academic (step 2): the class_enrollment exclusion constraint (btree_gist, migration 0011) and the academic service —
// assignTeacher / endTeacherAssignment derive and revoke the `teacher` role_assignment; enrollStudent / moveEnrollment
// keep one active class per student. Every write happens inside a withTenant transaction that ends with Rollback.
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, classEnrollment, roleAssignment, schoolEnrollment, teacherAssignment } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getMyClass } from "@/modules/academic/repo";
import { assignTeacher, endTeacherAssignment, enrollStudent, moveEnrollment, type ServiceCtx } from "@/modules/academic/service";
import * as f from "./fixtures";
import { Rollback, pgCode } from "./helpers";

const EXCLUSION_VIOLATION = "23P01";
const ctxA = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const svcA: ServiceCtx = { orgId: f.ORG_A, personId: f.PERSON_A2, userId: null, requestId: "int-test" };

describe("class_enrollment_active_excl (one active class per student per day)", () => {
  it("a second overlapping active enrollment for the same student is rejected (23P01); ending the first then re-enrolling from today succeeds", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [se] = await tx
          .insert(schoolEnrollment)
          .values({ organizationId: f.ORG_A, studentProfileId: f.STUDENT_A1, schoolId: f.SCHOOL_A, academicYearId: f.YEAR_A, gradeLevelId: f.GRADE_A })
          .returning({ id: schoolEnrollment.id });
        const base = { organizationId: f.ORG_A, schoolEnrollmentId: se.id, studentProfileId: f.STUDENT_A1 };
        const [first] = await tx
          .insert(classEnrollment)
          .values({ ...base, classGroupId: f.CLASS_GROUP_A1, startsOn: "2026-09-01" })
          .returning({ id: classEnrollment.id });

        // Nested transaction = SAVEPOINT: the failure does not abort the outer transaction.
        await expect(
          tx.transaction((sp) => sp.insert(classEnrollment).values({ ...base, classGroupId: f.CLASS_GROUP_A2, startsOn: "2026-09-10" })),
        ).rejects.toSatisfy((err: unknown) => pgCode(err) === EXCLUSION_VIOLATION);

        // Open-ended row vs. a row starting today: still overlaps.
        await expect(
          tx.transaction((sp) => sp.insert(classEnrollment).values({ ...base, classGroupId: f.CLASS_GROUP_A2 })),
        ).rejects.toSatisfy((err: unknown) => pgCode(err) === EXCLUSION_VIOLATION);

        // End the first one today ('[)' range: today itself is no longer covered) and start the new one today.
        await tx.update(classEnrollment).set({ status: "ended", endsOn: sql`current_date` }).where(eq(classEnrollment.id, first.id));
        const [second] = await tx
          .insert(classEnrollment)
          .values({ ...base, classGroupId: f.CLASS_GROUP_A2, previousEnrollmentId: first.id })
          .returning({ id: classEnrollment.id, status: classEnrollment.status });
        expect(second.status).toBe("active");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe("assignTeacher / endTeacherAssignment", () => {
  it("creates exactly one derived role_assignment (teacher template, class_offering scope, source = the assignment) and audits it", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const res = await assignTeacher(tx, svcA, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });

        const derived = await tx
          .select({
            id: roleAssignment.id,
            personId: roleAssignment.personId,
            roleId: roleAssignment.roleId,
            scopeType: roleAssignment.scopeType,
            scopeId: roleAssignment.scopeId,
            sourceType: roleAssignment.sourceType,
            grantedBy: roleAssignment.grantedByPersonId,
            revokedAt: roleAssignment.revokedAt,
          })
          .from(roleAssignment)
          .where(eq(roleAssignment.sourceId, res.teacherAssignmentId));
        expect(derived).toHaveLength(1);
        expect(derived[0]).toMatchObject({
          id: res.roleAssignmentId,
          personId: f.PERSON_A2,
          roleId: f.ROLE_TEMPLATE,
          scopeType: "class_offering",
          scopeId: f.OFFERING_A1,
          sourceType: "teacher_assignment",
          grantedBy: f.PERSON_A2,
          revokedAt: null,
        });

        const trail = await tx
          .select({ action: auditLog.action, entityId: auditLog.entityId, actor: auditLog.actorPersonId, requestId: auditLog.requestId })
          .from(auditLog)
          .where(eq(auditLog.entityId, res.teacherAssignmentId));
        expect(trail).toEqual([{ action: "academic.teacher_assignment.created", entityId: res.teacherAssignmentId, actor: f.PERSON_A2, requestId: "int-test" }]);

        // Same (offering, staff, role) again → CONFLICT from the service (before the partial unique index fires).
        await expect(assignTeacher(tx, svcA, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(
          (err: unknown) => AppError.is(err) && err.code === "CONFLICT",
        );
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("endTeacherAssignment sets valid_to and revokes the derived role_assignment", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const res = await assignTeacher(tx, svcA, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1, role: "assistant" });
        const ended = await endTeacherAssignment(tx, svcA, { teacherAssignmentId: res.teacherAssignmentId, validTo: "2026-12-01" });
        expect(ended.revokedRoleAssignments).toBe(1);

        const [ta] = await tx.select({ validTo: teacherAssignment.validTo }).from(teacherAssignment).where(eq(teacherAssignment.id, res.teacherAssignmentId));
        expect(ta.validTo).toBe("2026-12-01");
        const [ra] = await tx
          .select({ revokedAt: roleAssignment.revokedAt, validTo: roleAssignment.validTo })
          .from(roleAssignment)
          .where(eq(roleAssignment.id, res.roleAssignmentId));
        expect(ra.revokedAt).toBeInstanceOf(Date);
        expect(ra.validTo).toBe("2026-12-01");
        const stillActive = await tx
          .select({ id: roleAssignment.id })
          .from(roleAssignment)
          .where(and(eq(roleAssignment.sourceId, res.teacherAssignmentId), isNull(roleAssignment.revokedAt)));
        expect(stillActive).toEqual([]);

        // Ending twice: no active assignment left → INVALID_REFERENCE.
        await expect(endTeacherAssignment(tx, svcA, { teacherAssignmentId: res.teacherAssignmentId })).rejects.toSatisfy(
          (err: unknown) => AppError.is(err) && err.code === "INVALID_REFERENCE",
        );
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("a staff profile of another organization is invisible under RLS → INVALID_REFERENCE", async () => {
    await expect(
      withTenant({ orgId: f.ORG_B, personId: f.PERSON_B1 }, (tx) =>
        assignTeacher(tx, { orgId: f.ORG_B, personId: f.PERSON_B1 }, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_B1 }),
      ),
    ).rejects.toSatisfy((err: unknown) => AppError.is(err) && err.code === "INVALID_REFERENCE");
  });
});

describe("enrollStudent / moveEnrollment", () => {
  it("enrollStudent derives school/year/grade from the class and creates one school_enrollment + one active class_enrollment", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const res = await enrollStudent(tx, svcA, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
        expect(res.schoolEnrollmentCreated).toBe(true);
        const [se] = await tx
          .select({ schoolId: schoolEnrollment.schoolId, yearId: schoolEnrollment.academicYearId, gradeId: schoolEnrollment.gradeLevelId, status: schoolEnrollment.status })
          .from(schoolEnrollment)
          .where(eq(schoolEnrollment.id, res.schoolEnrollmentId));
        expect(se).toEqual({ schoolId: f.SCHOOL_A, yearId: f.YEAR_A, gradeId: f.GRADE_A, status: "active" });

        // A second class in the same year reuses the school_enrollment but hits the exclusion constraint.
        await expect(tx.transaction((sp) => enrollStudent(sp, svcA, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A2 }))).rejects.toSatisfy(
          (err: unknown) => pgCode(err) === EXCLUSION_VIOLATION,
        );
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("moveEnrollment ends the current row today (transferred) and opens the new one with previous_enrollment_id", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const first = await enrollStudent(tx, svcA, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1, startsOn: "2026-09-01" });
        const moved = await moveEnrollment(tx, svcA, { classEnrollmentId: first.classEnrollmentId, newClassGroupId: f.CLASS_GROUP_A2, reason: "transfer" });

        const rows = await tx
          .select({
            id: classEnrollment.id,
            classGroupId: classEnrollment.classGroupId,
            status: classEnrollment.status,
            endsOn: classEnrollment.endsOn,
            previous: classEnrollment.previousEnrollmentId,
            reason: classEnrollment.changeReason,
            changedBy: classEnrollment.changedByPersonId,
            today: sql<string>`current_date::text`,
          })
          .from(classEnrollment)
          .where(eq(classEnrollment.studentProfileId, f.STUDENT_A1));
        const old = rows.find((r) => r.id === first.classEnrollmentId)!;
        const next = rows.find((r) => r.id === moved.classEnrollmentId)!;
        expect(old).toMatchObject({ classGroupId: f.CLASS_GROUP_A1, status: "transferred", endsOn: old.today, reason: "transfer", changedBy: f.PERSON_A2 });
        expect(next).toMatchObject({ classGroupId: f.CLASS_GROUP_A2, status: "active", endsOn: null, previous: first.classEnrollmentId, reason: "transfer" });

        // Moving to the class the student is already in → VALIDATION.
        await expect(moveEnrollment(tx, svcA, { classEnrollmentId: moved.classEnrollmentId, newClassGroupId: f.CLASS_GROUP_A2, reason: "admin" })).rejects.toSatisfy(
          (err: unknown) => AppError.is(err) && err.code === "VALIDATION",
        );
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("moving a future-dated enrollment collapses it to an empty range (ends_on = starts_on) instead of violating the dates CHECK", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const first = await enrollStudent(tx, svcA, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1, startsOn: "2027-01-05" });
        const moved = await moveEnrollment(tx, svcA, { classEnrollmentId: first.classEnrollmentId, newClassGroupId: f.CLASS_GROUP_A2, reason: "level_change" });
        const [old] = await tx.select({ endsOn: classEnrollment.endsOn, status: classEnrollment.status }).from(classEnrollment).where(eq(classEnrollment.id, first.classEnrollmentId));
        expect(old).toEqual({ endsOn: "2027-01-05", status: "transferred" });
        const [next] = await tx.select({ status: classEnrollment.status }).from(classEnrollment).where(eq(classEnrollment.id, moved.classEnrollmentId));
        expect(next.status).toBe("active");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe("getMyClass («کلاس من» read model)", () => {
  it("null without an enrollment; then class, school, classmates (others only) and the current teacher per offering", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        expect(await getMyClass(tx, f.PERSON_A1)).toBeNull();

        await enrollStudent(tx, svcA, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
        // No teacher yet: the offering row is there with a null teacher.
        const alone = await getMyClass(tx, f.PERSON_A1);
        expect(alone).toEqual({ classGroupName: "اول 1", schoolName: "دبستان", classmates: 0, teachers: [{ offeringId: f.OFFERING_A1, subjectName: "ریاضی", teacherName: null }] });

        // A classmate (written directly) and the teacher assignment of the class's one offering.
        const classmatePerson = "0199a000-00f3-7000-8000-000000000001";
        const classmateProfile = "0199a000-00f3-7000-8000-000000000002";
        await tx.execute(sql`insert into iam.person (id, organization_id, first_name, last_name) values (${classmatePerson}::uuid, ${f.ORG_A}::uuid, 'سارا', 'محمدی')`);
        await tx.execute(sql`insert into iam.student_profile (id, organization_id, person_id, student_number) values (${classmateProfile}::uuid, ${f.ORG_A}::uuid, ${classmatePerson}::uuid, 'T9001')`);
        await enrollStudent(tx, svcA, { studentProfileId: classmateProfile, classGroupId: f.CLASS_GROUP_A1 });
        await assignTeacher(tx, svcA, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });

        const mine = await getMyClass(tx, f.PERSON_A1);
        expect(mine).toEqual({ classGroupName: "اول 1", schoolName: "دبستان", classmates: 1, teachers: [{ offeringId: f.OFFERING_A1, subjectName: "ریاضی", teacherName: "زهرا کریمی" }] });
        // The classmate sees one classmate too (me), the same teacher.
        expect((await getMyClass(tx, classmatePerson))?.classmates).toBe(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
