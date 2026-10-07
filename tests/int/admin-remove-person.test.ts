// «حذف دانش‌آموز» / «حذف از کارکنان» (src/modules/iam/removal.ts, docs/admin.md «حذف دانش‌آموز / همکار»):
//   R1 a student's removal: archived, out of the class and the school (ended today, Tehran), withdrawn, roles revoked,
//      account disabled, sessions dead, membership left, initial password gone; ONE audit row; every live list,
//      roster, picker and counter drops them; a second call changes and writes nothing;
//   R2 a colleague's removal: teaching ended through the academic service (derived role revoked), manager roles
//      revoked, left today (Tehran); gone from the staff list, the teacher picker and the role picker;
//   R3 guards: yourself, the organization admin, out of scope / unknown (NOT_FOUND), a wrong kind, a caller without a
//      broad iam.person.write (a teacher, a student) — nothing written;
//   R4 school managers: own school's people only, never a role they could not revoke (a vice principal never
//      removes the principal), never another school's ties (teaching placed by the organization admin);
//   R5 the doors stay shut: temporary password, unlock, new account, class, teaching, request context;
//   R6 «رفع قفل» never re-enables a disabled account;
//   R7 the importer refuses rows naming a removed person;
//   R8 open work items drop them from the giver's count (an item whose remaining assignees are all done flips to
//      done); finished items, and open ones they had already done, keep them; a second call changes nothing.
// Everything runs inside withTenant transactions that end with Rollback; the catalog roles are seeded in beforeAll
// and the fixture database is re-created in afterAll (later files assert exact template lists).
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  auditLog,
  authIdentity,
  classEnrollment,
  inboxEntry,
  organizationMembership,
  person,
  roleAssignment,
  schoolEnrollment,
  staffProfile,
  studentProfile,
  teacherAssignment,
  userAccount,
  userSession,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { adminCounts } from "@/lib/admin/overview";
import { getPersonDetail, listStaff, listStudents, roleGrantCandidates } from "@/lib/admin/people";
import { staffOptions } from "@/lib/admin/resources";
import { listClassRoster } from "@/modules/academic/repo";
import { assignTeacher } from "@/modules/academic/service";
import { adminPlaceStudent, adminResetInitialPassword, adminUnlockAccount, type AdminCtx } from "@/modules/iam/admin";
import type { Assignment } from "@/modules/iam/can";
import { PERSON_REMOVED_MESSAGE } from "@/modules/iam/messages";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { canRemovePerson, removePerson, REMOVAL_MESSAGES } from "@/modules/iam/removal";
import { findMemberContext } from "@/modules/iam/repo";
import { assignRole, createAccountForPerson, createStaff, createStudent, getAdminScope, unlockAccount } from "@/modules/iam/service";
import type { ParsedWorkbook, Row } from "@/modules/integ/importers/parse";
import type { SheetKey } from "@/modules/integ/importers/template";
import { loadReference, validateImport } from "@/modules/integ/importers/validate";
import { createAcademicYear, createClassGroup, createClassOffering, createSchool } from "@/modules/tenancy/service";
import { filterActivePersonIds, listInbox, listOfferingRoster, searchPersons } from "@/modules/workspace/repo";
import { changeStatus, createWorkItem, WITHDRAWN_COMPLETION_NOTE } from "@/modules/workspace/service";
import { SYSTEM_ROLES } from "../../scripts/catalog";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
/** What a seeded role grants (scripts/catalog.ts SYSTEM_ROLES — what `pnpm seed` writes to iam.role_permission). */
const catalogPerms = (code: string): string[] => {
  const r = SYSTEM_ROLES.find((x) => x.code === code);
  if (!r) throw new Error(`catalog has no ${code}`);
  return [...r.permissions];
};

const orgAdminRole: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const principalOf = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: catalogPerms("school_principal") });
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: catalogPerms("vice_principal") });

const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const orgAdmin: AdminCtx = { orgId: f.ORG_A, personId: f.PERSON_A2, userId: null, requestId: "int-remove", assignments: [orgAdminRole] };
const asAdmin = (personId: string, ...assignments: Assignment[]): AdminCtx => ({ ...orgAdmin, personId, assignments });

