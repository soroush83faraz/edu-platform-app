// Admin scope hardening after the verifier review (docs/decisions.md «2026-09-20 — admin scope hardening»):
//   F1 a school-scoped admin (principal AND vice principal) never reaches the organization admin or people
//      anchored in another school — detail, reset, unlock, credentials, update, role changes are all NOT_FOUND;
//      students created with a school but no class are anchored (registered school_enrollment) at creation;
//   F2 a school admin can only hand a class to staff anchored in / teaching at their schools, and teaching never
//      grants account reach (a principal of S1 who teaches at S2 is still NOT_FOUND for the S2 admin);
//   F3 revoking a role assignment of a person outside the scope is NOT_FOUND (organization roles stay FORBIDDEN);
//   F4 assignRole rejects non-manual role codes in the service;
//   F5 unknown vs. other-school year/term produce the identical error (no existence oracle);
//   F6 school codes are unique case-insensitively and a globally taken generated username gets a `-01` suffix;
//   F7 an organization admin creating a student without school/class gets a VALIDATION field error.
// Round 2 (docs/decisions.md «2026-09-21 — admin hardening round 2»):
//   N1 granting a manager role needs `iam.role_assignment.write` at the role's scope in the SERVICE — a vice
//      principal cannot mint a principal through createStaff/assignRole; the pickers mirror the same matrix;
//   N3 only LIVE school enrollments anchor a student — a student transferred out is NOT_FOUND for the old school;
//   F3' revoking another school's DERIVED role is NOT_FOUND (the explanation is reserved for roles in scope);
//   F4' the `student` role is scope-checked too and its profile must belong to the person.
// Owner's role matrix (docs/decisions.md «2026-09-21 — owner's role matrix»):
//   M1 only the organization admin creates schools (principals edit their own);
//   M2 a principal grants/revokes `vice_principal` at their own schools only — never `school_principal` (FORBIDDEN);
//   M3 a vice principal grants nothing, but registers staff and students and sets/changes/ends the main teacher of
//      EXISTING offerings of their school (`academic.teacher_assignment.write`); defining offerings stays structure.
// Everything runs inside withTenant transactions that end with Rollback; the catalog roles are seeded in beforeAll
// and the fixture database is re-created in afterAll (later files assert exact template lists).
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { roleAssignment, schoolEnrollment, staffProfile, userAccount } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GATE_MESSAGES, resourceOpGate } from "@/lib/admin/defineResource";
import { classResource, offeringResource, RESOURCE_MESSAGES, schoolResource, staffOptions } from "@/lib/admin/resources";
import { getPersonDetail, listStaff, listStudents, personCredential } from "@/lib/admin/people";
import { assignTeacher } from "@/modules/academic/service";
import { adminCreateStaff, adminCreateStudent, adminPlaceStudent, adminResetInitialPassword, adminUnlockAccount, adminUpdatePerson, type AdminCtx } from "@/modules/iam/admin";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { assignRole, canManageRole, createStaff, createStudent, getAdminScope, requirePersonInScope, requireStaffAssignable, revokeRoleAssignment, roleGrantOptions, MESSAGES } from "@/modules/iam/service";
import { findSchoolByCode, findSchoolById } from "@/modules/tenancy/repo";
import { createAcademicYear, createClassGroup, createClassOffering, createSchool, MESSAGES as TENANCY_MESSAGES } from "@/modules/tenancy/service";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
/** What the seeded `vice_principal` role grants (scripts/seed.ts SYSTEM_ROLES) — enough for /admin and teacher assignment, no structure/role writes. */
const VICE_PERMS = [
  "iam.admin.access",
  "tenancy.structure.read",
  "iam.person.read",
  "iam.person.write",
  "academic.enrollment.write",
  "academic.teacher_assignment.write",
  "iam.account.reset_password",
  "iam.account.unlock",
  "notif.notification.read",
];

const orgAdminRole: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const principalOf = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: ALL });
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: VICE_PERMS });

const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const orgAdmin: AdminCtx = { orgId: f.ORG_A, personId: f.PERSON_A2, userId: null, requestId: "int-scope", assignments: [orgAdminRole] };
const asAdmin = (personId: string, ...assignments: Assignment[]): AdminCtx => ({ ...orgAdmin, personId, assignments });
/** ResourceCtx for the generic admin resources (offerings / classes). */
const resourceCtx = (ctx: AdminCtx) => ({ orgId: ctx.orgId, personId: ctx.personId, userId: "00000000-0000-7000-8000-000000000000", requestId: "int-scope", ip: "127.0.0.1", userAgent: null, assignments: [...ctx.assignments] });

const rolledBack = (fn: (tx: Tx) => Promise<void>) => expect(withTenant(tenant, fn)).rejects.toBeInstanceOf(Rollback);

const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
const fieldErrorOn = (field: string) => (e: unknown) => AppError.is(e) && e.code === "VALIDATION" && Object.keys((e.details as { fieldErrors: Record<string, string[]> }).fieldErrors)[0] === field;
/** Runs `fn` in a savepoint so a failing statement never poisons the outer transaction. */
const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));

interface World {
  s2: { schoolId: string; branchId: string; yearId: string; termId: string; classGroupId: string; offeringId: string };
  orgAdminPerson: string;
  s1Principal: { personId: string; staffProfileId: string; roleAssignmentId: string };
  s2Principal: { personId: string; staffProfileId: string; roleAssignmentId: string };
  s2Vice: { personId: string; staffProfileId: string; roleAssignmentId: string };
  s1Teacher: { personId: string; staffProfileId: string };
  ctx: { s2Principal: AdminCtx; s2Vice: AdminCtx; s1Principal: AdminCtx };
}

