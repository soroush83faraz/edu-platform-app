// Admin services (phase 1 admin area): people (createStudent / createStaff / reset / unlock / roles), the
// structure creators (school + default branch, academic year + terms, class group, class offering → teacher) and
// the scope rule (getAdminScope / adminCreateStudent → NOT_FOUND outside the caller's schools). Every business
// write happens inside a withTenant transaction that ends with Rollback. The system role templates the services
// need (org_admin, school_principal, vice_principal, student) come from the real catalog seed, run as app_owner
// in beforeAll and removed again in afterAll by re-creating the fixture database (later files assert exact
// template lists).
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, authIdentity, classEnrollment, organizationMembership, roleAssignment, schoolEnrollment, teacherAssignment, userAccount, userSession } from "@/db/schema";
import { decryptInitialPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { adminCreateStaff, adminCreateStudent, adminResetInitialPassword, type AdminCtx } from "@/modules/iam/admin";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { assertSchoolInScope, assignRole, createStaff, createStudent, getAdminScope, resetInitialPassword, unlockAccount } from "@/modules/iam/service";
import { createAcademicYear, createClassGroup, createClassOffering, createSchool } from "@/modules/tenancy/service";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const orgAdminRole: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const schoolAdminRole = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: ALL });

const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const orgAdmin: AdminCtx = { orgId: f.ORG_A, personId: f.PERSON_A2, userId: null, requestId: "int-test", assignments: [orgAdminRole] };
const schoolAdmin: AdminCtx = { ...orgAdmin, assignments: [schoolAdminRole(f.SCHOOL_A)] };

const rolledBack = (fn: Parameters<typeof withTenant>[1]) => expect(withTenant(tenant, fn)).rejects.toBeInstanceOf(Rollback);