const rolledBack = (fn: (tx: Tx) => Promise<void>) => expect(withTenant(tenant, fn)).rejects.toBeInstanceOf(Rollback);
const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
/** Runs `fn` in a savepoint so a failing statement never poisons the outer transaction. */
const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));
const removedError = isError("CONFLICT", PERSON_REMOVED_MESSAGE);

/** Today in Asia/Tehran as the database sees it (`YYYY-MM-DD`) — the date a removal ends things on. */
async function tehranToday(tx: Tx): Promise<string> {
  const res = await tx.execute<{ today: string }>(sql`select ((now() at time zone 'Asia/Tehran')::date)::text as today`);
  return res.rows[0].today;
}

async function liveSessions(tx: Tx, userAccountId: string): Promise<number> {
  return (await tx.select({ id: userSession.id }).from(userSession).where(and(eq(userSession.userAccountId, userAccountId), isNull(userSession.revokedAt)))).length;
}

async function addSessions(tx: Tx, userAccountId: string, n: number, tag: string): Promise<void> {
  for (let i = 0; i < n; i++) {
    await tx.insert(userSession).values({ userAccountId, tokenHash: `rm-${tag}-${i}`, currentOrgId: f.ORG_A, expiresAt: sql`now() + interval '1 day'` });
  }
}

const removedRows = (tx: Tx, personId: string) =>
  tx.select({ before: auditLog.before, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "iam.person.removed"), eq(auditLog.entityId, personId)));

interface World {
  s2: { schoolId: string; classGroupId: string; offeringId: string };
  orgAdminPerson: string;
  s1Principal: { personId: string };
  s1Vice: { personId: string; staffProfileId: string; roleAssignmentId: string };
  ctx: { s1Principal: AdminCtx; s1Vice: AdminCtx };
}

/** School S2 next to the fixture school S1 (f.SCHOOL_A), the organization's one real مدیر سازمان, and S1's principal and vice principal. */
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
  // The one مدیر سازمان is bootstrapped on itself, as the seeds do (nobody may grant `org_admin` to another person).
  const admin = await createStaff(tx, orgAdmin, { firstName: "محمد", lastName: "امینی", phone: "09127300001" });
  await assignRole(tx, asAdmin(admin.personId, orgAdminRole), { personId: admin.personId, roleCode: "org_admin" });
  const s1p = await createStaff(tx, orgAdmin, { firstName: "مریم", lastName: "رضایی", phone: "09127300002", roles: [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }] });
  const s1v = await createStaff(tx, orgAdmin, { firstName: "سارا", lastName: "کاظمی", phone: "09127300003", roles: [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }] });
  return {
    s2: { schoolId: s2.schoolId, classGroupId: cg.classGroupId, offeringId: off.classOfferingId },
    orgAdminPerson: admin.personId,
    s1Principal: { personId: s1p.personId },
    s1Vice: { personId: s1v.personId, staffProfileId: s1v.staffProfileId, roleAssignmentId: s1v.roleAssignmentIds[0] },
    ctx: { s1Principal: asAdmin(s1p.personId, principalOf(f.SCHOOL_A)), s1Vice: asAdmin(s1v.personId, viceOf(f.SCHOOL_A)) },
  };
}

