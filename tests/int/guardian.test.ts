// «اولیا» — phase 1 (owner, 2026-10-18; migration 0020; src/modules/iam/{guardian,guardian-views,guardian-notify}.ts):
//   • 0020: iam.guardian_link under tenant RLS (ENABLE + FORCE), no DELETE for app_rw; another organization sees and
//     writes nothing;
//   • the account-identifier rules: a free phone → a phone login; a sibling's guardian → the SAME person and account;
//     a colleague's phone → the «ولی» role on the colleague's own account; a phone that is a STUDENT's login → never
//     merged, a separate `<school code>-v-<student number>` account; never yourself; a removed student gets no guardian;
//   • a guardian reads ONLY their live children (the تکالیف given to them — never the child's personal notes —,
//     attendance, report card, week) and switches between siblings; another student, the counseling file and the admin
//     pages are out of reach; nothing a guardian holds writes;
//   • a teacher who is also a parent wears both hats with no bleed between them;
//   • «ساخت حساب اولیا» is idempotent; the sheet and «تعیین رمز موقت» never let a school's manager act as a guardian
//     whose child is at another school;
//   • removing a student ends their links and closes a guardian left with no child; a new link opens it again;
//   • «غیبت» reaches the guardian once per child per roll call, with the child's name and nothing else; the monthly
//     report-card notification once per child per month.
// The catalog is seeded in beforeAll; every write runs inside a withTenant transaction that ends with Rollback;
// afterAll re-creates the fixture database (later files assert exact fixture counts).
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, guardianLink, notification, organizationMembership, roleAssignment, userAccount, authIdentity } from "@/db/schema";
import { tehranToday } from "@/lib/attendance";
import { AppError } from "@/lib/errors";
import { getSessionForTaking, studentAttendanceSummary, takeAttendance } from "@/modules/academic/attendance";
import { myReportCard } from "@/modules/academic/report-card";
import { assignTeacher } from "@/modules/academic/service";
import { getStudentFile } from "@/modules/counseling/service";
import { type Assignment, can, canAtAnyScope } from "@/modules/iam/can";
import { GUARDIAN_MESSAGES, addGuardian, bulkCreateClassGuardians, listClassGuardianCredentials, listGuardiansOfStudent, resetGuardianPassword, unlinkGuardian } from "@/modules/iam/guardian";
import { notifyGuardiansOfReportCard } from "@/modules/iam/guardian-notify";
import { listChildWorkItems, listMyChildren, requireChild } from "@/modules/iam/guardian-views";
import { getHats } from "@/modules/iam/hats";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { removePerson } from "@/modules/iam/removal";
import { listValidAssignments } from "@/modules/iam/repo";
import { MESSAGES, assignRole, createStaff, createStudent, getAdminScope } from "@/modules/iam/service";
import { createAcademicYear, createClassGroup, createSchool } from "@/modules/tenancy/service";
import { searchPersons } from "@/modules/workspace/repo";
import { addComment, changeStatus, createWorkItem, personReach } from "@/modules/workspace/service";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { PG, Rollback, asAppRw, pgCode } from "./helpers";

interface Actor {
  orgId: string;
  personId: string;
  userId: null;
  requestId: string;
  assignments: Assignment[];
}

const ALL = PERMISSIONS.map((p) => p.code);
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
/** A savepoint, so a failing statement never poisons the test's transaction. */
const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));
const phone = (n: number) => `0912751${String(n).padStart(4, "0")}`;
const e164 = (n: number) => `+98912751${String(n).padStart(4, "0")}`;

async function actor(tx: Tx, personId: string): Promise<Actor> {
  return { orgId: f.ORG_A, personId, userId: null, requestId: "int-guardian", assignments: await listValidAssignments(tx, personId) };
}

/** Runs `fn` in a tenant transaction that always rolls back; a failure inside surfaces as itself (not as «not a Rollback»). */
async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withTenant(tenant, async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  throw new Error("the transaction was expected to roll back");
}

interface Student {
  studentProfileId: string;
  personId: string;
  name: string;
}

interface World {
  admin: Actor;
  adminPhone: string;
  principalA: Actor;
  teacher: Actor;
  teacherPhone: string;
  schoolB: { schoolId: string; classGroupId: string };
  /** Class A1 (taught by `teacher`), «ولی» phone 1. */
  s1: Student;
  /** Class A2, «ولی» phone 1 too — s1's sibling. */
  s2: Student;
  /** Class A1, «ولی» phone 3. */
  s3: Student;
  /** Class A1, no «ولی» phone. */
  sNone: Student;
  /** Class A1: logs in with phone 4 — which is ALSO their «ولی» phone (a young child on the parent's number). */
  sPhone: Student;
  /** School B. */
  sB: Student;
  sB2: Student;
}