describe("admin services", () => {
  beforeAll(async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      await seedCatalog(drizzle({ client: pool, schema }));
    } finally {
      await pool.end();
    }
  });
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("createStudent with a phone: account (login = phone), membership, student role, enrollment; the encrypted initial password round-trips and never reaches the audit trail", async () => {
    await rolledBack(async (tx) => {
      const res = await createStudent(tx, orgAdmin, {
        firstName: "سارا",
        lastName: "محمّدي", // Arabic yeh + tashdid → normalized
        gender: "female",
        studentNumber: "۱۴۰۵۰۰۹۹",
        contactPhone: "۰۹۱۲ ۷۰۰ ۰۰۰۱",
        guardianPhone: "09127000002",
        login: { createAccount: true },
        enrollment: { classGroupId: f.CLASS_GROUP_A1 },
      });
      expect(res.loginIdentifier).toBe("+989127000001");
      expect(res.initialPassword).toMatch(/^\d{8}$/);
      expect(res.classEnrollmentId).not.toBeNull();

      const [acct] = await tx.select({ id: userAccount.id, phone: userAccount.phoneE164, must: userAccount.mustChangePassword }).from(userAccount).where(eq(userAccount.loginIdentifier, "+989127000001"));
      expect(acct).toMatchObject({ id: res.userAccountId, phone: "+989127000001", must: true });
      const [ident] = await tx.select({ enc: authIdentity.initialPasswordEnc }).from(authIdentity).where(eq(authIdentity.userAccountId, acct.id));
      expect(decryptInitialPassword(ident.enc)).toBe(res.initialPassword);
      const memberships = await tx.select({ id: organizationMembership.id }).from(organizationMembership).where(eq(organizationMembership.personId, res.personId));
      expect(memberships).toHaveLength(1);
      const roles = await tx.select({ scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId }).from(roleAssignment).where(and(eq(roleAssignment.personId, res.personId), isNull(roleAssignment.revokedAt)));
      expect(roles).toEqual([{ scopeType: "student", scopeId: res.studentProfileId }]);
      const se = await tx.select({ schoolId: schoolEnrollment.schoolId }).from(schoolEnrollment).where(eq(schoolEnrollment.studentProfileId, res.studentProfileId));
      expect(se).toEqual([{ schoolId: f.SCHOOL_A }]);
      const ce = await tx.select({ classGroupId: classEnrollment.classGroupId, status: classEnrollment.status }).from(classEnrollment).where(eq(classEnrollment.studentProfileId, res.studentProfileId));
      expect(ce).toEqual([{ classGroupId: f.CLASS_GROUP_A1, status: "active" }]);
      const [p] = await tx.execute<{ first_name: string; last_name: string; student_number: string }>(
        sql`select p.first_name, p.last_name, s.student_number from iam.person p join iam.student_profile s on s.person_id = p.id where p.id = ${res.personId}`,
      ).then((r) => r.rows);
      expect(p).toEqual({ first_name: "سارا", last_name: "محمّدی", student_number: "14050099" });

      const trail = await tx.select({ after: auditLog.after, action: auditLog.action }).from(auditLog).where(eq(auditLog.requestId, "int-test"));
      expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(["iam.person.created", "iam.user_account.created", "academic.class_enrollment.created"]));
      expect(JSON.stringify(trail)).not.toContain(res.initialPassword!);
      throw new Rollback();
    });
  });

  it("createStudent without a phone: login is `<school code>-<student number>` (lower-cased)", async () => {
    await rolledBack(async (tx) => {
      const res = await createStudent(tx, orgAdmin, { firstName: "علی", lastName: "رضایی", studentNumber: "A-77", schoolId: f.SCHOOL_A, login: { createAccount: true } });
      expect(res.loginIdentifier).toBe("s1-a-77");
      const [acct] = await tx.select({ phone: userAccount.phoneE164 }).from(userAccount).where(eq(userAccount.id, res.userAccountId!));
      expect(acct.phone).toBeNull();
      throw new Rollback();
    });
  });

  it("duplicate phone / student number → CONFLICT / VALIDATION with the Persian messages", async () => {
    await rolledBack(async (tx) => {
      await createStudent(tx, orgAdmin, { firstName: "الف", lastName: "ب", studentNumber: "1", contactPhone: "09127000010", login: { createAccount: true, identifier: "09127000010" }, schoolId: f.SCHOOL_A });
      await expect(
        tx.transaction((sp) => createStudent(sp, orgAdmin, { firstName: "ج", lastName: "د", studentNumber: "2", login: { createAccount: true, identifier: "۰۹۱۲۷۰۰۰۰۱۰" }, schoolId: f.SCHOOL_A })),
      ).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "CONFLICT" && e.message === "این شماره قبلاً ثبت شده است.");
      await expect(tx.transaction((sp) => createStudent(sp, orgAdmin, { firstName: "ج", lastName: "د", studentNumber: "1" }))).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION" && (e.details as { fieldErrors: Record<string, string[]> }).fieldErrors.studentNumber[0] === "این شمارهٴ دانش‌آموزی قبلاً ثبت شده است.",
      );
      throw new Rollback();
    });
  });

  it("scope rule: a school-scoped admin cannot create a student in another school of the same organization (NOT_FOUND), and can in their own", async () => {
    await rolledBack(async (tx) => {
      const other = await createSchool(tx, orgAdmin, { name: "دبیرستان دوم", code: "S2" });
      const scope = await getAdminScope(tx, schoolAdmin);
      expect(scope).toEqual({ kind: "school", schoolIds: [f.SCHOOL_A] });
      expect(() => assertSchoolInScope(scope, other.schoolId)).toThrow(AppError);
      expect(await getAdminScope(tx, orgAdmin)).toEqual({ kind: "organization" });

      await expect(
        tx.transaction((sp) => adminCreateStudent(sp, schoolAdmin, { firstName: "ن", lastName: "م", studentNumber: "S2-1", schoolId: other.schoolId, login: { createAccount: true } })),
      ).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "NOT_FOUND");
      const ok = await adminCreateStudent(tx, schoolAdmin, { firstName: "ن", lastName: "م", studentNumber: "S1-1", enrollment: { classGroupId: f.CLASS_GROUP_A2 }, login: { createAccount: true } });
      expect(ok.loginIdentifier).toBe("s1-s1-1");
      // Teachers are never admins: no admin assignment → FORBIDDEN.
      await expect(getAdminScope(tx, { orgId: f.ORG_A, assignments: [{ roleCode: "teacher", roleId: "t", scopeType: "class_offering", scopeId: f.OFFERING_A1, permissions: ["workspace.work_item.read"] }] })).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "FORBIDDEN",
      );
      throw new Rollback();
    });
  });

  it("resetInitialPassword revokes every session, forces a change and stores a new encrypted initial password; unlockAccount clears the lock", async () => {
    await rolledBack(async (tx) => {
      const created = await createStudent(tx, orgAdmin, { firstName: "ر", lastName: "ز", studentNumber: "R1", contactPhone: "09127000020", login: { createAccount: true }, enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
      const accountId = created.userAccountId!;
      await tx.insert(userSession).values({ userAccountId: accountId, tokenHash: "h1", currentOrgId: f.ORG_A, expiresAt: sql`now() + interval '1 day'` });
      await tx.insert(userSession).values({ userAccountId: accountId, tokenHash: "h2", currentOrgId: f.ORG_A, expiresAt: sql`now() + interval '1 day'` });
      await tx.update(userAccount).set({ mustChangePassword: false, status: "locked", failedLoginCount: 7, lockedUntil: sql`now() + interval '1 hour'` }).where(eq(userAccount.id, accountId));

      const reset = await resetInitialPassword(tx, orgAdmin, { userAccountId: accountId });
      expect(reset.initialPassword).toMatch(/^\d{8}$/);
      expect(reset.initialPassword).not.toBe(created.initialPassword);
      expect(reset.revokedSessions).toBe(2);
      const live = await tx.select({ id: userSession.id }).from(userSession).where(and(eq(userSession.userAccountId, accountId), isNull(userSession.revokedAt)));
      expect(live).toHaveLength(0);
      const [ident] = await tx.select({ enc: authIdentity.initialPasswordEnc }).from(authIdentity).where(eq(authIdentity.userAccountId, accountId));
      expect(decryptInitialPassword(ident.enc)).toBe(reset.initialPassword);
      let [acct] = await tx.select({ must: userAccount.mustChangePassword, status: userAccount.status }).from(userAccount).where(eq(userAccount.id, accountId));
      expect(acct).toEqual({ must: true, status: "locked" });

      // The admin wrapper resolves the account through the person and the scope.
      const viaAdmin = await adminResetInitialPassword(tx, schoolAdmin, created.personId);
      expect(viaAdmin.loginIdentifier).toBe("+989127000020");

      await unlockAccount(tx, orgAdmin, { userAccountId: accountId });
      [acct] = await tx.select({ must: userAccount.mustChangePassword, status: userAccount.status }).from(userAccount).where(eq(userAccount.id, accountId));
      expect(acct.status).toBe("active");
      const [row] = await tx.select({ failed: userAccount.failedLoginCount, until: userAccount.lockedUntil }).from(userAccount).where(eq(userAccount.id, accountId));
      expect(row).toEqual({ failed: 0, until: null });
      const actions = (await tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, accountId))).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["iam.account.password_reset", "iam.account.unlocked"]));
      // An account of another organization is invisible: NOT_FOUND.
      await expect(tx.transaction((sp) => resetInitialPassword(sp, orgAdmin, { userAccountId: "0199a000-0000-7000-8000-00000000dead" }))).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "NOT_FOUND");
      throw new Rollback();
    });
  });

  it("createStaff: phone account + manual roles (never `teacher`); a school-scoped admin cannot grant org_admin", async () => {
    await rolledBack(async (tx) => {
      const res = await createStaff(tx, orgAdmin, { firstName: "مریم", lastName: "رضایی", phone: "0912 700 0030", roles: [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }] });
      expect(res.loginIdentifier).toBe("+989127000030");
      expect(res.roleAssignmentIds).toHaveLength(1);
      const roles = await tx
        .select({ scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId, sourceType: roleAssignment.sourceType, grantedBy: roleAssignment.grantedByPersonId })
        .from(roleAssignment)
        .where(eq(roleAssignment.personId, res.personId));
      expect(roles).toEqual([{ scopeType: "school", scopeId: f.SCHOOL_A, sourceType: "manual", grantedBy: f.PERSON_A2 }]);
      // Same role twice is a no-op (idempotent), not a duplicate.
      const again = await assignRole(tx, orgAdmin, { personId: res.personId, roleCode: "school_principal", schoolId: f.SCHOOL_A });
      expect(again.created).toBe(false);

      await expect(tx.transaction((sp) => assignRole(sp, schoolAdmin, { personId: res.personId, roleCode: "org_admin" }))).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "FORBIDDEN");
      await expect(tx.transaction((sp) => adminCreateStaff(sp, schoolAdmin, { firstName: "ا", lastName: "ب", phone: "09127000031", roles: [{ roleCode: "org_admin" }] }))).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND"),
      );
      await expect(tx.transaction((sp) => createStaff(sp, orgAdmin, { firstName: "ا", lastName: "ب", phone: "09127000030" }))).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "CONFLICT");
      throw new Rollback();
    });
  });

  it("structure: createSchool adds the default branch; a second current year is a field error; class offering with a main teacher derives the teacher role", async () => {
    await rolledBack(async (tx) => {
      const sch = await createSchool(tx, orgAdmin, { name: "مدرسهٴ سوم", code: "s3", genderPolicy: "girls" });
      const [br] = await tx.execute<{ name: string; is_default: boolean; school_id: string }>(sql`select name, is_default, school_id from tenancy.branch where id = ${sch.branchId}`).then((r) => r.rows);
      expect(br).toEqual({ name: "مرکزی", is_default: true, school_id: sch.schoolId });
      const [code] = await tx.execute<{ code: string }>(sql`select code from tenancy.school where id = ${sch.schoolId}`).then((r) => r.rows);
      expect(code.code).toBe("s3");

      const year = await createAcademicYear(tx, orgAdmin, {
        schoolId: sch.schoolId,
        name: "۱۴۰۵-۱۴۰۶",
        startsOn: "2026-09-23",
        endsOn: "2027-06-21",
        isCurrent: true,
        terms: [
          { name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" },
          { name: "نوبت دوم", sequence: 2, startsOn: "2027-01-21", endsOn: "2027-06-21" },
        ],
      });
      expect(year.termIds).toHaveLength(2);
      await expect(tx.transaction((sp) => createAcademicYear(sp, orgAdmin, { schoolId: sch.schoolId, name: "۱۴۰۶-۱۴۰۷", startsOn: "2027-09-23", endsOn: "2028-06-21", isCurrent: true }))).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION" && Object.keys((e.details as { fieldErrors: Record<string, string[]> }).fieldErrors)[0] === "isCurrent",
      );

      const cg = await createClassGroup(tx, orgAdmin, { branchId: sch.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "۱۰/۳" });
      await expect(tx.transaction((sp) => createClassGroup(sp, orgAdmin, { branchId: sch.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "۱۰/۳" }))).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION",
      );
      // Year of another school → field error.
      await expect(tx.transaction((sp) => createClassGroup(sp, orgAdmin, { branchId: f.BRANCH_A, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "x" }))).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION",
      );

      const off = await createClassOffering(tx, orgAdmin, { classGroupId: cg.classGroupId, subjectId: f.SUBJECT_A, termId: year.termIds[0], mainTeacherStaffProfileId: f.STAFF_A2 });
      expect(off.teacherAssignmentId).not.toBeNull();
      const ta = await tx.select({ id: teacherAssignment.id }).from(teacherAssignment).where(eq(teacherAssignment.classOfferingId, off.classOfferingId));
      expect(ta).toHaveLength(1);
      const derived = await tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.sourceId, off.teacherAssignmentId!), isNull(roleAssignment.revokedAt)));
      expect(derived).toHaveLength(1);
      throw new Rollback();
    });
  });
});