describe("removing a student or a colleague", () => {
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

  it("R1: a student is archived, leaves the class and the school today (Tehran), loses every role and the login; one audit row; every live list drops them; a second call changes nothing", async () => {
    await rolledBack(async (tx) => {
      const s = await createStudent(tx, orgAdmin, {
        firstName: "نگار",
        lastName: "صادقی",
        studentNumber: "R-100",
        contactPhone: "09127300010",
        login: { createAccount: true },
        enrollment: { classGroupId: f.CLASS_GROUP_A1 },
      });
      const accountId = s.userAccountId!;
      await addSessions(tx, accountId, 2, "r1");
      const scope = await getAdminScope(tx, orgAdmin);
      const countsBefore = await adminCounts(tx, scope);
      const today = await tehranToday(tx);
      expect(await canRemovePerson(tx, orgAdmin, s.personId, "student")).toBe(true);

      const res = await removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" });
      expect(res).toEqual({
        personId: s.personId,
        kind: "student",
        alreadyRemoved: false,
        endedClassEnrollments: 1,
        endedSchoolEnrollments: 1,
        endedTeacherAssignments: 0,
        revokedRoleAssignments: 1,
        withdrawnWorkItems: 0,
        completedWorkItems: 0,
        revokedSessions: 2,
        accountDisabled: true,
      });

      expect((await tx.select({ status: person.status }).from(person).where(eq(person.id, s.personId)))[0].status).toBe("archived");
      expect((await tx.select({ status: studentProfile.status }).from(studentProfile).where(eq(studentProfile.id, s.studentProfileId)))[0].status).toBe("withdrawn");
      const ce = await tx.select({ status: classEnrollment.status, endsOn: classEnrollment.endsOn, reason: classEnrollment.changeReason }).from(classEnrollment).where(eq(classEnrollment.studentProfileId, s.studentProfileId));
      expect(ce).toEqual([{ status: "ended", endsOn: today, reason: "admin" }]);
      const se = await tx.select({ status: schoolEnrollment.status, endsOn: schoolEnrollment.endsOn, exitReason: schoolEnrollment.exitReason }).from(schoolEnrollment).where(eq(schoolEnrollment.studentProfileId, s.studentProfileId));
      expect(se).toEqual([{ status: "withdrawn", endsOn: today, exitReason: "removed" }]);
      expect(await tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, s.personId), isNull(roleAssignment.revokedAt)))).toEqual([]);

      // The login is gone for good: account disabled, no live session, membership left, no printable password.
      expect((await tx.select({ status: userAccount.status }).from(userAccount).where(eq(userAccount.id, accountId)))[0].status).toBe("disabled");
      expect(await liveSessions(tx, accountId)).toBe(0);
      const [m] = await tx.select({ status: organizationMembership.status, leftAt: organizationMembership.leftAt }).from(organizationMembership).where(eq(organizationMembership.personId, s.personId));
      expect(m.status).toBe("left");
      expect(m.leftAt).not.toBeNull();
      expect((await tx.select({ enc: authIdentity.initialPasswordEnc }).from(authIdentity).where(eq(authIdentity.userAccountId, accountId)))[0].enc).toBeNull();
      expect(await findMemberContext(tx, accountId)).toBeNull();

      const trail = await removedRows(tx, s.personId);
      expect(trail).toHaveLength(1);
      expect(trail[0].before).toEqual({ kind: "student", personStatus: "active", studentStatus: "active", staffLeftOn: null, membershipStatus: "active", accountStatus: "active" });
      expect(trail[0].after).toMatchObject({
        kind: "student",
        personStatus: "archived",
        studentStatus: "withdrawn",
        membershipStatus: "left",
        accountStatus: "disabled",
        counts: { classEnrollments: 1, schoolEnrollments: 1, teacherAssignments: 0, roleAssignments: 1, sessions: 2, workItems: 0 },
        clearedInitialPassword: true,
      });
      expect(JSON.stringify(trail)).not.toContain(s.initialPassword!);

      // Gone from every live surface: the list, the class roster (roll call and work items), the pickers, the counters.
      expect((await listStudents(tx, scope, { q: "", page: 1, pageSize: 500 })).rows.map((r) => r.personId)).not.toContain(s.personId);
      expect((await listClassRoster(tx, f.CLASS_GROUP_A1, today)).map((r) => r.personId)).not.toContain(s.personId);
      expect((await listOfferingRoster(tx, f.OFFERING_A1)).map((r) => r.personId)).not.toContain(s.personId);
      const reach = { scope, selfId: orgAdmin.personId };
      expect((await searchPersons(tx, "نگار", reach)).map((h) => h.id)).not.toContain(s.personId);
      expect(await filterActivePersonIds(tx, [s.personId], reach)).toEqual([]);
      const countsAfter = await adminCounts(tx, scope);
      expect(countsAfter.students).toBe(countsBefore.students - 1);
      expect(countsAfter.activeEnrollments).toBe(countsBefore.activeEnrollments - 1);

      // The organization admin still opens the file (history), with nothing left to remove.
      expect((await getPersonDetail(tx, scope, s.personId)).status).toBe("archived");
      expect(await canRemovePerson(tx, orgAdmin, s.personId, "student")).toBe(false);
      const again = await removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" });
      expect(again).toMatchObject({ alreadyRemoved: true, endedClassEnrollments: 0, endedSchoolEnrollments: 0, revokedRoleAssignments: 0, revokedSessions: 0 });
      expect(await removedRows(tx, s.personId)).toHaveLength(1);
      throw new Rollback();
    });
  });

  it("R2: a colleague's teaching ends through the academic service (derived teacher role revoked), manager roles are revoked, they leave today (Tehran); gone from the staff list and every picker", async () => {
    await rolledBack(async (tx) => {
      const c = await createStaff(tx, orgAdmin, { firstName: "حسین", lastName: "محمدی", phone: "09127300020", schoolId: f.SCHOOL_A });
      const ta = await assignTeacher(tx, orgAdmin, { staffProfileId: c.staffProfileId, classOfferingId: f.OFFERING_A1, role: "main" });
      const vp = await assignRole(tx, orgAdmin, { personId: c.personId, roleCode: "vice_principal", schoolId: f.SCHOOL_A });
      await addSessions(tx, c.userAccountId!, 1, "r2");
      const scope = await getAdminScope(tx, orgAdmin);
      const countsBefore = await adminCounts(tx, scope);
      const today = await tehranToday(tx);

      const res = await removePerson(tx, orgAdmin, { personId: c.personId, kind: "staff" });
      expect(res).toMatchObject({ alreadyRemoved: false, endedTeacherAssignments: 1, revokedRoleAssignments: 2, revokedSessions: 1, accountDisabled: true, endedClassEnrollments: 0 });

      const [t] = await tx.select({ validTo: teacherAssignment.validTo }).from(teacherAssignment).where(eq(teacherAssignment.id, ta.teacherAssignmentId));
      expect(t.validTo).not.toBeNull();
      const [derived] = await tx.select({ revokedAt: roleAssignment.revokedAt, validTo: roleAssignment.validTo }).from(roleAssignment).where(eq(roleAssignment.id, ta.roleAssignmentId));
      expect(derived.revokedAt).not.toBeNull();
      expect(derived.validTo).toBe(t.validTo);
      const [manual] = await tx.select({ revokedAt: roleAssignment.revokedAt }).from(roleAssignment).where(eq(roleAssignment.id, vp.roleAssignmentId));
      expect(manual.revokedAt).not.toBeNull();
      expect((await tx.select({ leftOn: staffProfile.leftOn }).from(staffProfile).where(eq(staffProfile.id, c.staffProfileId)))[0].leftOn).toBe(today);
      expect((await tx.select({ status: userAccount.status }).from(userAccount).where(eq(userAccount.id, c.userAccountId!)))[0].status).toBe("disabled");

      // The academic service wrote its own row for the teaching; the summary lists what a restore needs.
      expect((await tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, ta.teacherAssignmentId))).map((r) => r.action)).toContain("academic.teacher_assignment.ended");
      const [row] = await removedRows(tx, c.personId);
      expect(row.after).toMatchObject({ kind: "staff", staffLeftOn: today, endedTeacherAssignmentIds: [ta.teacherAssignmentId], revokedRoleAssignmentIds: [vp.roleAssignmentId] });

      expect((await listStaff(tx, scope, { q: "", page: 1, pageSize: 500 })).rows.map((r) => r.personId)).not.toContain(c.personId);
      expect((await staffOptions(tx, scope)).map((o) => o.value)).not.toContain(c.staffProfileId);
      expect((await roleGrantCandidates(tx, scope)).map((o) => o.value)).not.toContain(c.personId);
      const countsAfter = await adminCounts(tx, scope);
      expect(countsAfter.staff).toBe(countsBefore.staff - 1);
      expect(countsAfter.teachers).toBe(countsBefore.teachers - 1);
      expect(countsAfter.managerRoles).toBe(countsBefore.managerRoles - 1);
      expect(countsAfter.offeringsWithoutTeacher).toBe(countsBefore.offeringsWithoutTeacher + 1);
      throw new Rollback();
    });
  });

  it("R3: yourself (VALIDATION), the organization admin (FORBIDDEN; out of a school manager's reach), out of scope or unknown (NOT_FOUND), a wrong kind (VALIDATION), no broad iam.person.write (FORBIDDEN) — nothing written", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await expect(sub(tx, (sp) => removePerson(sp, orgAdmin, { personId: orgAdmin.personId, kind: "staff" }))).rejects.toSatisfy(isError("VALIDATION", REMOVAL_MESSAGES.self));
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Principal, { personId: w.s1Principal.personId, kind: "staff" }))).rejects.toSatisfy(isError("VALIDATION", REMOVAL_MESSAGES.self));

      // The one مدیر سازمان is never removed from a screen — not even by an organization-scoped caller.
      await expect(sub(tx, (sp) => removePerson(sp, orgAdmin, { personId: w.orgAdminPerson, kind: "staff" }))).rejects.toSatisfy(isError("FORBIDDEN", REMOVAL_MESSAGES.orgAdmin));
      expect(await canRemovePerson(tx, orgAdmin, w.orgAdminPerson, "staff")).toBe(false);
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Principal, { personId: w.orgAdminPerson, kind: "staff" }))).rejects.toSatisfy(isError("NOT_FOUND"));

      // Another school's student and an unknown id look the same to the S1 principal.
      const s2Student = await createStudent(tx, orgAdmin, { firstName: "بهار", lastName: "جعفری", studentNumber: "R-200", enrollment: { classGroupId: w.s2.classGroupId } });
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Principal, { personId: s2Student.personId, kind: "student" }))).rejects.toSatisfy(isError("NOT_FOUND", "موردی یافت نشد."));
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Principal, { personId: "0199a000-ffff-7000-8000-00000000dead", kind: "student" }))).rejects.toSatisfy(isError("NOT_FOUND", "موردی یافت نشد."));
      expect(await canRemovePerson(tx, w.ctx.s1Principal, s2Student.personId, "student")).toBe(false);

      await expect(sub(tx, (sp) => removePerson(sp, orgAdmin, { personId: s2Student.personId, kind: "staff" }))).rejects.toSatisfy(isError("VALIDATION", REMOVAL_MESSAGES.notStaff));
      await expect(sub(tx, (sp) => removePerson(sp, orgAdmin, { personId: w.s1Vice.personId, kind: "student" }))).rejects.toSatisfy(isError("VALIDATION", REMOVAL_MESSAGES.notStudent));

      // A teacher and a student hold no broad iam.person.write: FORBIDDEN before anything is looked at.
      const teacher = asAdmin(w.s1Vice.personId, { roleCode: "teacher", roleId: "t", scopeType: "class_offering", scopeId: f.OFFERING_A1, permissions: catalogPerms("teacher") });
      const student = asAdmin(f.PERSON_A1, { roleCode: "student", roleId: "s", scopeType: "student", scopeId: f.STUDENT_A1, permissions: catalogPerms("student") });
      for (const ctx of [teacher, student]) {
        await expect(sub(tx, (sp) => removePerson(sp, ctx, { personId: s2Student.personId, kind: "student" }))).rejects.toSatisfy(isError("FORBIDDEN"));
        expect(await canRemovePerson(tx, ctx, s2Student.personId, "student")).toBe(false);
      }

      expect((await tx.select({ status: person.status }).from(person).where(eq(person.id, s2Student.personId)))[0].status).toBe("active");
      expect((await tx.select({ status: person.status }).from(person).where(eq(person.id, w.orgAdminPerson)))[0].status).toBe("active");
      expect(await tx.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.action, "iam.person.removed"))).toEqual([]);
      throw new Rollback();
    });
  });

  it("R4: a school manager removes their own school's student and a vice principal they could revoke — never the principal, never someone tied to another school", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const own = await createStudent(tx, orgAdmin, { firstName: "دنیا", lastName: "هاشمی", studentNumber: "R-300", enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
      expect(await canRemovePerson(tx, w.ctx.s1Vice, own.personId, "student")).toBe(true);
      expect((await removePerson(tx, w.ctx.s1Vice, { personId: own.personId, kind: "student" })).alreadyRemoved).toBe(false);
      // Withdrawn, the student is anchored nowhere: out of the school's reach now (the organization admin keeps the file).
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Vice, { personId: own.personId, kind: "student" }))).rejects.toSatisfy(isError("NOT_FOUND"));

      // Removing is not a second door to unseating the principal: the vice principal could not revoke that role.
      expect(await canRemovePerson(tx, w.ctx.s1Vice, w.s1Principal.personId, "staff")).toBe(false);
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Vice, { personId: w.s1Principal.personId, kind: "staff" }))).rejects.toSatisfy(isError("FORBIDDEN", REMOVAL_MESSAGES.role("مدیر مدرسه")));

      // A colleague anchored at S1 who also teaches at S2 (placed by the organization admin): S2's teaching is not S1's to end.
      const t = await createStaff(tx, orgAdmin, { firstName: "وحید", lastName: "زارعی", phone: "09127300030", schoolId: f.SCHOOL_A });
      await assignTeacher(tx, orgAdmin, { staffProfileId: t.staffProfileId, classOfferingId: w.s2.offeringId, role: "main" });
      expect(await canRemovePerson(tx, w.ctx.s1Principal, t.personId, "staff")).toBe(false);
      await expect(sub(tx, (sp) => removePerson(sp, w.ctx.s1Principal, { personId: t.personId, kind: "staff" }))).rejects.toSatisfy(isError("FORBIDDEN", REMOVAL_MESSAGES.otherSchool));
      expect((await tx.select({ status: person.status }).from(person).where(eq(person.id, t.personId)))[0].status).toBe("active");
      expect((await removePerson(tx, orgAdmin, { personId: t.personId, kind: "staff" })).endedTeacherAssignments).toBe(1);

      // The principal could revoke a vice principal of their school on /admin/roles — so they may remove one.
      expect(await canRemovePerson(tx, w.ctx.s1Principal, w.s1Vice.personId, "staff")).toBe(true);
      const res = await removePerson(tx, w.ctx.s1Principal, { personId: w.s1Vice.personId, kind: "staff" });
      expect(res.revokedRoleAssignments).toBe(1);
      expect((await tx.select({ revokedAt: roleAssignment.revokedAt }).from(roleAssignment).where(eq(roleAssignment.id, w.s1Vice.roleAssignmentId)))[0].revokedAt).not.toBeNull();
      throw new Rollback();
    });
  });

  it("R5: no temporary password, unlock, new account, class or teaching for a removed person (CONFLICT «این شخص حذف شده است.»); the request context refuses them", async () => {
    await rolledBack(async (tx) => {
      const s = await createStudent(tx, orgAdmin, { firstName: "الهام", lastName: "نوری", studentNumber: "R-400", contactPhone: "09127300040", login: { createAccount: true }, enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
      const c = await createStaff(tx, orgAdmin, { firstName: "رضا", lastName: "کریمی", phone: "09127300041", schoolId: f.SCHOOL_A });
      const n = await createStudent(tx, orgAdmin, { firstName: "یاسمن", lastName: "احمدی", studentNumber: "R-402", schoolId: f.SCHOOL_A });
      await removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" });
      await removePerson(tx, orgAdmin, { personId: c.personId, kind: "staff" });
      await removePerson(tx, orgAdmin, { personId: n.personId, kind: "student" });

      await expect(sub(tx, (sp) => adminResetInitialPassword(sp, orgAdmin, s.personId))).rejects.toSatisfy(removedError);
      await expect(sub(tx, (sp) => adminResetInitialPassword(sp, orgAdmin, c.personId))).rejects.toSatisfy(removedError);
      await expect(sub(tx, (sp) => adminUnlockAccount(sp, orgAdmin, s.personId))).rejects.toSatisfy(removedError);
      await expect(sub(tx, (sp) => adminUnlockAccount(sp, orgAdmin, c.personId))).rejects.toSatisfy(removedError);
      await expect(sub(tx, (sp) => createAccountForPerson(sp, orgAdmin, { personId: n.personId, identifier: { loginIdentifier: "s1-r-402", phoneE164: null } }))).rejects.toSatisfy(removedError);
      await expect(sub(tx, (sp) => adminPlaceStudent(sp, orgAdmin, { personId: s.personId, classGroupId: f.CLASS_GROUP_A2 }))).rejects.toSatisfy(removedError);
      await expect(sub(tx, (sp) => assignTeacher(sp, orgAdmin, { staffProfileId: c.staffProfileId, classOfferingId: f.OFFERING_A1 }))).rejects.toSatisfy(removedError);

      for (const accountId of [s.userAccountId!, c.userAccountId!]) {
        expect((await tx.select({ status: userAccount.status }).from(userAccount).where(eq(userAccount.id, accountId)))[0].status).toBe("disabled");
        expect(await findMemberContext(tx, accountId)).toBeNull();
      }
      expect(await tx.select({ id: organizationMembership.id }).from(organizationMembership).where(eq(organizationMembership.personId, n.personId))).toEqual([]);
      expect(await tx.select({ id: classEnrollment.id }).from(classEnrollment).where(and(eq(classEnrollment.studentProfileId, s.studentProfileId), eq(classEnrollment.status, "active")))).toEqual([]);
      throw new Rollback();
    });
  });

  it("R6: «رفع قفل» lifts a lock but never re-enables a disabled account", async () => {
    await rolledBack(async (tx) => {
      const c = await createStaff(tx, orgAdmin, { firstName: "نرگس", lastName: "فرهادی", phone: "09127300050", schoolId: f.SCHOOL_A });
      const accountId = c.userAccountId!;
      const account = async () => (await tx.select({ status: userAccount.status, failed: userAccount.failedLoginCount }).from(userAccount).where(eq(userAccount.id, accountId)))[0];
      await tx.update(userAccount).set({ status: "disabled", failedLoginCount: 3 }).where(eq(userAccount.id, accountId));
      await unlockAccount(tx, orgAdmin, { userAccountId: accountId });
      expect(await account()).toEqual({ status: "disabled", failed: 0 });
      await tx.update(userAccount).set({ status: "locked", failedLoginCount: 20 }).where(eq(userAccount.id, accountId));
      await unlockAccount(tx, orgAdmin, { userAccountId: accountId });
      expect(await account()).toEqual({ status: "active", failed: 0 });
      throw new Rollback();
    });
  });

  it("R7: the importer flags removed people and refuses every row naming them (staff, teaching, students) — nothing is planned for them", async () => {
    await rolledBack(async (tx) => {
      const s = await createStudent(tx, orgAdmin, { firstName: "حنانه", lastName: "طاهری", studentNumber: "R-500", enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
      const c = await createStaff(tx, orgAdmin, { firstName: "یوسف", lastName: "کامرانی", phone: "09127300060", schoolId: f.SCHOOL_A });
      await removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" });
      await removePerson(tx, orgAdmin, { personId: c.personId, kind: "staff" });

      const row = (sheet: SheetKey, values: Record<string, string>): Row => ({ sheet, rowNumber: 2, raw: values, values });
      const parsed: ParsedWorkbook = {
        sheets: {
          classes: [],
          staff: [row("staff", { first_name: "یوسف", last_name: "کامرانی", phone: "+989127300060" })],
          teaching: [row("teaching", { teacher_phone: "+989127300060", class_name: "اول 1", subject: "ریاضی" })],
          students: [row("students", { first_name: "حنانه", last_name: "طاهری", student_number: "R-500", grade: "اول", class_name: "اول 1" })],
        },
        errors: [],
        ignoredSheets: [],
      };
      const ref = await loadReference(tx, { kind: "organization" }, "S1", parsed);
      expect(ref.staffByPhone.get("+989127300060")?.removed).toBe(true);
      expect(ref.studentsByNumber.get("R-500")?.removed).toBe(true);
      const v = validateImport(parsed, ref, { createSubjects: false });
      expect(v.ok).toBe(false);
      expect(v.plan.staff).toEqual([]);
      expect(v.plan.teaching).toEqual([]);
      expect(v.plan.students).toEqual([]);
      const issuesOf = (sheet: SheetKey) => v.rows.find((r) => r.sheet === sheet)?.issues ?? [];
      expect(issuesOf("staff")).toContainEqual({ column: "phone", message: PERSON_REMOVED_MESSAGE, level: "error" });
      expect(issuesOf("teaching")).toContainEqual({ column: "teacher_phone", message: PERSON_REMOVED_MESSAGE, level: "error" });
      expect(issuesOf("students")).toContainEqual({ column: "student_number", message: PERSON_REMOVED_MESSAGE, level: "error" });
      throw new Rollback();
    });
  });

  it("R8: a removed student leaves the count of OPEN work items (the last one pending → the item is done); finished items and open ones they had done keep them; a second call changes nothing", async () => {
    await rolledBack(async (tx) => {
      const mk = async (n: number, first: string) =>
        createStudent(tx, orgAdmin, { firstName: first, lastName: "کریمی", studentNumber: `R-80${n}`, contactPhone: `0912730008${n}`, login: { createAccount: true }, enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
      const s = await mk(1, "آرش");
      const t = await mk(2, "بهار");
      const u = await mk(3, "کاوه");
      const studentCtx = (personId: string, profileId: string): AdminCtx =>
        asAdmin(personId, { roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: catalogPerms("student") });
      const roster = (await listOfferingRoster(tx, f.OFFERING_A1)).map((r) => r.personId);
      // A class item of OFFERING_A1 given by the organization admin to exactly `to` (everyone else excluded).
      const give = async (title: string, to: string[]) =>
        (await createWorkItem(tx, orgAdmin, { typeCode: "task", title, priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: roster.filter((id) => !to.includes(id)) } })).id;
      const open = await give("تمرین باز", [s.personId, t.personId]);
      const finished = await give("تمرین بسته", [s.personId, t.personId]);
      await changeStatus(tx, orgAdmin, { workItemId: finished, toStatusCode: "done" });
      const lastPending = await give("تمرین آخر", [s.personId, t.personId]);
      await changeStatus(tx, studentCtx(t.personId, t.studentProfileId), { workItemId: lastPending, toStatusCode: "done" });
      const theyDid = await give("تمرین انجام‌شده", [s.personId, u.personId]);
      await changeStatus(tx, studentCtx(s.personId, s.studentProfileId), { workItemId: theyDid, toStatusCode: "done" });

      const giverRows = async () => new Map((await listInbox(tx, orgAdmin.personId, { tab: "all", createdByMe: true, limit: 100 })).rows.map((r) => [r.id, r]));
      const before = await giverRows();
      expect([open, finished, lastPending, theyDid].map((id) => before.get(id)!.assigneesTotal)).toEqual([2, 2, 2, 2]);
      expect(before.get(lastPending)!.category).toBe("todo");

      const res = await removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" });
      expect(res).toMatchObject({ alreadyRemoved: false, withdrawnWorkItems: 2, completedWorkItems: 1 });

      const after = await giverRows();
      // Open: «۰ از ۱» — only the classmate still here counts.
      expect(after.get(open)).toMatchObject({ assigneesTotal: 1, assigneesDone: 0, category: "todo" });
      // Finished before the removal: history, untouched.
      expect(after.get(finished)).toMatchObject({ assigneesTotal: 2, assigneesDone: 2, category: "done" });
      // The removed student was the last one pending: everyone left is done, so the item is done.
      expect(after.get(lastPending)).toMatchObject({ assigneesTotal: 1, assigneesDone: 1, category: "done", statusCode: "done" });
      // Open, but they had already done it: their «انجام شد» still counts.
      expect(after.get(theyDid)).toMatchObject({ assigneesTotal: 2, assigneesDone: 1, category: "todo" });

      // Their inbox entries of the two items they left are archived; the rest stay.
      const entries = new Map(
        (await tx.select({ workItemId: inboxEntry.workItemId, state: inboxEntry.state }).from(inboxEntry).where(eq(inboxEntry.personId, s.personId))).map((e) => [e.workItemId, e.state]),
      );
      expect(entries.get(open)).toBe("archived");
      expect(entries.get(lastPending)).toBe("archived");
      expect(entries.get(finished)).not.toBe("archived");
      expect(entries.get(theyDid)).not.toBe("archived");

      // The removal's audit row lists the rows taken out (what a restore re-inserts) and the item it closed; the
      // closed item has its own status row and a transition with the note.
      const [row] = await removedRows(tx, s.personId);
      const auditAfter = row.after as { counts: { workItems: number }; withdrawnWorkItemAssignees: Array<{ workItemId: string; state: string }>; completedWorkItemIds: string[] };
      expect(auditAfter.counts.workItems).toBe(2);
      expect(auditAfter.withdrawnWorkItemAssignees.map((w) => w.workItemId).sort()).toEqual([open, lastPending].sort());
      expect(auditAfter.withdrawnWorkItemAssignees.every((w) => w.state === "pending")).toBe(true);
      expect(auditAfter.completedWorkItemIds).toEqual([lastPending]);
      const closed = await tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "workspace.work_item.status_changed"), eq(auditLog.entityId, lastPending)));
      expect(closed.map((c) => c.after)).toContainEqual({ statusCode: "done", myState: null, note: WITHDRAWN_COMPLETION_NOTE, withdrawnPersonId: s.personId });

      // Idempotent: nothing left to take out, nothing written.
      const again = await removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" });
      expect(again).toMatchObject({ alreadyRemoved: true, withdrawnWorkItems: 0, completedWorkItems: 0 });
      expect(await removedRows(tx, s.personId)).toHaveLength(1);
      expect(await giverRows()).toEqual(after);
      throw new Rollback();
    });
  });
});