async function buildWorld(tx: Tx): Promise<World> {
  const bootstrap: Actor = { orgId: f.ORG_A, personId: f.PERSON_A2, userId: null, requestId: "int-guardian", assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }] };
  // The organization admin HAS an account (its phone must be a login for the «never yourself» probe).
  const adminP = await createStaff(tx, bootstrap, { firstName: "محمد", lastName: "امینی", phone: phone(1) });
  await assignRole(tx, { ...bootstrap, personId: adminP.personId }, { personId: adminP.personId, roleCode: "org_admin" });
  const admin = await actor(tx, adminP.personId);

  const s2School = await createSchool(tx, admin, { name: "دبیرستان دوم", code: "S2", genderPolicy: "girls" });
  const year = await createAcademicYear(tx, admin, {
    schoolId: s2School.schoolId,
    name: "۱۴۰۵-۱۴۰۶",
    startsOn: "2026-09-23",
    endsOn: "2027-06-21",
    isCurrent: true,
    terms: [{ name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" }],
  });
  const cgB = await createClassGroup(tx, admin, { branchId: s2School.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "۸/۱" });

  const pA = await createStaff(tx, admin, { firstName: "مریم", lastName: "رضایی", phone: phone(2), createAccount: false, roles: [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }] });
  const t = await createStaff(tx, admin, { firstName: "علی", lastName: "حسینی", phone: phone(3), schoolId: f.SCHOOL_A });
  await assignTeacher(tx, admin, { staffProfileId: t.staffProfileId, classOfferingId: f.OFFERING_A1 });

  const student = async (firstName: string, lastName: string, number: string, classGroupId: string, opts: { guardianPhone?: string; contactPhone?: string } = {}): Promise<Student> => {
    const res = await createStudent(tx, admin, {
      firstName,
      lastName,
      studentNumber: number,
      guardianPhone: opts.guardianPhone ?? null,
      contactPhone: opts.contactPhone ?? null,
      enrollment: { classGroupId },
      login: { createAccount: true },
    });
    return { studentProfileId: res.studentProfileId, personId: res.personId, name: `${firstName} ${lastName}` };
  };
  const s1 = await student("لیلا", "نیک‌خواه", "G-1", f.CLASS_GROUP_A1, { guardianPhone: phone(11) });
  const s2 = await student("سارا", "نیک‌خواه", "G-2", f.CLASS_GROUP_A2, { guardianPhone: phone(11) });
  const s3 = await student("نگار", "رضایی", "G-3", f.CLASS_GROUP_A1, { guardianPhone: phone(13) });
  const sNone = await student("مینا", "یوسفی", "G-4", f.CLASS_GROUP_A1);
  const sPhone = await student("آوا", "باقری", "G-5", f.CLASS_GROUP_A1, { guardianPhone: phone(14), contactPhone: phone(14) });
  const sB = await student("رها", "شریفی", "G-6", cgB.classGroupId, { guardianPhone: phone(16) });
  const sB2 = await student("پریا", "کریمی", "G-7", cgB.classGroupId, { guardianPhone: phone(17) });
  return {
    admin,
    adminPhone: phone(1),
    principalA: await actor(tx, pA.personId),
    teacher: await actor(tx, t.personId),
    teacherPhone: phone(3),
    schoolB: { schoolId: s2School.schoolId, classGroupId: cgB.classGroupId },
    s1,
    s2,
    s3,
    sNone,
    sPhone,
    sB,
    sB2,
  };
}

const add = (tx: Tx, who: Actor, s: Student, n: number | string, relation = "mother", names = { firstName: "زهره", lastName: "نیک‌خواه" }) =>
  addGuardian(tx, who, { studentProfileId: s.studentProfileId, ...names, phone: typeof n === "number" ? phone(n) : n, relation });

