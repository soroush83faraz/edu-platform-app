// «مشاوره», phase 1 (owner, 2026-10-13; migration 0018; src/modules/counseling/service.ts). Both layers are tested:
// the service (NOT_FOUND outside the reach, FORBIDDEN for a known capability the caller lacks) and the database —
// the RESTRICTIVE policies of 0018 decide per `app.current_person_id()`, so every call below runs as its actor
// (`as`: the person withTenant would bind for that session, switched inside the one test transaction), and raw SQL
// as the same person proves the rows are not even selectable:
//   • a counselor of school A reads and writes the files of A's students — never school B's (another school of the
//     SAME organization), and B's counselor never sees A's notes;
//   • a teacher reads no note; reports only on a student they teach now; reads back only their own reports;
//   • the principal and vice principal read a note only when its visibility is «مشاوران و مدیریت مدرسه»;
//   • a student reads nothing at all;
//   • notes are edited / archived by their author only; no audit row carries a note's, report's or referral's text;
//   • «ارجاع به مدیریت» is a confidential admin_request to the school's principal and vice principal (the organization
//     admin when the school has neither), closed by the first answer, whose note the file shows; a principal of
//     another school cannot open it; «درخواست گزارش از دبیر» goes to the student's current teachers only;
//   • tenant isolation (another organization sees nothing, writes nothing).
// The catalog (roles + permissions) is seeded in beforeAll; every write runs inside a withTenant transaction that
// ends with Rollback; afterAll re-creates the fixture database (later files assert exact template lists).
import { and, eq, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, notification, staffProfile, workItem, workItemAssignee, workItemTransition, workItemType } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { assignTeacher } from "@/modules/academic/service";
import {
  archiveCounselorNote,
  archiveTeacherReport,
  counselingLinkForWorkItem,
  createCounselorNote,
  createTeacherReport,
  getStudentFile,
  getTeacherReportPage,
  listCounselingStudents,
  referToManagement,
  requestTeacherReport,
  updateCounselorNote,
} from "@/modules/counseling/service";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { listValidAssignments } from "@/modules/iam/repo";
import { MESSAGES, assignRole, createStaff, createStudent, revokeRoleAssignment } from "@/modules/iam/service";
import { createAcademicYear, createClassGroup, createClassOffering, createSchool } from "@/modules/tenancy/service";
import { CONFIDENTIAL_NOTE_MESSAGE, canViewWorkItem, changeStatus } from "@/modules/workspace/service";
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
/** Only to BOOTSTRAP the organization's real admin (the seeds' way); every actor below carries its real assignments. */
const bootstrap: Actor = {
  orgId: f.ORG_A,
  personId: f.PERSON_A2,
  userId: null,
  requestId: "int-counseling",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };

const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
/** A savepoint, so a failing statement never poisons the test's transaction. */
const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));

/** Binds `app.current_person_id` to `who` (what withTenant does for a request of theirs), then runs `fn`. */
async function as<T>(tx: Tx, who: Actor, fn: (t: Tx) => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.current_person_id', ${who.personId}, true)`);
  return fn(tx);
}

async function actor(tx: Tx, personId: string): Promise<Actor> {
  return { orgId: f.ORG_A, personId, userId: null, requestId: "int-counseling", assignments: await listValidAssignments(tx, personId) };
}