/** School S2 next to the fixture school S1 (f.SCHOOL_A), one real org admin and a principal per school, a vice principal at S2. */
async function buildWorld(tx: Tx): Promise<World> {
  const s2 = await createSchool(tx, orgAdmin, { name: "دبیرستان دوم", code: "S2", genderPolicy: "boys" });
  const year = await createAcademicYear(tx, orgAdmin, {
    schoolId: s2.schoolId,
    name: "۱۴۰۵-۱۴۰۶",
    startsOn: "2026-09-23",
    endsOn: "2027-06-21",
    isCurrent: true,
    terms: [{ name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" }],
  });
  const cg = await createClassGroup(tx, orgAdmin, { branchId: s2.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "۱۰/۱" });
  const off = await createClassOffering(tx, orgAdmin, { classGroupId: cg.classGroupId, subjectId: f.SUBJECT_A, termId: year.termIds[0] });

  // The organization's one مدیر سازمان is BOOTSTRAPPED, not granted: nobody may put `org_admin` on another
  // person (round 7), so the fixture does what the seeds do — the actor establishes the role on ITSELF.
  const admin = await createStaff(tx, orgAdmin, { firstName: "محمد", lastName: "امینی", phone: "09127200001" });
  await assignRole(tx, asAdmin(admin.personId, orgAdminRole), { personId: admin.personId, roleCode: "org_admin" });
  const s1p = await createStaff(tx, orgAdmin, { firstName: "مریم", lastName: "رضایی", phone: "09127200002", roles: [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }] });
  const s2p = await createStaff(tx, orgAdmin, { firstName: "زهرا", lastName: "موسوی", phone: "09127200003", roles: [{ roleCode: "school_principal", schoolId: s2.schoolId }] });
  const s2v = await createStaff(tx, orgAdmin, { firstName: "سارا", lastName: "کاظمی", phone: "09127200004", roles: [{ roleCode: "vice_principal", schoolId: s2.schoolId }] });
  const s1t = await createStaff(tx, orgAdmin, { firstName: "علی", lastName: "کریمی", phone: "09127200005", schoolId: f.SCHOOL_A });
  return {
    s2: { schoolId: s2.schoolId, branchId: s2.branchId, yearId: year.academicYearId, termId: year.termIds[0], classGroupId: cg.classGroupId, offeringId: off.classOfferingId },
    orgAdminPerson: admin.personId,
    s1Principal: { personId: s1p.personId, staffProfileId: s1p.staffProfileId, roleAssignmentId: s1p.roleAssignmentIds[0] },
    s2Principal: { personId: s2p.personId, staffProfileId: s2p.staffProfileId, roleAssignmentId: s2p.roleAssignmentIds[0] },
    s2Vice: { personId: s2v.personId, staffProfileId: s2v.staffProfileId, roleAssignmentId: s2v.roleAssignmentIds[0] },
    s1Teacher: { personId: s1t.personId, staffProfileId: s1t.staffProfileId },
    ctx: {
      s2Principal: asAdmin(s2p.personId, principalOf(s2.schoolId)),
      s2Vice: asAdmin(s2v.personId, viceOf(s2.schoolId)),
      s1Principal: asAdmin(s1p.personId, principalOf(f.SCHOOL_A)),
    },
  };
}

/** Every account-management path a school-scoped admin has over `personId` must be NOT_FOUND. */
async function expectUnreachable(tx: Tx, ctx: AdminCtx, personId: string): Promise<void> {
  const scope = await getAdminScope(tx, ctx);
  await expect(sub(tx, (sp) => requirePersonInScope(sp, scope, personId))).rejects.toSatisfy(isError("NOT_FOUND"));
  await expect(sub(tx, (sp) => getPersonDetail(sp, scope, personId))).rejects.toSatisfy(isError("NOT_FOUND"));
  await expect(sub(tx, (sp) => adminResetInitialPassword(sp, ctx, personId))).rejects.toSatisfy(isError("NOT_FOUND"));
  await expect(sub(tx, (sp) => adminUnlockAccount(sp, ctx, personId))).rejects.toSatisfy(isError("NOT_FOUND"));
  await expect(sub(tx, (sp) => personCredential(sp, scope, personId))).rejects.toSatisfy(isError("NOT_FOUND"));
  await expect(sub(tx, (sp) => adminUpdatePerson(sp, ctx, personId, { firstName: "تغییر" }))).rejects.toSatisfy(isError("NOT_FOUND"));
  const staffPage = await listStaff(tx, scope, { q: "", page: 1, pageSize: 100 });
  expect(staffPage.rows.map((r) => r.personId)).not.toContain(personId);
  const studentPage = await listStudents(tx, scope, { q: "", page: 1, pageSize: 100 });
  expect(studentPage.rows.map((r) => r.personId)).not.toContain(personId);
}

describe("admin scope hardening", () => {
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

  it("F1: the organization admin is out of reach of a school principal and a vice principal (detail, reset, unlock, credentials, update, roles, lists); organization scope keeps full reach", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      for (const ctx of [w.ctx.s2Principal, w.ctx.s2Vice]) {
        await expectUnreachable(tx, ctx, w.orgAdminPerson);
        // …and the same for the principal of the other school.
        await expectUnreachable(tx, ctx, w.s1Principal.personId);
        // Their own school's people are reachable.
        const scope = await getAdminScope(tx, ctx);
        const detail = await getPersonDetail(tx, scope, w.s2Principal.personId);
        expect(detail.staff?.schoolId).toBe(w.s2.schoolId);
        const staff = await listStaff(tx, scope, { q: "", page: 1, pageSize: 100 });
        expect(staff.rows.map((r) => r.personId).sort()).toEqual([w.s2Principal.personId, w.s2Vice.personId].sort());
      }
      // A school admin cannot grant the org admin a role at their school either (person out of scope → NOT_FOUND).
      await expect(sub(tx, (sp) => assignRole(sp, w.ctx.s2Principal, { personId: w.orgAdminPerson, roleCode: "vice_principal", schoolId: w.s2.schoolId }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // Organization scope: everyone of the organization, the org admin included.
      const orgScope = await getAdminScope(tx, orgAdmin);
      expect((await getPersonDetail(tx, orgScope, w.orgAdminPerson)).id).toBe(w.orgAdminPerson);
      const reset = await adminResetInitialPassword(tx, orgAdmin, w.orgAdminPerson);
      expect(reset.loginIdentifier).toBe("+989127200001");
      const all = await listStaff(tx, orgScope, { q: "", page: 1, pageSize: 100 });
      expect(all.rows.map((r) => r.personId)).toEqual(expect.arrayContaining([w.orgAdminPerson, w.s1Principal.personId, w.s2Principal.personId, w.s2Vice.personId, w.s1Teacher.personId]));
      throw new Rollback();
    });
  });

  it("F1c/F7: a student created with a school and no class is anchored by a `registered` school_enrollment; the other school's admins never see them; no school at all → VALIDATION", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const student = await adminCreateStudent(tx, orgAdmin, { firstName: "نگار", lastName: "صادقی", studentNumber: "S1-900", schoolId: f.SCHOOL_A, login: { createAccount: true } });
      expect(student.loginIdentifier).toBe("s1-s1-900");
      const anchors = await tx
        .select({ schoolId: schoolEnrollment.schoolId, yearId: schoolEnrollment.academicYearId, gradeId: schoolEnrollment.gradeLevelId, status: schoolEnrollment.status })
        .from(schoolEnrollment)
        .where(eq(schoolEnrollment.studentProfileId, student.studentProfileId));
      expect(anchors).toEqual([{ schoolId: f.SCHOOL_A, yearId: f.YEAR_A, gradeId: null, status: "registered" }]);

      for (const ctx of [w.ctx.s2Principal, w.ctx.s2Vice]) await expectUnreachable(tx, ctx, student.personId);
      // S1's principal reaches the anchored student and can place them; the anchor row becomes the active enrollment.
      const s1Scope = await getAdminScope(tx, w.ctx.s1Principal);
      expect((await getPersonDetail(tx, s1Scope, student.personId)).schoolIds).toEqual([f.SCHOOL_A]);
      expect((await adminResetInitialPassword(tx, w.ctx.s1Principal, student.personId)).loginIdentifier).toBe("s1-s1-900");
      const placed = await adminPlaceStudent(tx, w.ctx.s1Principal, { personId: student.personId, classGroupId: f.CLASS_GROUP_A1 });
      expect(placed.moved).toBe(false);
      const after = await tx
        .select({ gradeId: schoolEnrollment.gradeLevelId, status: schoolEnrollment.status })
        .from(schoolEnrollment)
        .where(eq(schoolEnrollment.studentProfileId, student.studentProfileId));
      expect(after).toEqual([{ gradeId: f.GRADE_A, status: "active" }]);

      // F7: an organization admin without school and class gets a Persian field error, not NOT_FOUND.
      await expect(sub(tx, (sp) => adminCreateStudent(sp, orgAdmin, { firstName: "ب", lastName: "ج", studentNumber: "S1-901", contactPhone: "09127200077", login: { createAccount: true } }))).rejects.toSatisfy(
        (e: unknown) => fieldErrorOn("schoolId")(e) && (e as AppError).message === MESSAGES.studentSchoolRequired,
      );
      // A school without a current academic year cannot anchor a student yet.
      const s3 = await createSchool(tx, orgAdmin, { name: "مدرسهٴ سوم", code: "S3" });
      await expect(sub(tx, (sp) => adminCreateStudent(sp, orgAdmin, { firstName: "ب", lastName: "ج", studentNumber: "S3-1", schoolId: s3.schoolId, login: { createAccount: false } }))).rejects.toSatisfy(
        (e: unknown) => fieldErrorOn("schoolId")(e) && (e as AppError).message === MESSAGES.noCurrentYear,
      );
      // A school-scoped admin creating in another school is still NOT_FOUND (never reveals the school).
      await expect(sub(tx, (sp) => adminCreateStudent(sp, w.ctx.s2Principal, { firstName: "ب", lastName: "ج", studentNumber: "S1-902", schoolId: f.SCHOOL_A, login: { createAccount: false } }))).rejects.toSatisfy(isError("NOT_FOUND"));
      throw new Rollback();
    });
  });

  it("F1b: new staff of a school admin are anchored to their school (required); re-anchoring stays inside the scope", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const ctx = w.ctx.s2Principal;
      await expect(sub(tx, (sp) => adminCreateStaff(sp, ctx, { firstName: "حسین", lastName: "محمدی", phone: "09127200010" }))).rejects.toSatisfy(
        (e: unknown) => fieldErrorOn("schoolId")(e) && (e as AppError).message === MESSAGES.staffSchoolRequired,
      );
      await expect(sub(tx, (sp) => adminCreateStaff(sp, ctx, { firstName: "حسین", lastName: "محمدی", phone: "09127200010", schoolId: f.SCHOOL_A }))).rejects.toSatisfy(isError("NOT_FOUND"));
      const teacher = await adminCreateStaff(tx, ctx, { firstName: "حسین", lastName: "محمدی", phone: "09127200010", schoolId: w.s2.schoolId });
      const [profile] = await tx.select({ schoolId: staffProfile.schoolId }).from(staffProfile).where(eq(staffProfile.id, teacher.staffProfileId));
      expect(profile.schoolId).toBe(w.s2.schoolId);
      const s2Scope = await getAdminScope(tx, ctx);
      expect((await getPersonDetail(tx, s2Scope, teacher.personId)).staff?.schoolId).toBe(w.s2.schoolId);
      expect((await staffOptions(tx, s2Scope)).map((o) => o.value)).toContain(teacher.staffProfileId);
      await expectUnreachable(tx, w.ctx.s1Principal, teacher.personId);
      // The vice principal of S2 also reaches the new colleague.
      expect((await getPersonDetail(tx, await getAdminScope(tx, w.ctx.s2Vice), teacher.personId)).id).toBe(teacher.personId);

      // Re-anchoring: a school admin cannot hand the colleague to another school nor detach them; an org admin can move them.
      await expect(sub(tx, (sp) => adminUpdatePerson(sp, ctx, teacher.personId, { schoolId: f.SCHOOL_A }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => adminUpdatePerson(sp, ctx, teacher.personId, { schoolId: null }))).rejects.toSatisfy(fieldErrorOn("schoolId"));
      await adminUpdatePerson(tx, orgAdmin, teacher.personId, { schoolId: f.SCHOOL_A });
      await expectUnreachable(tx, ctx, teacher.personId);
      expect((await getPersonDetail(tx, await getAdminScope(tx, w.ctx.s1Principal), teacher.personId)).staff?.schoolId).toBe(f.SCHOOL_A);
      throw new Rollback();
    });
  });

  it("F2: a school admin cannot set another school's staff as main teacher (options + mutation), and teaching there never grants account reach", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const ctx = w.ctx.s2Principal;
      const s2Scope = await getAdminScope(tx, ctx);
      const options = (await staffOptions(tx, s2Scope)).map((o) => o.value);
      expect(options.sort()).toEqual([w.s2Principal.staffProfileId, w.s2Vice.staffProfileId].sort());
      expect((await staffOptions(tx, await getAdminScope(tx, orgAdmin))).map((o) => o.value)).toEqual(expect.arrayContaining([w.s1Teacher.staffProfileId, w.s1Principal.staffProfileId, w.s2Principal.staffProfileId]));

      for (const staffProfileId of [w.s1Principal.staffProfileId, w.s1Teacher.staffProfileId]) {
        await expect(sub(tx, (sp) => requireStaffAssignable(sp, s2Scope, staffProfileId))).rejects.toSatisfy(isError("NOT_FOUND"));
        await expect(sub(tx, (sp) => offeringResource.update(sp, resourceCtx(ctx), s2Scope, w.s2.offeringId, { classGroupId: w.s2.classGroupId, subjectId: f.SUBJECT_A, termId: w.s2.termId, mainTeacherStaffProfileId: staffProfileId, weeklyHours: null, status: "active" }))).rejects.toSatisfy(
          isError("NOT_FOUND"),
        );
        await expect(
          sub(tx, (sp) => offeringResource.create(sp, resourceCtx(ctx), s2Scope, { classGroupId: w.s2.classGroupId, subjectId: f.SUBJECT_A, termId: w.s2.termId, mainTeacherStaffProfileId: staffProfileId, weeklyHours: null, status: "active" })),
        ).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      const active = await tx.select({ id: schema.teacherAssignment.id }).from(schema.teacherAssignment).where(and(eq(schema.teacherAssignment.classOfferingId, w.s2.offeringId), isNull(schema.teacherAssignment.validTo)));
      expect(active).toHaveLength(0);
      // Their own staff can be assigned.
      await offeringResource.update(tx, resourceCtx(ctx), s2Scope, w.s2.offeringId, { classGroupId: w.s2.classGroupId, subjectId: f.SUBJECT_A, termId: w.s2.termId, mainTeacherStaffProfileId: w.s2Vice.staffProfileId, weeklyHours: null, status: "active" });

      // An organization admin places the S1 principal as a teacher at S2: the S2 admin may re-use them for other
      // S2 classes, but still has NO account reach over them (teaching never anchors).
      await assignTeacher(tx, orgAdmin, { staffProfileId: w.s1Principal.staffProfileId, classOfferingId: w.s2.offeringId, role: "assistant" });
      expect((await requireStaffAssignable(tx, s2Scope, w.s1Principal.staffProfileId)).personId).toBe(w.s1Principal.personId);
      expect((await staffOptions(tx, s2Scope)).map((o) => o.value)).toContain(w.s1Principal.staffProfileId);
      await expectUnreachable(tx, ctx, w.s1Principal.personId);
      await expectUnreachable(tx, w.ctx.s2Vice, w.s1Principal.personId);
      throw new Rollback();
    });
  });

  it("F3/F4: revoking a role of a person outside the scope is NOT_FOUND (org roles FORBIDDEN, own school OK); assignRole rejects `teacher` in the service", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const ctx = w.ctx.s2Principal;
      const s1Student = await adminCreateStudent(tx, w.ctx.s1Principal, { firstName: "الهام", lastName: "جعفری", studentNumber: "S1-903", enrollment: { classGroupId: f.CLASS_GROUP_A1 }, login: { createAccount: false } });
      const [studentRole] = await tx
        .select({ id: roleAssignment.id })
        .from(roleAssignment)
        .where(and(eq(roleAssignment.personId, s1Student.personId), eq(roleAssignment.scopeType, "student"), isNull(roleAssignment.revokedAt)));
      expect(studentRole).toBeDefined();
      // Another school's student-scoped role, another school's principal role: NOT_FOUND (the id proves nothing).
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, ctx, { roleAssignmentId: studentRole.id }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, ctx, { roleAssignmentId: w.s1Principal.roleAssignmentId }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // The organization admin's role stays FORBIDDEN with the explicit message.
      const [orgRole] = await tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, w.orgAdminPerson), eq(roleAssignment.scopeType, "organization"), isNull(roleAssignment.revokedAt)));
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, ctx, { roleAssignmentId: orgRole.id }))).rejects.toSatisfy(isError("FORBIDDEN"));
      for (const id of [studentRole.id, w.s1Principal.roleAssignmentId, orgRole.id]) {
        const [row] = await tx.select({ revokedAt: roleAssignment.revokedAt }).from(roleAssignment).where(eq(roleAssignment.id, id));
        expect(row.revokedAt).toBeNull();
      }
      // Own school: revoking the vice principal's role works; the vice principal cannot revoke anything (no permission — the action gate), but the service alone also refuses the org role.
      await revokeRoleAssignment(tx, ctx, { roleAssignmentId: w.s2Vice.roleAssignmentId });
      const [revoked] = await tx.select({ revokedAt: roleAssignment.revokedAt }).from(roleAssignment).where(eq(roleAssignment.id, w.s2Vice.roleAssignmentId));
      expect(revoked.revokedAt).not.toBeNull();

      // F4: the service refuses non-manual codes before touching the database, whoever calls it.
      await expect(sub(tx, (sp) => assignRole(sp, orgAdmin, { personId: w.s1Teacher.personId, roleCode: "teacher" as never, schoolId: f.SCHOOL_A }))).rejects.toSatisfy(isError("VALIDATION", MESSAGES.roleNotManual));
      await expect(sub(tx, (sp) => assignRole(sp, orgAdmin, { personId: w.s1Teacher.personId, roleCode: "guardian_full" as never, studentProfileId: f.STUDENT_A1 }))).rejects.toSatisfy(isError("VALIDATION", MESSAGES.roleNotManual));
      const derived = await tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, w.s1Teacher.personId), isNull(roleAssignment.revokedAt)));
      expect(derived).toHaveLength(0);
      throw new Rollback();
    });
  });

  it("F5: an unknown year/term and another school's year/term produce the identical error (resource layer NOT_FOUND, service VALIDATION with one message)", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const ctx = w.ctx.s2Principal;
      const s2Scope = await getAdminScope(tx, ctx);
      const unknown = "0199a000-ffff-7000-8000-00000000dead";
      const shape = (e: unknown) => (AppError.is(e) ? `${e.code}|${e.message}` : String(e));

      const yearErrors: string[] = [];
      for (const academicYearId of [unknown, f.YEAR_A]) {
        yearErrors.push(await sub(tx, (sp) => classResource.create(sp, resourceCtx(ctx), s2Scope, { branchId: w.s2.branchId, academicYearId, gradeLevelId: f.GRADE_A, name: "۱۰/۹", capacity: null })).then(() => "ok", shape));
      }
      expect(yearErrors[0]).toBe(yearErrors[1]);
      expect(yearErrors[0]).toBe("NOT_FOUND|موردی یافت نشد.");

      const termErrors: string[] = [];
      for (const termId of [unknown, f.TERM_A]) {
        termErrors.push(await sub(tx, (sp) => offeringResource.create(sp, resourceCtx(ctx), s2Scope, { classGroupId: w.s2.classGroupId, subjectId: f.SUBJECT_A, termId, mainTeacherStaffProfileId: null, weeklyHours: null, status: "active" })).then(() => "ok", shape));
      }
      expect(termErrors[0]).toBe(termErrors[1]);
      expect(termErrors[0]).toBe("NOT_FOUND|موردی یافت نشد.");

      // The scope-agnostic services (seed / importer callers) also use one message for both cases.
      const svcYear: string[] = [];
      for (const academicYearId of [unknown, f.YEAR_A]) {
        svcYear.push(await sub(tx, (sp) => createClassGroup(sp, orgAdmin, { branchId: w.s2.branchId, academicYearId, gradeLevelId: f.GRADE_A, name: "۱۰/۸" })).then(() => "ok", shape));
      }
      expect(svcYear[0]).toBe(svcYear[1]);
      expect(svcYear[0]).toBe(`VALIDATION|${TENANCY_MESSAGES.yearNotForBranch}`);
      const svcTerm: string[] = [];
      for (const termId of [unknown, f.TERM_A]) {
        svcTerm.push(await sub(tx, (sp) => createClassOffering(sp, orgAdmin, { classGroupId: w.s2.classGroupId, subjectId: f.SUBJECT_A, termId })).then(() => "ok", shape));
      }
      expect(svcTerm[0]).toBe(svcTerm[1]);
      expect(svcTerm[0]).toBe(`VALIDATION|${TENANCY_MESSAGES.termNotForClass}`);
      throw new Rollback();
    });
  });

  it("F6: school codes are unique case-insensitively; a generated username that is taken globally gets a `-01` suffix, an explicit duplicate keeps the CONFLICT message", async () => {
    await rolledBack(async (tx) => {
      await expect(sub(tx, (sp) => createSchool(sp, orgAdmin, { name: "تکراری", code: "s1" }))).rejects.toSatisfy((e: unknown) => fieldErrorOn("code")(e) && (e as AppError).message === TENANCY_MESSAGES.schoolCodeTaken);
      // Another organization already owns `s1-777` (login_identifier is global; every fixture organization has a school `S1`).
      await tx.insert(userAccount).values({ loginIdentifier: "s1-777", phoneE164: null, status: "active", mustChangePassword: true });
      await tx.insert(userAccount).values({ loginIdentifier: "s1-778", phoneE164: null, status: "active", mustChangePassword: true });
      await tx.insert(userAccount).values({ loginIdentifier: "s1-778-01", phoneE164: null, status: "active", mustChangePassword: true });
      const a = await createStudent(tx, orgAdmin, { firstName: "الف", lastName: "ب", studentNumber: "777", schoolId: f.SCHOOL_A, login: { createAccount: true } });
      expect(a.loginIdentifier).toBe("s1-777-01");
      const b = await createStudent(tx, orgAdmin, { firstName: "ج", lastName: "د", studentNumber: "778", schoolId: f.SCHOOL_A, login: { createAccount: true } });
      expect(b.loginIdentifier).toBe("s1-778-02");
      // An identifier the admin typed is never rewritten.
      await expect(sub(tx, (sp) => createStudent(sp, orgAdmin, { firstName: "ه", lastName: "و", studentNumber: "779", schoolId: f.SCHOOL_A, login: { createAccount: true, identifier: "s1-777" } }))).rejects.toSatisfy(
        isError("CONFLICT", MESSAGES.usernameTaken),
      );
      throw new Rollback();
    });
  });

  it("N1: a vice principal cannot mint a principal or a vice principal (FORBIDDEN, nothing written) but registers plain staff; a principal grants school roles at their own school only (other school NOT_FOUND, organization role FORBIDDEN); the pickers offer exactly that", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const vice = w.ctx.s2Vice;
      const intruder = { firstName: "نفوذی", lastName: "ناشناس", phone: "09127200030", schoolId: w.s2.schoolId };
      // The principal role is the organization admin's to give (M2), the vice role needs the school's permission the vice lacks.
      const refusal = { school_principal: MESSAGES.principalRoleForbidden, vice_principal: MESSAGES.roleGrantForbidden } as const;
      for (const roleCode of ["school_principal", "vice_principal"] as const) {
        await expect(sub(tx, (sp) => adminCreateStaff(sp, vice, { ...intruder, roles: [{ roleCode, schoolId: w.s2.schoolId }] }))).rejects.toSatisfy(isError("FORBIDDEN", refusal[roleCode]));
        // Service level (importer/CLI path) refuses BEFORE writing the person.
        await sub(tx, async (sp) => {
          const err = await createStaff(sp, vice, { ...intruder, roles: [{ roleCode, schoolId: w.s2.schoolId }] }).catch((e: unknown) => e);
          expect(err).toSatisfy(isError("FORBIDDEN", refusal[roleCode]));
          const people = await sp.execute<{ n: number }>(sql`select count(*)::int as n from iam.person where first_name = ${"نفوذی"}`);
          expect(Number(people.rows[0].n)).toBe(0);
        });
        // …and cannot promote an existing colleague either.
        await expect(sub(tx, (sp) => assignRole(sp, vice, { personId: w.s2Principal.personId, roleCode, schoolId: w.s2.schoolId }))).rejects.toSatisfy(isError("FORBIDDEN", refusal[roleCode]));
      }
      await expect(sub(tx, (sp) => adminCreateStaff(sp, vice, { ...intruder, roles: [{ roleCode: "org_admin" }] }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.orgRoleNotGrantable));
      await expect(sub(tx, (sp) => assignRole(sp, vice, { personId: w.s2Principal.personId, roleCode: "org_admin" }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.orgRoleNotGrantable));
      const before = await tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, w.s2Principal.personId), isNull(roleAssignment.revokedAt)));
      expect(before).toHaveLength(1);
      // The vice principal still registers plain staff at their school (iam.person.write).
      const plain = await adminCreateStaff(tx, vice, { firstName: "حسین", lastName: "محمدی", phone: "09127200030", schoolId: w.s2.schoolId });
      expect(plain.roleAssignmentIds).toEqual([]);
      expect((await getPersonDetail(tx, await getAdminScope(tx, vice), plain.personId)).staff?.schoolId).toBe(w.s2.schoolId);

      // A principal grants a vice principal at their own school…
      const principal = w.ctx.s2Principal;
      const newVice = await adminCreateStaff(tx, principal, { firstName: "نسرین", lastName: "قاسمی", phone: "09127200031", roles: [{ roleCode: "vice_principal", schoolId: w.s2.schoolId }] });
      expect(newVice.roleAssignmentIds).toHaveLength(1);
      const [granted] = await tx
        .select({ scopeType: roleAssignment.scopeType, schoolId: roleAssignment.schoolId, grantedBy: roleAssignment.grantedByPersonId, sourceType: roleAssignment.sourceType })
        .from(roleAssignment)
        .where(eq(roleAssignment.id, newVice.roleAssignmentIds[0]));
      expect(granted).toEqual({ scopeType: "school", schoolId: w.s2.schoolId, grantedBy: w.s2Principal.personId, sourceType: "manual" });
      const promoted = await assignRole(tx, principal, { personId: plain.personId, roleCode: "vice_principal", schoolId: w.s2.schoolId });
      expect(promoted.created).toBe(true);
      // …but not at another school (NOT_FOUND from the admin layer AND from the service, nothing written)…
      const s1Role = { firstName: "ب", lastName: "ج", phone: "09127200032", schoolId: w.s2.schoolId, roles: [{ roleCode: "vice_principal" as const, schoolId: f.SCHOOL_A }] };
      await expect(sub(tx, (sp) => adminCreateStaff(sp, principal, s1Role))).rejects.toSatisfy(isError("NOT_FOUND"));
      await sub(tx, async (sp) => {
        const err = await createStaff(sp, principal, s1Role).catch((e: unknown) => e);
        expect(err).toSatisfy(isError("NOT_FOUND"));
        expect(await sp.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.loginIdentifier, "+989127200032"))).toHaveLength(0);
      });
      await expect(sub(tx, (sp) => assignRole(sp, principal, { personId: w.s2Vice.personId, roleCode: "school_principal", schoolId: f.SCHOOL_A }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // …and never an organization role.
      await expect(sub(tx, (sp) => assignRole(sp, principal, { personId: w.s2Vice.personId, roleCode: "org_admin" }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.orgRoleNotGrantable));
      // The organization admin grants every SCHOOL role everywhere…
      expect((await assignRole(tx, orgAdmin, { personId: w.s1Teacher.personId, roleCode: "vice_principal", schoolId: f.SCHOOL_A })).created).toBe(true);
      // …but «مدیر سازمان» is nobody's to give — an organization has exactly ONE, and not even its own admin may
      // appoint a second one, from the admin surface or from the service (round 7). Nothing is written.
      await expect(sub(tx, (sp) => assignRole(sp, orgAdmin, { personId: w.s1Teacher.personId, roleCode: "org_admin" }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.orgRoleNotGrantable));
      await expect(sub(tx, (sp) => adminCreateStaff(sp, orgAdmin, { firstName: "دومی", lastName: "سازمان", phone: "09127200099", roles: [{ roleCode: "org_admin" }] }))).rejects.toSatisfy(
        isError("FORBIDDEN", MESSAGES.orgRoleNotGrantable),
      );
      await sub(tx, async (sp) => {
        const err = await createStaff(sp, orgAdmin, { firstName: "دومی", lastName: "سازمان", phone: "09127200099", roles: [{ roleCode: "org_admin" }] }).catch((e: unknown) => e);
        expect(err).toSatisfy(isError("FORBIDDEN", MESSAGES.orgRoleNotGrantable));
        const people = await sp.execute<{ n: number }>(sql`select count(*)::int as n from iam.person where first_name = ${"دومی"}`);
        expect(Number(people.rows[0].n)).toBe(0);
      });
      const stillOne = await tx
        .select({ id: roleAssignment.id })
        .from(roleAssignment)
        .where(and(eq(roleAssignment.scopeType, "organization"), eq(roleAssignment.sourceType, "manual"), isNull(roleAssignment.revokedAt)));
      expect(stillOne).toHaveLength(1);

      // The pickers are computed from the same assignments (docs/admin.md «ماتریس اعطای نقش»).
      const schools = [
        { value: f.SCHOOL_A, label: "مدرسه الف" },
        { value: w.s2.schoolId, label: "دبیرستان دوم" },
      ];
      expect(roleGrantOptions(vice.assignments, schools)).toEqual({ roles: [], schools: [] });
      expect(roleGrantOptions(principal.assignments, schools)).toEqual({ roles: ["vice_principal"], schools: [schools[1]] });
      // No picker offers «مدیر سازمان» — not even the organization admin's.
      expect(roleGrantOptions(orgAdmin.assignments, schools)).toEqual({ roles: ["school_principal", "vice_principal"], schools });
      throw new Rollback();
    });
  });

  it("N3: a student transferred out of a school (or whose enrollment ended) is no longer that school's to manage; an enrollment ending today still anchors; the organization admin keeps reach", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const student = await adminCreateStudent(tx, w.ctx.s2Principal, { firstName: "الهام", lastName: "جعفری", studentNumber: "S2-100", enrollment: { classGroupId: w.s2.classGroupId }, login: { createAccount: true } });
      const s2Scope = await getAdminScope(tx, w.ctx.s2Principal);
      expect((await getPersonDetail(tx, s2Scope, student.personId)).schoolIds).toEqual([w.s2.schoolId]);
      const setEnrollment = (patch: Record<string, unknown>) => tx.update(schoolEnrollment).set(patch).where(eq(schoolEnrollment.studentProfileId, student.studentProfileId));

      // Transferred out (the transition itself is a later block; the rows are updated directly here — the class
      // enrollment ends with the school enrollment).
      await tx.update(schema.classEnrollment).set({ status: "ended", endsOn: sql`current_date` }).where(eq(schema.classEnrollment.studentProfileId, student.studentProfileId));
      await setEnrollment({ status: "transferred_out", endsOn: sql`current_date`, exitReason: "transfer" });
      await expectUnreachable(tx, w.ctx.s2Principal, student.personId);
      await expectUnreachable(tx, w.ctx.s2Vice, student.personId);
      expect((await getPersonDetail(tx, await getAdminScope(tx, orgAdmin), student.personId)).schoolIds).toEqual([]);
      expect((await adminResetInitialPassword(tx, orgAdmin, student.personId)).loginIdentifier).toBe("s2-s2-100");
      // An `active` row that already ended is not an anchor either (dates CHECK: starts_on <= ends_on)…
      await setEnrollment({ status: "active", startsOn: sql`current_date - 10`, endsOn: sql`current_date - 1`, exitReason: null });
      await expectUnreachable(tx, w.ctx.s2Principal, student.personId);
      // …one ending today still is, and an open one of course.
      await setEnrollment({ endsOn: sql`current_date` });
      expect((await getPersonDetail(tx, s2Scope, student.personId)).id).toBe(student.personId);
      await setEnrollment({ endsOn: null });
      expect((await adminResetInitialPassword(tx, w.ctx.s2Principal, student.personId)).loginIdentifier).toBe("s2-s2-100");
      for (const status of ["withdrawn", "graduated"]) {
        await setEnrollment({ status });
        await expectUnreachable(tx, w.ctx.s2Principal, student.personId);
      }
      throw new Rollback();
    });
  });

  it("F3 residual: revoking another school's DERIVED teacher role is NOT_FOUND (no oracle); the explanation is reserved for admins who cover the offering's school", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      // The S1 teacher teaches at S1; the S2 vice principal is placed at S1 by the organization admin.
      await assignTeacher(tx, orgAdmin, { staffProfileId: w.s1Teacher.staffProfileId, classOfferingId: f.OFFERING_A1, role: "main" });
      await assignTeacher(tx, orgAdmin, { staffProfileId: w.s2Vice.staffProfileId, classOfferingId: f.OFFERING_A1, role: "assistant" });
      const derivedOf = async (personId: string) => {
        const rows = await tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, personId), eq(roleAssignment.sourceType, "teacher_assignment"), isNull(roleAssignment.revokedAt)));
        expect(rows).toHaveLength(1);
        return rows[0].id;
      };
      const s1TeacherRole = await derivedOf(w.s1Teacher.personId);
      const s2ViceRole = await derivedOf(w.s2Vice.personId);
      // Other school's teacher: NOT_FOUND — identical to an unknown id.
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s2Principal, { roleAssignmentId: s1TeacherRole }))).rejects.toSatisfy(isError("NOT_FOUND", "موردی یافت نشد."));
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s2Principal, { roleAssignmentId: "0199a000-ffff-7000-8000-00000000dead" }))).rejects.toSatisfy(isError("NOT_FOUND", "موردی یافت نشد."));
      // Own colleague teaching at ANOTHER school: the person is in scope, the offering's school is not → NOT_FOUND.
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s2Principal, { roleAssignmentId: s2ViceRole }))).rejects.toSatisfy(isError("NOT_FOUND", "موردی یافت نشد."));
      // S1's principal covers the offering but not the S2 colleague's person → NOT_FOUND; for their own teacher they get the explanation.
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s1Principal, { roleAssignmentId: s2ViceRole }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s1Principal, { roleAssignmentId: s1TeacherRole }))).rejects.toSatisfy(isError("VALIDATION", MESSAGES.derivedRoleNotRevocable));
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, orgAdmin, { roleAssignmentId: s2ViceRole }))).rejects.toSatisfy(isError("VALIDATION", MESSAGES.derivedRoleNotRevocable));
      // The vice principal (no iam.role_assignment.write) is FORBIDDEN on a manual role of their own school (a principal's
      // role names the organization admin as the only revoker — M2; a vice role the generic refusal), NOT_FOUND elsewhere.
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s2Vice, { roleAssignmentId: w.s2Principal.roleAssignmentId }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.principalRoleRevokeForbidden));
      const otherVice = await createStaff(tx, orgAdmin, { firstName: "مهسا", lastName: "رحیمی", phone: "09127200060", roles: [{ roleCode: "vice_principal", schoolId: w.s2.schoolId }] });
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s2Vice, { roleAssignmentId: otherVice.roleAssignmentIds[0] }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.roleRevokeForbidden));
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, w.ctx.s2Vice, { roleAssignmentId: w.s1Principal.roleAssignmentId }))).rejects.toSatisfy(isError("NOT_FOUND"));
      for (const id of [s1TeacherRole, s2ViceRole, w.s2Principal.roleAssignmentId, w.s1Principal.roleAssignmentId, otherVice.roleAssignmentIds[0]]) {
        const [row] = await tx.select({ revokedAt: roleAssignment.revokedAt }).from(roleAssignment).where(eq(roleAssignment.id, id));
        expect(row.revokedAt).toBeNull();
      }
      throw new Rollback();
    });
  });

  it("F4 gap: the `student` role is scope-checked (other school's student → NOT_FOUND) and its profile must belong to the person; a vice principal still registers students", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const s1Student = await adminCreateStudent(tx, w.ctx.s1Principal, { firstName: "الهام", lastName: "جعفری", studentNumber: "S1-904", enrollment: { classGroupId: f.CLASS_GROUP_A1 }, login: { createAccount: false } });
      const s1Other = await adminCreateStudent(tx, w.ctx.s1Principal, { firstName: "مینا", lastName: "رستمی", studentNumber: "S1-905", enrollment: { classGroupId: f.CLASS_GROUP_A1 }, login: { createAccount: false } });
      await expect(sub(tx, (sp) => assignRole(sp, w.ctx.s2Principal, { personId: s1Student.personId, roleCode: "student", studentProfileId: s1Student.studentProfileId }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // Own school: idempotent (the role already exists from createStudent).
      expect((await assignRole(tx, w.ctx.s1Principal, { personId: s1Student.personId, roleCode: "student", studentProfileId: s1Student.studentProfileId })).created).toBe(false);
      // A profile of another person is refused for everyone, the organization admin included.
      await expect(sub(tx, (sp) => assignRole(sp, orgAdmin, { personId: s1Student.personId, roleCode: "student", studentProfileId: s1Other.studentProfileId }))).rejects.toSatisfy(isError("INVALID_REFERENCE", MESSAGES.studentProfileMismatch));
      const roles = await tx.select({ scopeId: roleAssignment.scopeId }).from(roleAssignment).where(and(eq(roleAssignment.personId, s1Student.personId), isNull(roleAssignment.revokedAt)));
      expect(roles).toEqual([{ scopeId: s1Student.studentProfileId }]);
      // The student role rides on iam.person.write: a vice principal registers a student (with class or with school only) and the role is there.
      const viaVice = await adminCreateStudent(tx, w.ctx.s2Vice, { firstName: "رها", lastName: "نیکو", studentNumber: "S2-200", enrollment: { classGroupId: w.s2.classGroupId }, login: { createAccount: true } });
      const noClass = await adminCreateStudent(tx, w.ctx.s2Vice, { firstName: "ترانه", lastName: "علوی", studentNumber: "S2-201", schoolId: w.s2.schoolId, login: { createAccount: false } });
      for (const st of [viaVice, noClass]) {
        const r = await tx.select({ scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId }).from(roleAssignment).where(and(eq(roleAssignment.personId, st.personId), isNull(roleAssignment.revokedAt)));
        expect(r).toEqual([{ scopeType: "student", scopeId: st.studentProfileId }]);
      }
      throw new Rollback();
    });
  });

  it("M1: only the organization admin creates schools — the gate refuses a principal with the message, the resource with NOT_FOUND, nothing is written; principals still edit their own school (other school NOT_FOUND)", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const principal = w.ctx.s2Principal;
      const s2Scope = await getAdminScope(tx, principal);
      const input = { name: "مدرسهٴ چهارم", code: "S4", genderPolicy: "girls" as const, isDefault: false };
      // Action-level gate (adminResourceMutate; the list page hides «مدرسهٴ جدید» on the same verdict).
      expect(resourceOpGate(schoolResource, "create", principal.assignments, s2Scope)).toEqual({ ok: false, message: GATE_MESSAGES.createNeedsOrgScope("مدرسه") });
      expect(GATE_MESSAGES.createNeedsOrgScope("مدرسه")).toBe("ساختن مدرسهٴ جدید فقط با مدیر سازمان است.");
      expect(resourceOpGate(schoolResource, "create", w.ctx.s2Vice.assignments, s2Scope)).toEqual({ ok: false }); // no structure.write at all
      expect(resourceOpGate(schoolResource, "update", principal.assignments, s2Scope)).toEqual({ ok: true });
      expect(resourceOpGate(schoolResource, "update", w.ctx.s2Vice.assignments, s2Scope)).toEqual({ ok: false });
      // Resource level (second line): NOT_FOUND for a school scope, nothing written.
      await expect(sub(tx, (sp) => schoolResource.create(sp, resourceCtx(principal), s2Scope, input))).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await findSchoolByCode(tx, "S4")).toBeNull();
      // The organization admin creates it, default branch included.
      const orgScope = await getAdminScope(tx, orgAdmin);
      expect(resourceOpGate(schoolResource, "create", orgAdmin.assignments, orgScope)).toEqual({ ok: true });
      const created = await schoolResource.create(tx, resourceCtx(orgAdmin), orgScope, input);
      expect(await tx.select({ id: schema.branch.id }).from(schema.branch).where(eq(schema.branch.schoolId, created.id))).toHaveLength(1);
      // Principals edit their own school's details, never another's.
      await schoolResource.update(tx, resourceCtx(principal), s2Scope, w.s2.schoolId, { name: "دبیرستان دوم (ویرایش)", genderPolicy: "boys", isDefault: false });
      expect((await findSchoolById(tx, w.s2.schoolId))?.name).toBe("دبیرستان دوم (ویرایش)");
      await expect(sub(tx, (sp) => schoolResource.update(sp, resourceCtx(principal), s2Scope, f.SCHOOL_A, { name: "تغییر", genderPolicy: "boys", isDefault: false }))).rejects.toSatisfy(isError("NOT_FOUND"));
      throw new Rollback();
    });
  });

  it("M2: a principal appoints vice principals of their own schools only — granting `school_principal` is FORBIDDEN (nothing written), revoking a principal's role too; the organization admin does both; pickers and «لغو» mirror the rule", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const principal = w.ctx.s2Principal;
      const newcomer = { firstName: "پریسا", lastName: "نادری", phone: "09127200040", schoolId: w.s2.schoolId };
      // Principal → principal at own school: FORBIDDEN with the principal message — through createStaff (nothing written) and assignRole.
      await expect(sub(tx, (sp) => adminCreateStaff(sp, principal, { ...newcomer, roles: [{ roleCode: "school_principal", schoolId: w.s2.schoolId }] }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.principalRoleForbidden));
      await sub(tx, async (sp) => {
        const err = await createStaff(sp, principal, { ...newcomer, roles: [{ roleCode: "school_principal", schoolId: w.s2.schoolId }] }).catch((e: unknown) => e);
        expect(err).toSatisfy(isError("FORBIDDEN", MESSAGES.principalRoleForbidden));
        expect(await sp.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.loginIdentifier, "+989127200040"))).toHaveLength(0);
      });
      await expect(sub(tx, (sp) => assignRole(sp, principal, { personId: w.s2Vice.personId, roleCode: "school_principal", schoolId: w.s2.schoolId }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.principalRoleForbidden));
      // …at another school the school is invisible first (NOT_FOUND, no oracle).
      await expect(sub(tx, (sp) => assignRole(sp, principal, { personId: w.s2Vice.personId, roleCode: "school_principal", schoolId: f.SCHOOL_A }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // Vice principal at own school: OK; at another school: NOT_FOUND.
      const staff = await adminCreateStaff(tx, principal, newcomer);
      expect((await assignRole(tx, principal, { personId: staff.personId, roleCode: "vice_principal", schoolId: w.s2.schoolId })).created).toBe(true);
      await expect(sub(tx, (sp) => assignRole(sp, principal, { personId: staff.personId, roleCode: "vice_principal", schoolId: f.SCHOOL_A }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // Revoke mirrors grant: a second S2 principal (appointed by the organization admin) cannot be unseated by the first…
      const second = await adminCreateStaff(tx, orgAdmin, { firstName: "شیرین", lastName: "توکلی", phone: "09127200041", roles: [{ roleCode: "school_principal", schoolId: w.s2.schoolId }] });
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, principal, { roleAssignmentId: second.roleAssignmentIds[0] }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.principalRoleRevokeForbidden));
      // …nor their own principal role; the vice principal's role at their school they do revoke.
      await expect(sub(tx, (sp) => revokeRoleAssignment(sp, principal, { roleAssignmentId: w.s2Principal.roleAssignmentId }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.principalRoleRevokeForbidden));
      await revokeRoleAssignment(tx, principal, { roleAssignmentId: w.s2Vice.roleAssignmentId });
      for (const [id, revoked] of [
        [second.roleAssignmentIds[0], false],
        [w.s2Principal.roleAssignmentId, false],
        [w.s2Vice.roleAssignmentId, true],
      ] as const) {
        const [row] = await tx.select({ revokedAt: roleAssignment.revokedAt }).from(roleAssignment).where(eq(roleAssignment.id, id));
        expect(row.revokedAt !== null).toBe(revoked);
      }
      // The organization admin appoints and unseats principals.
      await revokeRoleAssignment(tx, orgAdmin, { roleAssignmentId: second.roleAssignmentIds[0] });
      expect((await assignRole(tx, orgAdmin, { personId: staff.personId, roleCode: "school_principal", schoolId: w.s2.schoolId })).created).toBe(true);
      // The UI mirrors (role pickers, «لغو» buttons) are computed from the same rule.
      expect(canManageRole(principal.assignments, "school_principal", w.s2.schoolId)).toBe(false);
      expect(canManageRole(principal.assignments, "vice_principal", w.s2.schoolId)).toBe(true);
      expect(canManageRole(principal.assignments, "vice_principal", f.SCHOOL_A)).toBe(false);
      expect(canManageRole(principal.assignments, "org_admin", null)).toBe(false);
      expect(canManageRole(w.ctx.s2Vice.assignments, "vice_principal", w.s2.schoolId)).toBe(false);
      expect(canManageRole(orgAdmin.assignments, "school_principal", w.s2.schoolId)).toBe(true);
      // نقش مدیر سازمان از هیچ رابط کاربری‌ای مدیریت نمی‌شود — حتی توسط یک مدیر سازمان (owner؛ یکتا و کد-محور).
      expect(canManageRole(orgAdmin.assignments, "org_admin", null)).toBe(false);
      const detail = await getPersonDetail(tx, await getAdminScope(tx, principal), staff.personId, principal.assignments);
      expect(detail.roles.map((r) => [r.roleCode, r.schoolId, r.revocable])).toEqual([
        ["school_principal", w.s2.schoolId, false],
        ["vice_principal", w.s2.schoolId, true],
      ]);
      throw new Rollback();
    });
  });

  it("M3: a vice principal grants no manager role but registers staff and students and sets, changes and ends the main teacher of an EXISTING offering of their school (derived teacher role follows); defining offerings or editing their hours/status stays structure.write", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const vice = w.ctx.s2Vice;
      const s2Scope = await getAdminScope(tx, vice);
      // Nothing managerial (own school: FORBIDDEN; the picker is empty).
      await expect(sub(tx, (sp) => assignRole(sp, vice, { personId: w.s2Principal.personId, roleCode: "vice_principal", schoolId: w.s2.schoolId }))).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.roleGrantForbidden));
      expect(roleGrantOptions(vice.assignments, [{ value: w.s2.schoolId }])).toEqual({ roles: [], schools: [] });
      // Plain staff at own school: OK, anchored there and offered in the teacher picker.
      const teacher = await adminCreateStaff(tx, vice, { firstName: "بهرام", lastName: "شریفی", phone: "09127200050", schoolId: w.s2.schoolId });
      expect(teacher.roleAssignmentIds).toEqual([]);
      expect((await staffOptions(tx, s2Scope)).map((o) => o.value)).toContain(teacher.staffProfileId);
      // Gate: the offerings page offers the vice principal «ویرایش» but not «ارائهٴ درس جدید»; the principal gets both.
      expect(resourceOpGate(offeringResource, "update", vice.assignments, s2Scope)).toEqual({ ok: true });
      expect(resourceOpGate(offeringResource, "create", vice.assignments, s2Scope)).toEqual({ ok: false });
      expect(resourceOpGate(offeringResource, "create", w.ctx.s2Principal.assignments, s2Scope)).toEqual({ ok: true });
      // Defining an offering: FORBIDDEN for a class the vice principal can see (structure), NOT_FOUND for another school's.
      const offeringInput = (classGroupId: string, termId: string, mainTeacherStaffProfileId: string | null) => ({ classGroupId, subjectId: f.SUBJECT_A, termId, mainTeacherStaffProfileId, weeklyHours: null, status: "active" as const });
      await expect(sub(tx, (sp) => offeringResource.create(sp, resourceCtx(vice), s2Scope, offeringInput(w.s2.classGroupId, w.s2.termId, null)))).rejects.toSatisfy(isError("FORBIDDEN", RESOURCE_MESSAGES.offeringCreateForbidden));
      await expect(sub(tx, (sp) => offeringResource.create(sp, resourceCtx(vice), s2Scope, offeringInput(f.CLASS_GROUP_A1, f.TERM_A, null)))).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await tx.select({ id: schema.classOffering.id }).from(schema.classOffering).where(eq(schema.classOffering.classGroupId, w.s2.classGroupId))).toHaveLength(1);
      // Setting the main teacher of the EXISTING offering: OK → teacher_assignment + the derived `teacher` role on that offering.
      await offeringResource.update(tx, resourceCtx(vice), s2Scope, w.s2.offeringId, offeringInput(w.s2.classGroupId, w.s2.termId, teacher.staffProfileId));
      const derived = () =>
        tx
          .select({ scopeType: roleAssignment.scopeType, classOfferingId: roleAssignment.classOfferingId, sourceType: roleAssignment.sourceType })
          .from(roleAssignment)
          .innerJoin(schema.role, eq(schema.role.id, roleAssignment.roleId))
          .where(and(eq(roleAssignment.personId, teacher.personId), eq(schema.role.code, "teacher"), isNull(roleAssignment.revokedAt)));
      expect(await derived()).toEqual([{ scopeType: "class_offering", classOfferingId: w.s2.offeringId, sourceType: "teacher_assignment" }]);
      // Hours/status are structure: FORBIDDEN and untouched for the vice principal; the same submit by the principal passes.
      const withTeacher = offeringInput(w.s2.classGroupId, w.s2.termId, teacher.staffProfileId);
      await expect(sub(tx, (sp) => offeringResource.update(sp, resourceCtx(vice), s2Scope, w.s2.offeringId, { ...withTeacher, weeklyHours: 3 }))).rejects.toSatisfy(isError("FORBIDDEN", RESOURCE_MESSAGES.offeringStructureForbidden));
      await expect(sub(tx, (sp) => offeringResource.update(sp, resourceCtx(vice), s2Scope, w.s2.offeringId, { ...withTeacher, status: "closed" }))).rejects.toSatisfy(isError("FORBIDDEN", RESOURCE_MESSAGES.offeringStructureForbidden));
      const offeringRow = () => tx.select({ weeklyHours: schema.classOffering.weeklyHours, status: schema.classOffering.status }).from(schema.classOffering).where(eq(schema.classOffering.id, w.s2.offeringId));
      expect(await offeringRow()).toEqual([{ weeklyHours: null, status: "active" }]);
      await offeringResource.update(tx, resourceCtx(w.ctx.s2Principal), s2Scope, w.s2.offeringId, { ...withTeacher, weeklyHours: 3 });
      expect((await offeringRow())[0].status).toBe("active");
      // The vice principal resubmits the form with the hours untouched and swaps the teacher: OK, the first teacher's derived role ends.
      await offeringResource.update(tx, resourceCtx(vice), s2Scope, w.s2.offeringId, { ...offeringInput(w.s2.classGroupId, w.s2.termId, w.s2Vice.staffProfileId), weeklyHours: 3 });
      expect(await derived()).toEqual([]);
      // Another school's staff still cannot be placed (F2); clearing the field ends the teaching.
      await expect(sub(tx, (sp) => offeringResource.update(sp, resourceCtx(vice), s2Scope, w.s2.offeringId, { ...offeringInput(w.s2.classGroupId, w.s2.termId, w.s1Teacher.staffProfileId), weeklyHours: 3 }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await offeringResource.update(tx, resourceCtx(vice), s2Scope, w.s2.offeringId, { ...offeringInput(w.s2.classGroupId, w.s2.termId, null), weeklyHours: 3 });
      expect(await tx.select({ id: schema.teacherAssignment.id }).from(schema.teacherAssignment).where(and(eq(schema.teacherAssignment.classOfferingId, w.s2.offeringId), isNull(schema.teacherAssignment.validTo)))).toHaveLength(0);
      // Another school's offering is NOT_FOUND even with the permission.
      await expect(sub(tx, (sp) => offeringResource.update(sp, resourceCtx(vice), s2Scope, f.OFFERING_A1, offeringInput(f.CLASS_GROUP_A1, f.TERM_A, teacher.staffProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      // Students: registered by the vice principal, with a class (the `student` role rides on iam.person.write).
      const student = await adminCreateStudent(tx, vice, { firstName: "رها", lastName: "نیکو", studentNumber: "S2-300", enrollment: { classGroupId: w.s2.classGroupId }, login: { createAccount: true } });
      expect(student.loginIdentifier).toBe("s2-s2-300");
      expect((await getPersonDetail(tx, s2Scope, student.personId)).enrollment?.classGroupId).toBe(w.s2.classGroupId);
      throw new Rollback();
    });
  });

  it("migration 0012 backfill: staff teaching at exactly one school and holding no manager role get that school; manager-role holders are left alone", async () => {
    const block = fs.readFileSync(path.resolve(process.cwd(), "drizzle", "0012_admin_scope_anchors.sql"), "utf8").match(/DO \$backfill\$[\s\S]*?\$backfill\$;/)?.[0];
    expect(block).toBeDefined();
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      // A plain teacher with no primary school (pre-0012 data) teaching at S2 only, and the S1 principal also teaching at S2.
      const plain = await createStaff(tx, orgAdmin, { firstName: "لیلا", lastName: "کریمی", phone: "09127200020" });
      await assignTeacher(tx, orgAdmin, { staffProfileId: plain.staffProfileId, classOfferingId: w.s2.offeringId, role: "main" });
      await assignTeacher(tx, orgAdmin, { staffProfileId: w.s1Principal.staffProfileId, classOfferingId: w.s2.offeringId, role: "assistant" });
      await tx.update(staffProfile).set({ schoolId: null }).where(eq(staffProfile.id, w.s1Principal.staffProfileId));
      // A teacher at two schools stays ambiguous (NULL).
      const two = await createStaff(tx, orgAdmin, { firstName: "نیلوفر", lastName: "باقری", phone: "09127200021" });
      await assignTeacher(tx, orgAdmin, { staffProfileId: two.staffProfileId, classOfferingId: w.s2.offeringId, role: "substitute" });
      await assignTeacher(tx, orgAdmin, { staffProfileId: two.staffProfileId, classOfferingId: f.OFFERING_A1, role: "main" });

      await tx.execute(sql.raw(block!));
      // The block clears the tenant context; restore it to read the outcome (test-only, mirrors global-setup).
      await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_A}, true)`);
      const rows = await tx.select({ id: staffProfile.id, schoolId: staffProfile.schoolId }).from(staffProfile).where(sql`${staffProfile.id} in (${plain.staffProfileId}, ${w.s1Principal.staffProfileId}, ${two.staffProfileId})`);
      const byId = new Map(rows.map((r) => [r.id, r.schoolId]));
      expect(byId.get(plain.staffProfileId)).toBe(w.s2.schoolId);
      expect(byId.get(w.s1Principal.staffProfileId)).toBeNull();
      expect(byId.get(two.staffProfileId)).toBeNull();
      throw new Rollback();
    });
  });
});