describe("«اولیا» — guardians", () => {
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

  it("migration 0020: iam.guardian_link is tenant-isolated (ENABLE + FORCE, tenant_isolation) and app_rw may not DELETE it", async () => {
    await asAppRw(async (c) => {
      const rls = await c.query<{ enabled: boolean; forced: boolean }>(
        `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'iam' and c.relname = 'guardian_link'`,
      );
      expect(rls.rows).toEqual([{ enabled: true, forced: true }]);
      const policies = await c.query<{ policyname: string; cmd: string }>(`select policyname, cmd from pg_policies where schemaname = 'iam' and tablename = 'guardian_link'`);
      expect(policies.rows).toEqual([{ policyname: "tenant_isolation", cmd: "ALL" }]);
      const priv = await c.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
        `select has_table_privilege('app_rw', 'iam.guardian_link', 'SELECT') as s, has_table_privilege('app_rw', 'iam.guardian_link', 'INSERT') as i,
                has_table_privilege('app_rw', 'iam.guardian_link', 'UPDATE') as u, has_table_privilege('app_rw', 'iam.guardian_link', 'DELETE') as d`,
      );
      expect(priv.rows).toEqual([{ s: true, i: true, u: true, d: false }]);
      // The re-created apply_grants kept every earlier rule.
      const kept = await c.query<{ audit_u: boolean; note_d: boolean; perm_i: boolean }>(
        `select has_table_privilege('app_rw', 'audit.audit_log', 'UPDATE') as audit_u, has_table_privilege('app_rw', 'counseling.counselor_note', 'DELETE') as note_d,
                has_table_privilege('app_rw', 'iam.permission', 'INSERT') as perm_i`,
      );
      expect(kept.rows).toEqual([{ audit_u: false, note_d: false, perm_i: false }]);
    });
  });

  it("tenant isolation: another organization reads no link and cannot write one into A", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const { linkId } = await add(tx, w.admin, w.s1, 11);
      expect((await tx.select({ id: guardianLink.id }).from(guardianLink).where(eq(guardianLink.id, linkId))).length).toBe(1);
      // The same transaction, re-bound to organization B: the row is not there for B.
      await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_B}, true)`);
      expect((await tx.select({ id: guardianLink.id }).from(guardianLink)).length).toBe(0);
      await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_A}, true)`);
    });
    await asAppRw(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        // A row claiming organization B, written under A's context: the WITH CHECK refuses it.
        await expect(
          c.query(`insert into iam.guardian_link (id, organization_id, guardian_person_id, student_profile_id, relation) values (app.uuid_generate_v7(), $1, $2, $3, 'mother')`, [f.ORG_B, f.PERSON_B1, f.STUDENT_B1]),
        ).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("the phone rules: a new phone login; a sibling → the same person and account; a colleague → their own account; a student's login → a separate username; never yourself", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const first = await add(tx, w.admin, w.s1, 11);
      expect(first).toMatchObject({ accountKind: "new_phone", alreadyLinked: false });
      expect(first.account?.loginIdentifier).toBe(e164(11));
      expect(first.account?.initialPassword).toMatch(/^\S{6,}$/);
      const [acct] = await tx.select({ mustChange: userAccount.mustChangePassword, id: userAccount.id }).from(userAccount).where(eq(userAccount.loginIdentifier, e164(11)));
      expect(acct.mustChange).toBe(true);
      const [ident] = await tx.select({ enc: authIdentity.initialPasswordEnc }).from(authIdentity).where(eq(authIdentity.userAccountId, acct.id));
      expect(ident.enc).not.toBeNull();
      // The derived «ولی» role: scoped to THIS child, sourced from the link.
      const roles = await tx
        .select({ scopeType: roleAssignment.scopeType, studentProfileId: roleAssignment.studentProfileId, sourceType: roleAssignment.sourceType, sourceId: roleAssignment.sourceId })
        .from(roleAssignment)
        .where(and(eq(roleAssignment.personId, first.guardianPersonId), sql`${roleAssignment.revokedAt} is null`));
      expect(roles).toEqual([{ scopeType: "student", studentProfileId: w.s1.studentProfileId, sourceType: "guardian_relationship", sourceId: first.linkId }]);
      // The first guardian of a student is its primary one.
      const [link] = await tx.select({ isPrimary: guardianLink.isPrimary, relation: guardianLink.relation }).from(guardianLink).where(eq(guardianLink.id, first.linkId));
      expect(link).toEqual({ isPrimary: true, relation: "mother" });

      // The sibling: the same phone is the same guardian — one person, one login, no new password.
      const sibling = await add(tx, w.admin, w.s2, 11, "mother");
      expect(sibling).toMatchObject({ accountKind: "existing", guardianPersonId: first.guardianPersonId, account: null, alreadyLinked: false });
      const again = await add(tx, w.admin, w.s2, 11, "father");
      expect(again).toMatchObject({ alreadyLinked: true, guardianPersonId: first.guardianPersonId });
      const [rel] = await tx.select({ relation: guardianLink.relation }).from(guardianLink).where(eq(guardianLink.id, sibling.linkId));
      expect(rel.relation).toBe("father"); // the relation is per link, and updated in place

      // A colleague who is also a parent: the role joins THEIR person and account — no second login.
      const accountsBefore = (await tx.select({ id: userAccount.id }).from(userAccount)).length;
      const staff = await add(tx, w.admin, w.sB, w.teacherPhone, "father", { firstName: "علی", lastName: "حسینی" });
      expect(staff).toMatchObject({ accountKind: "staff", guardianPersonId: w.teacher.personId, account: null });
      expect((await tx.select({ id: userAccount.id }).from(userAccount)).length).toBe(accountsBefore);

      // A phone that is a STUDENT's login (the child signs in with the parent's number): never merged.
      const viaStudentPhone = await add(tx, w.admin, w.sPhone, 14, "father", { firstName: "رضا", lastName: "باقری" });
      expect(viaStudentPhone.accountKind).toBe("new_username");
      expect(viaStudentPhone.guardianPersonId).not.toBe(w.sPhone.personId);
      expect(viaStudentPhone.account?.loginIdentifier).toBe("s1-v-g-5");
      const studentLogin = await tx
        .select({ login: userAccount.loginIdentifier })
        .from(organizationMembership)
        .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
        .where(eq(organizationMembership.personId, w.sPhone.personId));
      expect(studentLogin).toEqual([{ login: e164(14) }]);
      // …and that guardian is found by its phone for a sibling, without another username.
      expect((await add(tx, w.admin, w.s3, 14, "father", { firstName: "رضا", lastName: "باقری" })).guardianPersonId).toBe(viaStudentPhone.guardianPersonId);

      // Never yourself: the organization admin's own phone.
      await expect(sub(tx, (sp) => add(sp, w.admin, w.s1, w.adminPhone, "father", { firstName: "محمد", lastName: "امینی" }))).rejects.toSatisfy(isError("FORBIDDEN", GUARDIAN_MESSAGES.self));
      // Invalid input never reaches a write.
      await expect(sub(tx, (sp) => add(sp, w.admin, w.s1, "12345"))).rejects.toSatisfy(isError("VALIDATION"));
      await expect(sub(tx, (sp) => add(sp, w.admin, w.s1, 18, "uncle"))).rejects.toSatisfy(isError("VALIDATION"));
    });
  });

  it("who may add: a principal of school A for A's students only (B's student is NOT_FOUND); a teacher not at all (FORBIDDEN); the guardian card lists the live links without a password", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await expect(sub(tx, (sp) => add(sp, w.principalA, w.sB, 21))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => add(sp, w.teacher, w.s1, 21))).rejects.toSatisfy(isError("FORBIDDEN"));
      const ok = await add(tx, w.principalA, w.s1, 11);
      expect(ok.accountKind).toBe("new_phone");
      const card = await listGuardiansOfStudent(tx, w.principalA, w.s1.personId);
      expect(card).toHaveLength(1);
      expect(card[0]).toMatchObject({ linkId: ok.linkId, relation: "mother", isPrimary: true, phone: e164(11), loginIdentifier: e164(11), isStaff: false, manageable: true, mustChangePassword: true });
      expect(JSON.stringify(card)).not.toMatch(/password_enc|initialPassword/);
      await expect(sub(tx, (sp) => listGuardiansOfStudent(sp, w.principalA, w.sB.personId))).rejects.toSatisfy(isError("NOT_FOUND"));
    });
  });

  it("a guardian reads ONLY their live children — the تکالیف given to them (never the child's own notes), attendance — and switches between siblings; everything else is NOT_FOUND / FORBIDDEN; nothing writes", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const g = (await add(tx, w.admin, w.s1, 11)).guardianPersonId;
      await add(tx, w.admin, w.s2, 11);
      await add(tx, w.admin, w.s3, 13);
      const guardian = await actor(tx, g);

      // The derived assignments: two children, read-only permissions, student scope only.
      expect(guardian.assignments.map((a) => [a.roleCode, a.scopeType, a.scopeId]).sort()).toEqual(
        [
          ["guardian_full", "student", w.s1.studentProfileId],
          ["guardian_full", "student", w.s2.studentProfileId],
        ].sort(),
      );
      for (const a of guardian.assignments) for (const p of a.permissions) expect(p, p).toMatch(/\.read$/);
      for (const p of ["workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment", "academic.attendance.write", "academic.objective_rating.write", "iam.admin.access", "counseling.case.read"] as const) {
        expect(canAtAnyScope(guardian.assignments, p), p).toBe(false);
      }

      // Children and the switch: none requested = the first; a sibling by id; anyone else NOT_FOUND.
      const children = await listMyChildren(tx, guardian);
      expect(children.map((c) => c.studentProfileId).sort()).toEqual([w.s1.studentProfileId, w.s2.studentProfileId].sort());
      expect(children.find((c) => c.studentProfileId === w.s1.studentProfileId)).toMatchObject({ className: "اول 1", relation: "mother" });
      const firstPick = await requireChild(tx, guardian, undefined, "workspace.work_item.read");
      expect(firstPick.child.studentProfileId).toBe(children[0].studentProfileId);
      expect((await requireChild(tx, guardian, w.s2.studentProfileId, "academic.attendance.read")).child.studentProfileId).toBe(w.s2.studentProfileId);
      for (const other of [w.s3, w.sNone, w.sB]) {
        await expect(sub(tx, (sp) => requireChild(sp, guardian, other.studentProfileId, "workspace.work_item.read"))).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      // The organization admin holds every permission at the organization — and is still nobody's guardian here.
      await expect(sub(tx, (sp) => requireChild(sp, w.admin, w.s1.studentProfileId, "workspace.work_item.read"))).rejects.toSatisfy(isError("NOT_FOUND"));

      // تکالیف: the teacher's class task is listed with the CHILD's state; the child's own «تسک» and personal note are not.
      const homework = await createWorkItem(tx, w.teacher, { typeCode: "task", title: "تمرین صفحهٴ ۴۲", priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } });
      const childCtx = await actor(tx, w.s1.personId);
      await createWorkItem(tx, childCtx, { typeCode: "todo", title: "یادداشت خصوصی لیلا", priority: "normal", recipients: { kind: "self" } });
      await createWorkItem(tx, childCtx, { typeCode: "task", title: "تسک خودم", priority: "normal", recipients: { kind: "self" } });
      let rows = await listChildWorkItems(tx, { personId: w.s1.personId });
      expect(rows.map((r) => r.title)).toEqual(["تمرین صفحهٴ ۴۲"]);
      expect(rows[0]).toMatchObject({ category: "todo", createdByMe: false, unread: false, assigneesTotal: 0 });
      await changeStatus(tx, childCtx, { workItemId: homework.id, toStatusCode: "done" });
      rows = await listChildWorkItems(tx, { personId: w.s1.personId });
      expect(rows[0].category).toBe("done");

      // …and the guardian cannot open, mark or comment on it.
      await expect(sub(tx, (sp) => changeStatus(sp, guardian, { workItemId: homework.id, toStatusCode: "open" }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => addComment(sp, guardian, { workItemId: homework.id, body: "سلام" }))).rejects.toSatisfy(isError("NOT_FOUND"));

      // Attendance: the child's own summary through the guardian's student-scoped permission; another student NOT_FOUND.
      const range = { from: "2026-09-23", to: tehranToday() };
      expect((await studentAttendanceSummary(tx, guardian, { studentProfileId: w.s1.studentProfileId, ...range })).studentName).toBe(w.s1.name);
      await expect(sub(tx, (sp) => studentAttendanceSummary(sp, guardian, { studentProfileId: w.s3.studentProfileId, ...range }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // No roll call of the child's class, no write of it.
      await expect(sub(tx, (sp) => getSessionForTaking(sp, guardian, { classGroupId: f.CLASS_GROUP_A1, date: tehranToday() }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => takeAttendance(sp, guardian, { classGroupId: f.CLASS_GROUP_A1, date: tehranToday(), entries: [{ studentProfileId: w.s1.studentProfileId, status: "present" }] }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // «کارنامهٴ من» is the reader's OWN card — a guardian has none.
      expect(await myReportCard(tx, guardian, {})).toBeNull();

      // Counseling, the admin pages, the recipient picker: out of reach.
      await expect(sub(tx, (sp) => getStudentFile(sp, guardian, w.s1.studentProfileId))).rejects.toSatisfy((e: unknown) => AppError.is(e) && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND"));
      await expect(sub(tx, (sp) => getAdminScope(sp, guardian))).rejects.toSatisfy(isError("FORBIDDEN"));
      await expect(sub(tx, (sp) => listGuardiansOfStudent(sp, guardian, w.s1.personId))).rejects.toSatisfy(isError("FORBIDDEN"));
      await expect(sub(tx, (sp) => personReach(sp, guardian))).rejects.toSatisfy(isError("FORBIDDEN"));
      // A class or school scope is never reached through a child.
      expect(await can(tx, guardian, "academic.attendance.read", { scopeType: "class_group", id: f.CLASS_GROUP_A1 })).toBe(false);
      expect(await can(tx, guardian, "workspace.work_item.read", { scopeType: "school", id: f.SCHOOL_A })).toBe(false);
      expect(await can(tx, guardian, "workspace.work_item.read")).toBe(false);
    });
  });

  it("a teacher who is also a parent wears both hats with no bleed: the child of another school is readable as a guardian, nothing else of that school is; the teaching reach is unchanged", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await add(tx, w.admin, w.sB, w.teacherPhone, "father", { firstName: "علی", lastName: "حسینی" });
      const teacher = await actor(tx, w.teacher.personId);
      expect(teacher.assignments.map((a) => a.roleCode).sort()).toEqual(["guardian_full", "teacher"]);
      const hats = await getHats(tx, teacher);
      expect(hats).toMatchObject({ isGuardian: true, isStudent: false });
      expect(hats.teachingOfferings.map((o) => o.offeringId)).toEqual([f.OFFERING_A1]);

      expect((await listMyChildren(tx, teacher)).map((c) => c.studentProfileId)).toEqual([w.sB.studentProfileId]);
      const range = { from: "2026-09-23", to: tehranToday() };
      expect((await studentAttendanceSummary(tx, teacher, { studentProfileId: w.sB.studentProfileId, ...range })).studentName).toBe(w.sB.name);
      // The guardian hat opens ONE child: not the classmate, not the class, not the school B roll call.
      await expect(sub(tx, (sp) => studentAttendanceSummary(sp, teacher, { studentProfileId: w.sB2.studentProfileId, ...range }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => requireChild(sp, teacher, w.sB2.studentProfileId, "academic.attendance.read"))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => getSessionForTaking(sp, teacher, { classGroupId: w.schoolB.classGroupId, date: tehranToday() }))).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await can(tx, teacher, "academic.attendance.write", { scopeType: "class_group", id: w.schoolB.classGroupId })).toBe(false);
      // …and the teaching hat keeps its own درس (the guardian role neither widened nor narrowed it).
      expect(await can(tx, teacher, "academic.attendance.write", { scopeType: "class_offering", id: f.OFFERING_A1 })).toBe(true);

      // The class sheet: a colleague's slip carries no password (their own staff login).
      const sheet = await listClassGuardianCredentials(tx, w.admin, w.schoolB.classGroupId);
      expect(sheet.rows).toHaveLength(1);
      expect(sheet.rows[0]).toMatchObject({ guardianPersonId: w.teacher.personId, isStaff: true, initialPasswordEnc: null });
      // The work-item picker keeps the colleague (as the colleague) and leaves guardian-only persons out.
      const onlyGuardian = (await add(tx, w.admin, w.s1, 11)).guardianPersonId;
      const reach = await personReach(tx, w.admin);
      const ids = (await searchPersons(tx, "", reach, 200)).map((p) => p.id);
      expect(ids).toContain(w.teacher.personId);
      expect(ids).not.toContain(onlyGuardian);
    });
  });

  it("«ساخت حساب اولیا» is idempotent; the sheet and «تعیین رمز موقت» stay with whoever manages EVERY child of the guardian", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const first = await bulkCreateClassGuardians(tx, w.admin, { classGroupId: f.CLASS_GROUP_A1 });
      // Class A1: s1 (phone 11), s3 (phone 13), sNone (no phone), sPhone (phone 14 = their own login → a username) —
      // and whatever students earlier files left enrolled there (no «ولی» phone), hence the inequality.
      expect(first).toMatchObject({ createdAccounts: 3, usernameAccounts: 1, linked: 3, alreadyLinked: 0, invalidPhone: 0, skippedSelf: 0 });
      expect(first.noPhone).toBeGreaterThanOrEqual(1);
      expect(first.students).toBe(first.linked + first.noPhone);
      const linksAfterFirst = (await tx.select({ id: guardianLink.id }).from(guardianLink).where(eq(guardianLink.status, "active"))).length;
      const second = await bulkCreateClassGuardians(tx, w.admin, { classGroupId: f.CLASS_GROUP_A1 });
      expect(second).toMatchObject({ createdAccounts: 0, linked: 0, alreadyLinked: 3, noPhone: first.noPhone });
      expect((await tx.select({ id: guardianLink.id }).from(guardianLink).where(eq(guardianLink.status, "active"))).length).toBe(linksAfterFirst);
      // The sibling in class A2 shares phone 11 → the same guardian, no new account.
      const a2 = await bulkCreateClassGuardians(tx, w.admin, { classGroupId: f.CLASS_GROUP_A2 });
      expect(a2).toMatchObject({ createdAccounts: 0, linked: 1 });
      // The bulk name is the placeholder «ولیِ <child>»; adding the phone on the student page with a real name replaces it.
      const card = await listGuardiansOfStudent(tx, w.admin, w.s1.personId);
      expect(card[0]).toMatchObject({ firstName: "ولیِ لیلا", lastName: "نیک‌خواه", relation: "guardian" });
      const renamed = await add(tx, w.admin, w.s1, 11, "mother", { firstName: "زهره", lastName: "نیک‌خواه" });
      expect(renamed).toMatchObject({ alreadyLinked: true, renamed: true });

      // The sheet of class A1: three guardians with their initial passwords for the organization admin.
      const sheet = await listClassGuardianCredentials(tx, w.admin, f.CLASS_GROUP_A1);
      expect(sheet.rows.map((r) => r.loginIdentifier).sort()).toEqual([e164(11), e164(13), "s1-v-g-5"].sort());
      expect(sheet.rows.every((r) => r.initialPasswordEnc !== null)).toBe(true);

      // The phone-11 guardian also gets a child at school B: school A's principal may no longer act as them.
      const g11 = card[0].guardianPersonId;
      await add(tx, w.admin, w.sB, 11);
      const sheetA = await listClassGuardianCredentials(tx, w.principalA, f.CLASS_GROUP_A1);
      expect(sheetA.rows.find((r) => r.guardianPersonId === g11)?.initialPasswordEnc).toBeNull();
      expect(sheetA.rows.filter((r) => r.guardianPersonId !== g11).every((r) => r.initialPasswordEnc !== null)).toBe(true);
      const cardA = await listGuardiansOfStudent(tx, w.principalA, w.s1.personId);
      expect(cardA[0]).toMatchObject({ guardianPersonId: g11, manageable: false });
      await expect(sub(tx, (sp) => resetGuardianPassword(sp, w.principalA, { linkId: cardA[0].linkId }))).rejects.toSatisfy(isError("FORBIDDEN", GUARDIAN_MESSAGES.otherSchool));
      const reset = await resetGuardianPassword(tx, w.admin, { linkId: cardA[0].linkId });
      expect(reset.loginIdentifier).toBe(e164(11));
      // A colleague's account is never reset from here.
      const staffLink = await add(tx, w.admin, w.s3, w.teacherPhone, "father", { firstName: "علی", lastName: "حسینی" });
      await expect(sub(tx, (sp) => resetGuardianPassword(sp, w.admin, { linkId: staffLink.linkId }))).rejects.toSatisfy(isError("FORBIDDEN", GUARDIAN_MESSAGES.staffAccount));
    });
  });

  it("removing a student ends their links; a guardian left without a child loses their login; a new link opens it again; a removed student gets no guardian", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const g = (await add(tx, w.admin, w.s1, 11)).guardianPersonId;
      await add(tx, w.admin, w.s2, 11);
      const [m0] = await tx.select({ accountId: organizationMembership.userAccountId }).from(organizationMembership).where(eq(organizationMembership.personId, g));
      await tx.insert(schema.userSession).values({ userAccountId: m0.accountId, tokenHash: `guardian-session-${g}`, currentOrgId: f.ORG_A, expiresAt: new Date(Date.now() + 3_600_000) });

      await removePerson(tx, w.admin, { personId: w.s1.personId, kind: "student" });
      const links = await tx.select({ studentProfileId: guardianLink.studentProfileId, status: guardianLink.status }).from(guardianLink).where(eq(guardianLink.guardianPersonId, g));
      expect(links.sort((a, b) => a.studentProfileId.localeCompare(b.studentProfileId))).toEqual(
        [
          { studentProfileId: w.s1.studentProfileId, status: "archived" },
          { studentProfileId: w.s2.studentProfileId, status: "active" },
        ].sort((a, b) => a.studentProfileId.localeCompare(b.studentProfileId)),
      );
      expect((await actor(tx, g)).assignments.map((a) => a.scopeId)).toEqual([w.s2.studentProfileId]);
      const membership = async () =>
        (
          await tx
            .select({ status: organizationMembership.status, account: userAccount.status, mustChange: userAccount.mustChangePassword })
            .from(organizationMembership)
            .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
            .where(eq(organizationMembership.personId, g))
        )[0];
      expect(await membership()).toMatchObject({ status: "active", account: "active" });

      // The last child goes: membership left, account disabled, sessions revoked — audited.
      await removePerson(tx, w.admin, { personId: w.s2.personId, kind: "student" });
      expect(await membership()).toMatchObject({ status: "left", account: "disabled" });
      const live = await tx.select({ id: schema.userSession.id }).from(schema.userSession).where(and(eq(schema.userSession.userAccountId, m0.accountId), sql`${schema.userSession.revokedAt} is null`));
      expect(live).toEqual([]);
      const closed = await tx.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.entityId, g), eq(auditLog.action, "iam.guardian.access_closed")));
      expect(closed).toHaveLength(1);
      expect(await listMyChildren(tx, await actor(tx, g))).toEqual([]);

      // A removed student never gets a guardian again.
      await expect(sub(tx, (sp) => add(sp, w.admin, w.s1, 11))).rejects.toSatisfy(isError("CONFLICT", MESSAGES.personRemoved));
      // The same guardian linked to another child: access opens again with a NEW initial password.
      const reopened = await add(tx, w.admin, w.s3, 11);
      expect(reopened).toMatchObject({ accountKind: "reopened", guardianPersonId: g });
      expect(reopened.account?.loginIdentifier).toBe(e164(11));
      expect(await membership()).toMatchObject({ status: "active", account: "active", mustChange: true });

      // Unlinking that last child closes it again (idempotent on a second tap).
      expect(await unlinkGuardian(tx, w.admin, { linkId: reopened.linkId })).toEqual({ alreadyEnded: false, accessClosed: true });
      expect(await unlinkGuardian(tx, w.admin, { linkId: reopened.linkId })).toEqual({ alreadyEnded: true, accessClosed: false });

      // A removed colleague's own guardian links end with them.
      const staffLink = await add(tx, w.admin, w.sB, w.teacherPhone, "father", { firstName: "علی", lastName: "حسینی" });
      await removePerson(tx, w.admin, { personId: w.teacher.personId, kind: "staff" });
      const [ended] = await tx.select({ status: guardianLink.status }).from(guardianLink).where(eq(guardianLink.id, staffLink.linkId));
      expect(ended.status).toBe("archived");
    });
  });

  it("«غیبت» reaches the guardian once per child per roll call — the child's name and the kind, nothing else; the report card once per child per month", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const g1 = (await add(tx, w.admin, w.s1, 11)).guardianPersonId;
      const g3 = (await add(tx, w.admin, w.s3, 13)).guardianPersonId;
      const date = tehranToday();
      const entries = (absent: boolean) => [
        { studentProfileId: w.s1.studentProfileId, status: absent ? ("absent" as const) : ("present" as const) },
        { studentProfileId: w.s3.studentProfileId, status: "present" as const },
        { studentProfileId: w.sNone.studentProfileId, status: "absent" as const },
        { studentProfileId: w.sPhone.studentProfileId, status: "late" as const, minutesLate: 5 },
      ];
      const of = (personId: string, type: "guardian.child_absent" | "guardian.report_card") =>
        tx
          .select({ title: notification.title, body: notification.body, deepLink: notification.deepLink })
          .from(notification)
          .where(and(eq(notification.recipientPersonId, personId), eq(notification.typeCode, type)));

      await takeAttendance(tx, w.admin, { classGroupId: f.CLASS_GROUP_A1, date, entries: entries(true) });
      expect(await of(g1, "guardian.child_absent")).toEqual([{ title: `غیبت: ${w.s1.name}`, body: null, deepLink: `/child/attendance?child=${w.s1.studentProfileId}` }]);
      expect(await of(g3, "guardian.child_absent")).toEqual([]); // present
      // The same roll call saved again (absent again, or present then absent): still one.
      await takeAttendance(tx, w.admin, { classGroupId: f.CLASS_GROUP_A1, date, entries: entries(true) });
      await takeAttendance(tx, w.admin, { classGroupId: f.CLASS_GROUP_A1, date, entries: entries(false) });
      await takeAttendance(tx, w.admin, { classGroupId: f.CLASS_GROUP_A1, date, entries: entries(true) });
      expect(await of(g1, "guardian.child_absent")).toHaveLength(1);
      // The admin who took it is never notified of their own act (and holds no guardian link anyway).
      expect(await of(w.admin.personId, "guardian.child_absent")).toEqual([]);

      // The monthly report card: one per child, month and year, whatever saves follow.
      const rc = { academicYearId: f.YEAR_A, month: 7, monthName: "مهر", studentProfileIds: [w.s1.studentProfileId, w.s1.studentProfileId] };
      expect(await notifyGuardiansOfReportCard(tx, w.teacher, rc)).toBe(1);
      expect(await notifyGuardiansOfReportCard(tx, w.teacher, rc)).toBe(0);
      expect(await of(g1, "guardian.report_card")).toEqual([{ title: `کارنامهٴ ماه مهر: ${w.s1.name}`, body: null, deepLink: `/child/report-card?child=${w.s1.studentProfileId}&month=7` }]);
      expect(await notifyGuardiansOfReportCard(tx, w.teacher, { ...rc, month: 8, monthName: "آبان" })).toBe(1);
    });
  });
});