async function countAs(tx: Tx, who: Actor, table: "counselor_note" | "teacher_report" | "referral"): Promise<number> {
  const res = await as(tx, who, (t) => t.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(`counseling.${table}`)}`));
  return Number(res.rows[0].n);
}

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    withTenant(tenant, async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

interface Student {
  studentProfileId: string;
  personId: string;
}

interface World {
  admin: Actor;
  schoolB: { schoolId: string; classGroupId: string };
  principalA: Actor;
  principalAAssignmentId: string;
  viceA: Actor;
  principalB: Actor;
  principalBAssignmentId: string;
  counselorA: Actor;
  counselorA2: Actor;
  counselorB: Actor;
  teacherA1: Actor;
  teacherA2: Actor;
  /** In class A1 (the fixture offering's class, taught by teacherA1), with a guardian phone. */
  studentA1: Student;
  /** In class A2 (taught by teacherA2). */
  studentA2: Student;
  /** In school B. */
  studentB: Student;
  /** studentA1 as a user: their `student` role. */
  studentActor: Actor;
}

/**
 * School A (the fixture school) and school B of the SAME organization; a real organization admin; principal + vice
 * principal + two counselors at A, a principal and a counselor at B; a teacher of class A1 and one of class A2; a
 * student in A1, one in A2 and one at B.
 */
async function buildWorld(tx: Tx): Promise<World> {
  const adminP = await createStaff(tx, bootstrap, { firstName: "محمد", lastName: "امینی", phone: "09127400001", createAccount: false });
  await assignRole(tx, { ...bootstrap, personId: adminP.personId }, { personId: adminP.personId, roleCode: "org_admin" });
  const admin = await actor(tx, adminP.personId);

  const s2 = await createSchool(tx, admin, { name: "دبیرستان دوم", code: "S2", genderPolicy: "girls" });
  const year = await createAcademicYear(tx, admin, {
    schoolId: s2.schoolId,
    name: "۱۴۰۵-۱۴۰۶",
    startsOn: "2026-09-23",
    endsOn: "2027-06-21",
    isCurrent: true,
    terms: [{ name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" }],
  });
  const cgB = await createClassGroup(tx, admin, { branchId: s2.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "۸/۱" });
  await createClassOffering(tx, admin, { classGroupId: cgB.classGroupId, subjectId: f.SUBJECT_A, termId: year.termIds[0] });
  const offA2 = await createClassOffering(tx, admin, { classGroupId: f.CLASS_GROUP_A2, subjectId: f.SUBJECT_A, termId: f.TERM_A });

  const staff = (firstName: string, lastName: string, phone: string, extra: { roles?: Array<{ roleCode: "school_principal" | "vice_principal" | "counselor"; schoolId: string }>; schoolId?: string }) =>
    createStaff(tx, admin, { firstName, lastName, phone, createAccount: false, roles: extra.roles, schoolId: extra.schoolId });
  const pA = await staff("مریم", "رضایی", "09127400002", { roles: [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }] });
  const vA = await staff("سارا", "کاظمی", "09127400003", { roles: [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }] });
  const pB = await staff("زهرا", "موسوی", "09127400004", { roles: [{ roleCode: "school_principal", schoolId: s2.schoolId }] });
  const cA = await staff("نگار", "صادقی", "09127400005", { roles: [{ roleCode: "counselor", schoolId: f.SCHOOL_A }] });
  const cA2 = await staff("الهام", "نوری", "09127400006", { roles: [{ roleCode: "counselor", schoolId: f.SCHOOL_A }] });
  const cB = await staff("مهسا", "کریمی", "09127400007", { roles: [{ roleCode: "counselor", schoolId: s2.schoolId }] });
  const tA1 = await staff("علی", "حسینی", "09127400008", { schoolId: f.SCHOOL_A });
  const tA2 = await staff("رضا", "جعفری", "09127400009", { schoolId: f.SCHOOL_A });
  await assignTeacher(tx, admin, { staffProfileId: tA1.staffProfileId, classOfferingId: f.OFFERING_A1 });
  await assignTeacher(tx, admin, { staffProfileId: tA2.staffProfileId, classOfferingId: offA2.classOfferingId });

  const sA1 = await createStudent(tx, admin, { firstName: "آوا", lastName: "باقری", studentNumber: "C-1", guardianPhone: "09127400100", enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
  const sA2 = await createStudent(tx, admin, { firstName: "مینا", lastName: "یوسفی", studentNumber: "C-2", enrollment: { classGroupId: f.CLASS_GROUP_A2 } });
  const sB = await createStudent(tx, admin, { firstName: "رها", lastName: "شریفی", studentNumber: "C-3", enrollment: { classGroupId: cgB.classGroupId } });

  return {
    admin,
    schoolB: { schoolId: s2.schoolId, classGroupId: cgB.classGroupId },
    principalA: await actor(tx, pA.personId),
    principalAAssignmentId: pA.roleAssignmentIds[0],
    viceA: await actor(tx, vA.personId),
    principalB: await actor(tx, pB.personId),
    principalBAssignmentId: pB.roleAssignmentIds[0],
    counselorA: await actor(tx, cA.personId),
    counselorA2: await actor(tx, cA2.personId),
    counselorB: await actor(tx, cB.personId),
    teacherA1: await actor(tx, tA1.personId),
    teacherA2: await actor(tx, tA2.personId),
    studentA1: { studentProfileId: sA1.studentProfileId, personId: sA1.personId },
    studentA2: { studentProfileId: sA2.studentProfileId, personId: sA2.personId },
    studentB: { studentProfileId: sB.studentProfileId, personId: sB.personId },
    studentActor: await actor(tx, sA1.personId),
  };
}

const note = (w: World, studentProfileId: string, visibility: "counselors" | "counselors_and_principal", body = "یادداشت آزمایشی") =>
  ({ studentProfileId, kind: "general" as const, visibility, body }) satisfies Parameters<typeof createCounselorNote>[2];

describe("«مشاوره» — the counseling file", () => {
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

  it("migration 0018: tenant_isolation + the RESTRICTIVE policies for app_rw on every counseling table; no DELETE, no referral UPDATE; work_item.is_confidential", async () => {
    await asAppRw(async (c) => {
      const policies = await c.query<{ t: string; policyname: string; permissive: string; cmd: string; roles: string[] }>(
        `select tablename as t, policyname, permissive, cmd, roles::text[] as roles from pg_policies where schemaname = 'counseling' order by 1, 2`,
      );
      const of = (t: string) => policies.rows.filter((p) => p.t === t).map((p) => `${p.policyname}:${p.permissive}:${p.cmd}:${p.roles.join(",")}`);
      expect(of("counselor_note")).toEqual(["counseling_insert:RESTRICTIVE:INSERT:app_rw", "counseling_read:RESTRICTIVE:SELECT:app_rw", "counseling_update:RESTRICTIVE:UPDATE:app_rw", "tenant_isolation:PERMISSIVE:ALL:public"]);
      expect(of("teacher_report")).toEqual(["counseling_insert:RESTRICTIVE:INSERT:app_rw", "counseling_read:RESTRICTIVE:SELECT:app_rw", "counseling_update:RESTRICTIVE:UPDATE:app_rw", "tenant_isolation:PERMISSIVE:ALL:public"]);
      expect(of("referral")).toEqual(["counseling_insert:RESTRICTIVE:INSERT:app_rw", "counseling_read:RESTRICTIVE:SELECT:app_rw", "tenant_isolation:PERMISSIVE:ALL:public"]);
      const rls = await c.query<{ t: string; enabled: boolean; forced: boolean }>(
        `select c.relname as t, c.relrowsecurity as enabled, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'counseling' and c.relkind = 'r' order by 1`,
      );
      expect(rls.rows).toEqual([
        { t: "counselor_note", enabled: true, forced: true },
        { t: "referral", enabled: true, forced: true },
        { t: "teacher_report", enabled: true, forced: true },
      ]);
      const priv = await c.query<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }>(
        `select t, has_table_privilege('app_rw', t, 'SELECT') as s, has_table_privilege('app_rw', t, 'INSERT') as i,
                has_table_privilege('app_rw', t, 'UPDATE') as u, has_table_privilege('app_rw', t, 'DELETE') as d
           from unnest(array['counseling.counselor_note', 'counseling.teacher_report', 'counseling.referral']) as t order by 1`,
      );
      expect(priv.rows).toEqual([
        { t: "counseling.counselor_note", s: true, i: true, u: true, d: false },
        { t: "counseling.referral", s: true, i: true, u: false, d: false },
        { t: "counseling.teacher_report", s: true, i: true, u: true, d: false },
      ]);
      const col = await c.query<{ column_default: string; is_nullable: string }>(
        `select column_default, is_nullable from information_schema.columns where table_schema = 'workspace' and table_name = 'work_item' and column_name = 'is_confidential'`,
      );
      expect(col.rows).toEqual([{ column_default: "false", is_nullable: "NO" }]);
    });
  });

  it("a counselor of school A: A's students by پایه, the file, notes — school B (same organization) is NOT_FOUND, and B's counselor sees none of A's notes", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const list = await as(tx, w.counselorA, (t) => listCounselingStudents(t, w.counselorA, {}));
      expect(list.schools.map((s) => s.id)).toEqual([f.SCHOOL_A]);
      const listed = list.groups.flatMap((g) => g.students.map((s) => s.studentProfileId));
      expect(listed).toEqual(expect.arrayContaining([w.studentA1.studentProfileId, w.studentA2.studentProfileId]));
      expect(listed).not.toContain(w.studentB.studentProfileId);
      expect(list.canWrite).toBe(true);
      const byNumber = await as(tx, w.counselorA, (t) => listCounselingStudents(t, w.counselorA, { q: "C-2" }));
      expect(byNumber.groups.flatMap((g) => g.students.map((s) => s.studentProfileId))).toEqual([w.studentA2.studentProfileId]);
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => listCounselingStudents(t, w.counselorA, { schoolId: w.schoolB.schoolId })))).rejects.toSatisfy(isError("NOT_FOUND"));

      const n = await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors")));
      const file = await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, w.studentA1.studentProfileId));
      expect(file.notes.map((x) => [x.id, x.mine, x.editable])).toEqual([[n.id, true, true]]);
      expect(file.student.guardianPhones).toEqual(["+989127400100"]);
      expect(file.viewer).toEqual({ canWrite: true, canRefer: true });
      expect(file.teachers.map((t) => t.personId)).toEqual([w.teacherA1.personId]);

      // School B's student does not exist for A's counselor — file, note, referral, report request alike.
      const b = w.studentB.studentProfileId;
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => getStudentFile(t, w.counselorA, b)))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, b, "counselors_and_principal"))))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: b, subject: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => requestTeacherReport(t, w.counselorA, { studentProfileId: b, teacherPersonIds: [w.teacherA1.personId] })))).rejects.toSatisfy(isError("NOT_FOUND"));

      // B's counselor: not A's file, not A's note — by the service and by the database.
      await expect(sub(tx, (sp) => as(sp, w.counselorB, (t) => getStudentFile(t, w.counselorB, w.studentA1.studentProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await countAs(tx, w.counselorB, "counselor_note")).toBe(0);
      await expect(sub(tx, (sp) => as(sp, w.counselorB, (t) => updateCounselorNote(t, w.counselorB, { noteId: n.id, body: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      // A colleague counselor of A reads it («فقط مشاوران» included) but may not edit or archive it.
      expect(await countAs(tx, w.counselorA2, "counselor_note")).toBe(1);
      const colleague = await as(tx, w.counselorA2, (t) => getStudentFile(t, w.counselorA2, w.studentA1.studentProfileId));
      expect(colleague.notes.map((x) => [x.id, x.mine, x.editable])).toEqual([[n.id, false, false]]);
      await expect(sub(tx, (sp) => as(sp, w.counselorA2, (t) => updateCounselorNote(t, w.counselorA2, { noteId: n.id, body: "x" })))).rejects.toSatisfy(isError("FORBIDDEN"));
      await expect(sub(tx, (sp) => as(sp, w.counselorA2, (t) => archiveCounselorNote(t, w.counselorA2, { noteId: n.id })))).rejects.toSatisfy(isError("FORBIDDEN"));
      // The database refuses a note in someone else's name, or at a school the writer is no counselor of.
      const forged = (who: Actor, author: string, school: string) =>
        sub(tx, (sp) =>
          as(sp, who, (t) =>
            t.execute(sql`insert into counseling.counselor_note (id, organization_id, school_id, student_profile_id, author_person_id, body)
                          values (app.uuid_generate_v7(), ${f.ORG_A}::uuid, ${school}::uuid, ${w.studentA1.studentProfileId}::uuid, ${author}::uuid, 'x')`),
          ),
        );
      await expect(forged(w.counselorA2, w.counselorA.personId, f.SCHOOL_A)).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE);
      await expect(forged(w.counselorB, w.counselorB.personId, f.SCHOOL_A)).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE);
      await expect(forged(w.principalA, w.principalA.personId, f.SCHOOL_A)).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE);
    });
  });

  it("the principal and the vice principal read a note only when its visibility allows; another school's principal reads nothing; the organization admin like management", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const shared = await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors_and_principal")));
      const secret = await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors")));
      for (const mgr of [w.principalA, w.viceA, w.admin]) {
        const file = await as(tx, mgr, (t) => getStudentFile(t, mgr, w.studentA1.studentProfileId));
        expect(file.notes.map((x) => x.id)).toEqual([shared.id]);
        expect(file.viewer).toEqual({ canWrite: false, canRefer: false });
        expect(await countAs(tx, mgr, "counselor_note")).toBe(1);
        // Management reads; it never writes or edits a counselor's note.
        await expect(sub(tx, (sp) => as(sp, mgr, (t) => createCounselorNote(t, mgr, note(w, w.studentA1.studentProfileId, "counselors_and_principal"))))).rejects.toSatisfy(isError("FORBIDDEN"));
        await expect(sub(tx, (sp) => as(sp, mgr, (t) => updateCounselorNote(t, mgr, { noteId: shared.id, body: "x" })))).rejects.toSatisfy(isError("FORBIDDEN"));
        await expect(sub(tx, (sp) => as(sp, mgr, (t) => updateCounselorNote(t, mgr, { noteId: secret.id, body: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      // Turning the shared note «فقط مشاوران» hides it from management at once.
      await as(tx, w.counselorA, (t) => updateCounselorNote(t, w.counselorA, { noteId: shared.id, visibility: "counselors" }));
      expect(await countAs(tx, w.principalA, "counselor_note")).toBe(0);
      expect((await as(tx, w.principalA, (t) => getStudentFile(t, w.principalA, w.studentA1.studentProfileId))).notes).toEqual([]);
      // School B's principal: neither the file nor a row.
      await expect(sub(tx, (sp) => as(sp, w.principalB, (t) => getStudentFile(t, w.principalB, w.studentA1.studentProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      await as(tx, w.counselorA, (t) => updateCounselorNote(t, w.counselorA, { noteId: shared.id, visibility: "counselors_and_principal" }));
      expect(await countAs(tx, w.principalB, "counselor_note")).toBe(0);
    });
  });

  it("no manager becomes a counselor of their own school: no self-grant, «مشاور» and a manager role exclude each other — a plain colleague still becomes one", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const secret = await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors")));
      const grant = (who: Actor, personId: string, roleCode: "counselor" | "vice_principal" | "school_principal", schoolId = f.SCHOOL_A) =>
        sub(tx, (sp) => assignRole(sp, who, { personId, roleCode, schoolId }));

      // The reviewer's probe: the principal, the vice principal and the organization admin each grant themselves «مشاور».
      for (const mgr of [w.principalA, w.viceA, w.admin]) {
        await expect(grant(mgr, mgr.personId, "counselor")).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.selfGrantForbidden));
      }
      // Self-grant is refused for every role, not only «مشاور» (the vice principal re-granting their own role too).
      await expect(grant(w.viceA, w.viceA.personId, "vice_principal")).rejects.toSatisfy(isError("FORBIDDEN", MESSAGES.selfGrantForbidden));
      // Nor through a colleague: the principal gives «مشاور» to the vice principal, the organization admin to the
      // principal — both managers of school A.
      await expect(grant(w.principalA, w.viceA.personId, "counselor")).rejects.toSatisfy(isError("VALIDATION", MESSAGES.counselorNotForManager));
      await expect(grant(w.admin, w.principalA.personId, "counselor")).rejects.toSatisfy(isError("VALIDATION", MESSAGES.counselorNotForManager));
      // …and the other way round: A's counselor is made vice principal or principal of A.
      await expect(grant(w.principalA, w.counselorA.personId, "vice_principal")).rejects.toSatisfy(isError("VALIDATION", MESSAGES.managerNotForCounselor));
      await expect(grant(w.admin, w.counselorA.personId, "school_principal")).rejects.toSatisfy(isError("VALIDATION", MESSAGES.managerNotForCounselor));
      // A new colleague registered with both roles at once gets neither (createStaff is one transaction).
      await expect(
        sub(tx, (sp) =>
          createStaff(sp, w.admin, { firstName: "پری", lastName: "دوکاره", phone: "09127400099", createAccount: false, roles: [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }, { roleCode: "counselor", schoolId: f.SCHOOL_A }] }),
        ),
      ).rejects.toSatisfy(isError("VALIDATION", MESSAGES.counselorNotForManager));

      // Nothing was granted: management still reads no «فقط مشاوران» note and writes no note — service and database.
      for (const mgr of [w.principalA, w.viceA, w.admin]) {
        const again = await actor(tx, mgr.personId);
        expect(again.assignments.map((a) => a.roleCode)).not.toContain("counselor");
        expect((await as(tx, again, (t) => getStudentFile(t, again, w.studentA1.studentProfileId))).notes.map((n) => n.id)).not.toContain(secret.id);
        expect(await countAs(tx, again, "counselor_note")).toBe(0);
        await expect(sub(tx, (sp) => as(sp, again, (t) => createCounselorNote(t, again, note(w, w.studentA1.studentProfileId, "counselors"))))).rejects.toSatisfy(isError("FORBIDDEN"));
      }

      // The ordinary grant still works: the principal makes a plain colleague (a teacher of A) «مشاور» — who now reads
      // the counselors-only note; another school's counselor may still be a manager HERE (the rule is per school).
      const made = await assignRole(tx, w.principalA, { personId: w.teacherA2.personId, roleCode: "counselor", schoolId: f.SCHOOL_A });
      expect(made.created).toBe(true);
      const newCounselor = await actor(tx, w.teacherA2.personId);
      expect((await as(tx, newCounselor, (t) => getStudentFile(t, newCounselor, w.studentA1.studentProfileId))).notes.map((n) => n.id)).toEqual([secret.id]);
      expect((await assignRole(tx, w.admin, { personId: w.counselorB.personId, roleCode: "vice_principal", schoolId: f.SCHOOL_A })).created).toBe(true);
    });
  });

  it("a teacher reads no note and reports only on a student they teach now — reading back only their own reports", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors_and_principal")));
      // No file, no list, no row.
      await expect(sub(tx, (sp) => as(sp, w.teacherA1, (t) => getStudentFile(t, w.teacherA1, w.studentA1.studentProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.teacherA1, (t) => listCounselingStudents(t, w.teacherA1, {})))).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await countAs(tx, w.teacherA1, "counselor_note")).toBe(0);

      const r = await as(tx, w.teacherA1, (t) => createTeacherReport(t, w.teacherA1, { studentProfileId: w.studentA1.studentProfileId, kind: "behavioral", body: "گزارش دبیر" }));
      // Not their student: class A2 is the other teacher's; the B student is another school's.
      for (const id of [w.studentA2.studentProfileId, w.studentB.studentProfileId]) {
        await expect(sub(tx, (sp) => as(sp, w.teacherA1, (t) => createTeacherReport(t, w.teacherA1, { studentProfileId: id, kind: "academic", body: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      await expect(sub(tx, (sp) => as(sp, w.teacherA2, (t) => createTeacherReport(t, w.teacherA2, { studentProfileId: w.studentA1.studentProfileId, kind: "academic", body: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.teacherA2, (t) => getTeacherReportPage(t, w.teacherA2, w.studentA1.studentProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      // Management has no teacher hat: no report either.
      await expect(sub(tx, (sp) => as(sp, w.principalA, (t) => createTeacherReport(t, w.principalA, { studentProfileId: w.studentA1.studentProfileId, kind: "academic", body: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));

      // The teacher's page: their own report; the other teacher sees no row of it.
      const page = await as(tx, w.teacherA1, (t) => getTeacherReportPage(t, w.teacherA1, w.studentA1.studentProfileId));
      expect(page.mine.map((x) => x.id)).toEqual([r.id]);
      expect(await countAs(tx, w.teacherA2, "teacher_report")).toBe(0);
      // The counselor and the principal read it in the file.
      for (const reader of [w.counselorA, w.principalA]) {
        const file = await as(tx, reader, (t) => getStudentFile(t, reader, w.studentA1.studentProfileId));
        expect(file.reports.map((x) => x.id)).toEqual([r.id]);
      }
      // Not in someone else's name (the database), withdrawn only by its author.
      await expect(
        sub(tx, (sp) =>
          as(sp, w.teacherA1, (t) =>
            t.execute(sql`insert into counseling.teacher_report (id, organization_id, school_id, student_profile_id, author_person_id, kind, body)
                          values (app.uuid_generate_v7(), ${f.ORG_A}::uuid, ${f.SCHOOL_A}::uuid, ${w.studentA1.studentProfileId}::uuid, ${w.teacherA2.personId}::uuid, 'academic', 'x')`),
          ),
        ),
      ).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE);
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => archiveTeacherReport(t, w.counselorA, { reportId: r.id })))).rejects.toSatisfy(isError("FORBIDDEN"));
      await expect(sub(tx, (sp) => as(sp, w.teacherA2, (t) => archiveTeacherReport(t, w.teacherA2, { reportId: r.id })))).rejects.toSatisfy(isError("NOT_FOUND"));
      await as(tx, w.teacherA1, (t) => archiveTeacherReport(t, w.teacherA1, { reportId: r.id }));
      expect((await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, w.studentA1.studentProfileId))).reports).toEqual([]);
    });
  });

  it("a student reads nothing — not the list, not their own file, not a row of any counseling table", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors_and_principal")));
      await as(tx, w.teacherA1, (t) => createTeacherReport(t, w.teacherA1, { studentProfileId: w.studentA1.studentProfileId, kind: "academic", body: "x" }));
      await as(tx, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: w.studentA1.studentProfileId, subject: "x" }));
      const s = w.studentActor;
      expect(s.assignments.map((a) => a.roleCode)).toEqual(["student"]);
      await expect(sub(tx, (sp) => as(sp, s, (t) => listCounselingStudents(t, s, {})))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, s, (t) => getStudentFile(t, s, w.studentA1.studentProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, s, (t) => createCounselorNote(t, s, note(w, w.studentA1.studentProfileId, "counselors_and_principal"))))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, s, (t) => createTeacherReport(t, s, { studentProfileId: w.studentA1.studentProfileId, kind: "academic", body: "x" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      for (const table of ["counselor_note", "teacher_report", "referral"] as const) expect(await countAs(tx, s, table), table).toBe(0);
    });
  });

  it("notes: edited and archived by their author only; no audit row carries a note's, report's or referral's text", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const MARK = "رمز-محرمانه-۴۲";
      const n = await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, { studentProfileId: w.studentA1.studentProfileId, kind: "family", visibility: "counselors", body: `آغاز ${MARK}` }));
      expect(await as(tx, w.counselorA, (t) => updateCounselorNote(t, w.counselorA, { noteId: n.id, body: `ویرایش ${MARK}`, kind: "family" }))).toEqual({ changed: ["body"] });
      expect(await as(tx, w.counselorA, (t) => updateCounselorNote(t, w.counselorA, { noteId: n.id, body: `ویرایش ${MARK}` }))).toEqual({ changed: [] });
      await as(tx, w.teacherA1, (t) => createTeacherReport(t, w.teacherA1, { studentProfileId: w.studentA1.studentProfileId, kind: "academic", body: `گزارش ${MARK}` }));
      await as(tx, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: w.studentA1.studentProfileId, subject: `موضوع ${MARK}`, description: `شرح ${MARK}` }));
      await as(tx, w.counselorA, (t) => requestTeacherReport(t, w.counselorA, { studentProfileId: w.studentA1.studentProfileId, teacherPersonIds: [w.teacherA1.personId], message: `پیام ${MARK}` }));

      const audits = {
        rows: await tx
          .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
          .from(auditLog)
          .where(or(like(auditLog.action, "counseling.%"), and(eq(auditLog.action, "workspace.work_item.created"), sql`${auditLog.after}->>'confidential' = 'true'`))),
      };
      // One transaction → one `now()`: the rows are compared as a set. The second (unchanged) edit wrote none.
      expect(audits.rows.map((r) => r.action).sort()).toEqual(
        [
          "counseling.counselor_note.created",
          "counseling.counselor_note.updated",
          "counseling.teacher_report.created",
          "workspace.work_item.created",
          "counseling.referral.created",
          "workspace.work_item.created",
          "counseling.referral.created",
        ].sort(),
      );
      for (const r of audits.rows) expect(JSON.stringify([r.before, r.after]), r.action).not.toContain(MARK);
      const created = audits.rows.find((r) => r.action === "counseling.counselor_note.created");
      expect(created?.after).toMatchObject({ studentProfileId: w.studentA1.studentProfileId, schoolId: f.SCHOOL_A, kind: "family", visibility: "counselors", length: `آغاز ${MARK}`.length });
      expect(audits.rows.find((r) => r.action === "counseling.counselor_note.updated")?.after).toMatchObject({ bodyChanged: true, kind: "family" });
      const anywhere = await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit.audit_log where coalesce(before::text, '') || coalesce(after::text, '') like ${`%${MARK}%`}`);
      expect(anywhere.rows[0].n).toBe(0);

      // Archive: the author only; then the note leaves the file and a second archive finds nothing.
      await expect(sub(tx, (sp) => as(sp, w.counselorA2, (t) => archiveCounselorNote(t, w.counselorA2, { noteId: n.id })))).rejects.toSatisfy(isError("FORBIDDEN"));
      await as(tx, w.counselorA, (t) => archiveCounselorNote(t, w.counselorA, { noteId: n.id }));
      expect((await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, w.studentA1.studentProfileId))).notes).toEqual([]);
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => archiveCounselorNote(t, w.counselorA, { noteId: n.id })))).rejects.toSatisfy(isError("NOT_FOUND"));
      // app_rw can never delete a note (the trail stays).
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => t.execute(sql`delete from counseling.counselor_note where id = ${n.id}::uuid`)))).rejects.toSatisfy(
        (e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it("«ارجاع به مدیریت»: a confidential admin_request to the principal and the vice principal, closed by the first answer whose note the file shows", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const ref = await as(tx, w.counselorA, (t) =>
        referToManagement(t, w.counselorA, { studentProfileId: w.studentA2.studentProfileId, subject: "غیبت پیاپی", description: "سه روز غیبت", urgent: true }),
      );
      expect(ref.recipients).toBe(2);
      const [item] = await tx
        .select({ typeCode: workItemType.code, isConfidential: workItem.isConfidential, priority: workItem.priority, title: workItem.title })
        .from(workItem)
        .innerJoin(workItemType, eq(workItemType.id, workItem.typeId))
        .where(eq(workItem.id, ref.workItemId));
      expect(item).toMatchObject({ typeCode: "admin_request", isConfidential: true, priority: "urgent" });
      expect(item.title).toContain("مینا یوسفی");
      const assignees = await tx.select({ personId: workItemAssignee.personId }).from(workItemAssignee).where(eq(workItemAssignee.workItemId, ref.workItemId));
      expect(assignees.map((a) => a.personId).sort()).toEqual([w.principalA.personId, w.viceA.personId].sort());
      const bells = await tx.select({ recipient: notification.recipientPersonId, title: notification.title }).from(notification).where(eq(notification.sourceId, ref.workItemId));
      expect(bells.map((b) => b.recipient).sort()).toEqual([w.principalA.personId, w.viceA.personId].sort());
      for (const b of bells) expect(b.title.startsWith("ارجاع مشاور")).toBe(true);

      // Its participants open it; a principal of ANOTHER school (a broad reader of the organization) and the
      // organization admin it was not addressed to get NOT_FOUND — it is confidential.
      await as(tx, w.principalA, (t) => canViewWorkItem(t, w.principalA, ref.workItemId));
      await expect(sub(tx, (sp) => as(sp, w.principalB, (t) => canViewWorkItem(t, w.principalB, ref.workItemId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.admin, (t) => canViewWorkItem(t, w.admin, ref.workItemId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      // From the item back to the file: management → the file; a teacher (not addressed) → nothing.
      expect(await as(tx, w.principalA, (t) => counselingLinkForWorkItem(t, w.principalA, ref.workItemId))).toMatchObject({ kind: "file", href: `/counseling/students/${w.studentA2.studentProfileId}` });
      expect(await as(tx, w.teacherA1, (t) => counselingLinkForWorkItem(t, w.teacherA1, ref.workItemId))).toBe(null);

      const before = await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, w.studentA2.studentProfileId));
      expect(before.referrals.map((r) => [r.kind, r.statusCategory, r.answer])).toEqual([["management", "todo", null]]);

      // The principal answers in «پنل من»: the first answer closes it for both; the vice principal's turn is over.
      const answered = await as(tx, w.principalA, (t) => changeStatus(t, w.principalA, { workItemId: ref.workItemId, toStatusCode: "answered", note: "با ولی تماس گرفته شد" }));
      expect(answered).toMatchObject({ statusCode: "answered", itemChanged: true });
      await expect(sub(tx, (sp) => as(sp, w.viceA, (t) => changeStatus(t, w.viceA, { workItemId: ref.workItemId, toStatusCode: "answered" })))).rejects.toSatisfy(isError("VALIDATION"));
      // The answer is about a student: the trail of the confidential item records its length, not its text.
      const trail = await tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.action, "workspace.work_item.status_changed"), eq(auditLog.entityId, ref.workItemId)));
      expect(trail).toHaveLength(1);
      expect(trail[0].after).toMatchObject({ statusCode: "answered", noteLength: "با ولی تماس گرفته شد".length });
      expect(trail[0].after).not.toHaveProperty("note");
      const after = await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, w.studentA2.studentProfileId));
      expect(after.referrals.map((r) => [r.statusCategory, r.answer, r.answerBy])).toEqual([["done", "با ولی تماس گرفته شد", "مریم رضایی"]]);
      // The principal reads the referral in the file too; another school's counselor does not see a row of it.
      expect((await as(tx, w.principalA, (t) => getStudentFile(t, w.principalA, w.studentA2.studentProfileId))).referrals).toHaveLength(1);
      // The organization admin it was not addressed to is a case reader of the school: the file lists it — title,
      // status, the answer — although the work item itself stays NOT_FOUND for them (checked above).
      expect((await as(tx, w.admin, (t) => getStudentFile(t, w.admin, w.studentA2.studentProfileId))).referrals.map((r) => [r.workItemId, r.answer])).toEqual([
        [ref.workItemId, "با ولی تماس گرفته شد"],
      ]);
      expect(await countAs(tx, w.counselorB, "referral")).toBe(0);

      // A replayed form (same key) gives back the same referral, not a second one.
      const key = "0199a000-00cc-7000-8000-0000000000c1";
      const one = await as(tx, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: w.studentA2.studentProfileId, subject: "دوباره", idempotencyKey: key }));
      const two = await as(tx, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: w.studentA2.studentProfileId, subject: "دوباره", idempotencyKey: key }));
      expect(two).toMatchObject({ referralId: one.referralId, workItemId: one.workItemId, duplicate: true });

      // Management does not refer: the capability is the counselor's.
      await expect(sub(tx, (sp) => as(sp, w.principalA, (t) => referToManagement(t, w.principalA, { studentProfileId: w.studentA2.studentProfileId, subject: "x" })))).rejects.toSatisfy(isError("FORBIDDEN"));
    });
  });

  it("the file shows only the answer that closed a referral — a note on any other transition of a confidential item is refused", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const refused = isError("VALIDATION", CONFIDENTIAL_NOTE_MESSAGE);
      const sid = w.studentA2.studentProfileId;
      const ref = await as(tx, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: sid, subject: "پیگیری" }));
      const answerOf = async (workItemId: string) => (await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, sid))).referrals.find((r) => r.workItemId === workItemId)!;

      // An addressee's «در حال بررسی» with a crafted text: refused; without text it goes through, and the file shows
      // no answer for it (the item is not closed).
      await expect(sub(tx, (sp) => as(sp, w.viceA, (t) => changeStatus(t, w.viceA, { workItemId: ref.workItemId, toStatusCode: "in_review", note: "تصمیم: اخراج" })))).rejects.toSatisfy(refused);
      await as(tx, w.viceA, (t) => changeStatus(t, w.viceA, { workItemId: ref.workItemId, toStatusCode: "in_review" }));
      expect(await answerOf(ref.workItemId)).toMatchObject({ statusCategory: "doing", answer: null, answerBy: null });

      // The principal's «ثبت پاسخ» closes it: that note is the answer.
      await as(tx, w.principalA, (t) => changeStatus(t, w.principalA, { workItemId: ref.workItemId, toStatusCode: "answered", note: "جلسه با ولی گذاشته شد" }));
      expect(await answerOf(ref.workItemId)).toMatchObject({ statusCategory: "done", answer: "جلسه با ولی گذاشته شد", answerBy: "مریم رضایی" });

      // The counselor who also teaches holds `workspace.work_item.update` and created the item, so they manage it:
      // reopening WITH a text (a forged «answer») is refused; reopening without one goes through — and the file then
      // shows no answer at all, never a note the addressees did not close the request with.
      const [st] = await tx.select({ id: staffProfile.id }).from(staffProfile).where(eq(staffProfile.personId, w.counselorA.personId));
      await assignTeacher(tx, w.admin, { staffProfileId: st.id, classOfferingId: f.OFFERING_A1, role: "assistant" });
      const counselorTeacher = await actor(tx, w.counselorA.personId);
      await expect(sub(tx, (sp) => as(sp, counselorTeacher, (t) => changeStatus(t, counselorTeacher, { workItemId: ref.workItemId, toStatusCode: "answered", note: "پاسخ ساختگی" })))).rejects.toSatisfy(refused);
      await expect(sub(tx, (sp) => as(sp, counselorTeacher, (t) => changeStatus(t, counselorTeacher, { workItemId: ref.workItemId, toStatusCode: "open", note: "پاسخ ساختگی" })))).rejects.toSatisfy(refused);
      await as(tx, counselorTeacher, (t) => changeStatus(t, counselorTeacher, { workItemId: ref.workItemId, toStatusCode: "open" }));
      expect(await answerOf(ref.workItemId)).toMatchObject({ statusCategory: "todo", answer: null });

      // A report request: the teacher answers with a «گزارش به مشاور»; a text on «انجام شد» is refused, and the file
      // never shows a note for it.
      const req = await as(tx, w.counselorA, (t) => requestTeacherReport(t, w.counselorA, { studentProfileId: sid, teacherPersonIds: [w.teacherA2.personId] }));
      await expect(sub(tx, (sp) => as(sp, w.teacherA2, (t) => changeStatus(t, w.teacherA2, { workItemId: req.workItemId, toStatusCode: "done", note: "این دانش‌آموز تقلب کرده" })))).rejects.toSatisfy(refused);
      await as(tx, w.teacherA2, (t) => changeStatus(t, w.teacherA2, { workItemId: req.workItemId, toStatusCode: "done" }));
      expect(await answerOf(req.workItemId)).toMatchObject({ kind: "teacher", statusCategory: "done", answer: null });

      // Nothing refused reached the item's trail: its only notes are the principal's answer.
      const notes = await tx
        .select({ note: workItemTransition.note })
        .from(workItemTransition)
        .where(and(sql`${workItemTransition.workItemId} in (${ref.workItemId}::uuid, ${req.workItemId}::uuid)`, sql`${workItemTransition.note} is not null`));
      expect(notes.map((n) => n.note)).toEqual(["جلسه با ولی گذاشته شد"]);
    });
  });

  it("a school with neither principal nor vice principal: the referral goes to the organization admin", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await revokeRoleAssignment(tx, w.admin, { roleAssignmentId: w.principalBAssignmentId });
      const ref = await as(tx, w.counselorB, (t) => referToManagement(t, w.counselorB, { studentProfileId: w.studentB.studentProfileId, subject: "پیگیری" }));
      const assignees = await tx.select({ personId: workItemAssignee.personId }).from(workItemAssignee).where(eq(workItemAssignee.workItemId, ref.workItemId));
      expect(assignees.map((a) => a.personId)).toEqual([w.admin.personId]);
      // School A's management is never a recipient of school B's referral.
      expect(assignees.map((a) => a.personId)).not.toContain(w.principalA.personId);
    });
  });

  it("«درخواست گزارش از دبیر»: a confidential task to the student's current teachers only; the teacher answers through «گزارش به مشاور»", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const sid = w.studentA1.studentProfileId;
      // Only the student's teachers: the other class's teacher, a principal or the counselor themself are refused.
      for (const other of [w.teacherA2.personId, w.principalA.personId, w.counselorA.personId]) {
        await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => requestTeacherReport(t, w.counselorA, { studentProfileId: sid, teacherPersonIds: [other] })))).rejects.toSatisfy(isError("INVALID_REFERENCE"));
      }
      const req = await as(tx, w.counselorA, (t) => requestTeacherReport(t, w.counselorA, { studentProfileId: sid, teacherPersonIds: [w.teacherA1.personId], message: "وضعیت درسی؟" }));
      const [item] = await tx
        .select({ typeCode: workItemType.code, isConfidential: workItem.isConfidential, description: workItem.description })
        .from(workItem)
        .innerJoin(workItemType, eq(workItemType.id, workItem.typeId))
        .where(eq(workItem.id, req.workItemId));
      expect(item).toMatchObject({ typeCode: "task", isConfidential: true });
      expect(item.description?.startsWith("وضعیت درسی؟")).toBe(true);
      // The teacher's way: the item links to their report page; they report and mark it done.
      expect(await as(tx, w.teacherA1, (t) => counselingLinkForWorkItem(t, w.teacherA1, req.workItemId))).toMatchObject({ kind: "report", href: `/counseling/report/${sid}` });
      // The teacher may read the referral row (they are its addressee) — and nothing else of the file.
      expect(await countAs(tx, w.teacherA1, "referral")).toBe(1);
      expect(await countAs(tx, w.teacherA2, "referral")).toBe(0);
      await as(tx, w.teacherA1, (t) => createTeacherReport(t, w.teacherA1, { studentProfileId: sid, kind: "academic", body: "پاسخ به درخواست" }));
      await as(tx, w.teacherA1, (t) => changeStatus(t, w.teacherA1, { workItemId: req.workItemId, toStatusCode: "done" }));
      const file = await as(tx, w.counselorA, (t) => getStudentFile(t, w.counselorA, sid));
      const r = file.referrals.find((x) => x.workItemId === req.workItemId);
      expect(r).toMatchObject({ kind: "teacher", statusCategory: "done" });
      expect(r?.assignees).toEqual([expect.objectContaining({ personId: w.teacherA1.personId, state: "done" })]);
      expect(file.reports.map((x) => x.body)).toEqual(["پاسخ به درخواست"]);
    });
  });

  it("tenant isolation: another organization sees no counseling row and writes none into this one", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      await as(tx, w.counselorA, (t) => createCounselorNote(t, w.counselorA, note(w, w.studentA1.studentProfileId, "counselors_and_principal")));
      expect(await countAs(tx, w.counselorA, "counselor_note")).toBe(1);
      // The same session under organization B (what a request of B would bind): nothing of A is visible…
      await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_B}, true)`);
      expect(await countAs(tx, w.counselorA, "counselor_note")).toBe(0);
      // …and nothing can be written into A from B.
      await expect(
        sub(tx, (sp) =>
          sp.execute(sql`insert into counseling.referral (id, organization_id, school_id, student_profile_id, work_item_id, kind, created_by_person_id)
                         values (app.uuid_generate_v7(), ${f.ORG_A}::uuid, ${f.SCHOOL_A}::uuid, ${w.studentA1.studentProfileId}::uuid, app.uuid_generate_v7(), 'management', ${w.counselorA.personId}::uuid)`),
        ),
      ).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.INSUFFICIENT_PRIVILEGE);
      await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_A}, true)`);
    });
  });
});
