// «ارتباط ولی و مدرسه» (owner, 2026-10-19; migration 0022; src/modules/iam/guardian-messages.ts). Both layers are
// tested: the service (requireChild, the destinations of the child's school, the owner's rule, the rate limit, the
// confidential `parent_message` item whose creator is no participant) and the database — 0022's CHECK and RESTRICTIVE
// policies decide per `app.current_person_id()`, so every call runs as its actor (`as`: what withTenant binds for a
// request of theirs, switched inside the one test transaction):
//   • 0022: workspace.guardian_message under tenant RLS (ENABLE + FORCE) plus its two RESTRICTIVE policies; app_rw may
//     neither UPDATE nor DELETE it;
//   • a guardian sends to each valid destination — a teacher of one of the child's درس‌ها, the school's counselors, its
//     vice principals, its principal — and exactly those addressees get the confidential item, its inbox row and bell;
//   • «انتقاد» never to a teacher (service AND CHECK); another child's id, a removed student, a teacher who does not
//     teach the child, an office the school does not have, a non-guardian and the organization admin are refused;
//   • only the addressees open it — never the guardian (also a teacher-parent who holds workspace permissions), another
//     teacher, another school's staff, another guardian, the organization admin; the database says the same;
//   • the first addressee's «ثبت پاسخ» (text required) closes it; the guardian reads the status and the answer in
//     «پیام‌های من» and gets ONE notification — the child's name, never the answer; a counselor answers in «مشاوره»;
//   • the audit trail has ids, kinds and lengths only; the rate limit; a replayed form; an ended link;
//   • security review 2026-10-19: D3 — no comment on a «پیام ولی», and a legacy comment bell is pruned with the link;
//     D1 — a message nobody can answer any more goes on (removal, ended teaching, revoke, «افزودن تدریس»; nobody left →
//     open, «در حال ارجاع به مدیریت»; a week → «در انتظار پاسخ») and migration 0023's routing function (definer,
//     grants, who gets what).
// The catalog is seeded in beforeAll; every write runs inside a withTenant transaction that ends with Rollback;
// afterAll re-creates the fixture database (later files assert exact fixture counts).
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, guardianLink, guardianMessage, inboxEntry, notification, workItem, workItemAssignee, workItemComment, workItemWatcher } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { assignTeaching } from "@/lib/admin/teaching";
import { assignTeacher, endTeacherAssignment } from "@/modules/academic/service";
import { type Assignment } from "@/modules/iam/can";
import { addGuardian, unlinkGuardian } from "@/modules/iam/guardian";
import { GUARDIAN_MESSAGE_MESSAGES, MESSAGE_RATE_LIMIT } from "@/modules/iam/guardian-message-policy";
import { COUNSELOR_MESSAGES_HREF, answerAddressedMessage, childMessagesPage, listAddressedMessages, sendGuardianMessage, type SendMessageInput } from "@/modules/iam/guardian-messages";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { removePerson } from "@/modules/iam/removal";
import { listValidAssignments } from "@/modules/iam/repo";
import { assignRole, createStaff, createStudent, revokeRoleAssignment } from "@/modules/iam/service";
import { createAcademicYear, createClassGroup, createClassOffering, createSchool, createSubject } from "@/modules/tenancy/service";
import { listInbox } from "@/modules/workspace/repo";
import {
  ANSWER_TEXT_MESSAGE,
  COMMENT_REFUSED_MESSAGE,
  CONFIDENTIAL_NOTE_MESSAGE,
  addComment,
  canViewWorkItem,
  changeStatus,
  createWorkItem,
  getWorkItemDetail,
} from "@/modules/workspace/service";
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
const bootstrap: Actor = {
  orgId: f.ORG_A,
  personId: f.PERSON_A2,
  userId: null,
  requestId: "int-guardian-message",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const phone = (n: number) => `0912752${String(n).padStart(4, "0")}`;

const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
/** A savepoint, so a failing statement never poisons the test's transaction. */
const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));

/** Binds `app.current_person_id` to `who` (what withTenant does for a request of theirs), then runs `fn`. */
async function as<T>(tx: Tx, who: { personId: string }, fn: (t: Tx) => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.current_person_id', ${who.personId}, true)`);
  return fn(tx);
}

async function actor(tx: Tx, personId: string): Promise<Actor> {
  return { orgId: f.ORG_A, personId, userId: null, requestId: "int-guardian-message", assignments: await listValidAssignments(tx, personId) };
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
  name: string;
}

interface World {
  admin: Actor;
  principalA: Actor;
  viceA: Actor;
  viceA2: Actor;
  counselorA: Actor;
  counselorA2: Actor;
  principalB: Actor;
  counselorB: Actor;
  /** ریاضی of class A1 (the fixture offering). */
  teacherMath: Actor;
  mathOfferingId: string;
  /** علوم of class A1. */
  teacherScience: Actor;
  scienceOfferingId: string;
  /** ریاضی of class A2 — teaches s2, not s1; the parent of s3 (a teacher-parent). */
  teacherA2: Actor;
  offeringA2: string;
  /** Class A1 — g1's child. */
  s1: Student;
  /** Class A2 — g1's other child (siblings). */
  s2: Student;
  /** Class A1 — g3's child, and teacherA2's. */
  s3: Student;
  /** School B — gB's child. */
  sB: Student;
  g1: Actor;
  g1LinkS1: string;
  g3: Actor;
  gB: Actor;
}

/**
 * School A (the fixture school): a principal, two vice principals, two counselors, the ریاضی and علوم teachers of class
 * A1 and the ریاضی teacher of A2. School B of the same organization: a principal and a counselor — no vice principal.
 * Guardians: g1 of s1 (A1) and s2 (A2), g3 and teacherA2 of s3 (A1), gB of sB (school B).
 */
async function buildWorld(tx: Tx): Promise<World> {
  const adminP = await createStaff(tx, bootstrap, { firstName: "محمد", lastName: "امینی", phone: phone(1), createAccount: false });
  await assignRole(tx, { ...bootstrap, personId: adminP.personId }, { personId: adminP.personId, roleCode: "org_admin" });
  const admin = await actor(tx, adminP.personId);

  const schoolB = await createSchool(tx, admin, { name: "دبیرستان دوم", code: "S2", genderPolicy: "girls" });
  const year = await createAcademicYear(tx, admin, {
    schoolId: schoolB.schoolId,
    name: "۱۴۰۵-۱۴۰۶",
    startsOn: "2026-09-23",
    endsOn: "2027-06-21",
    isCurrent: true,
    terms: [{ name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" }],
  });
  const cgB = await createClassGroup(tx, admin, { branchId: schoolB.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "۸/۱" });
  const science = await createSubject(tx, admin, { name: "علوم", code: "SCI" });
  const offScience = await createClassOffering(tx, admin, { classGroupId: f.CLASS_GROUP_A1, subjectId: science.subjectId, termId: f.TERM_A });
  const offA2 = await createClassOffering(tx, admin, { classGroupId: f.CLASS_GROUP_A2, subjectId: f.SUBJECT_A, termId: f.TERM_A });

  type Office = "school_principal" | "vice_principal" | "counselor";
  const staff = (firstName: string, lastName: string, n: number, roles: Array<{ roleCode: Office; schoolId: string }> = [], schoolId?: string) =>
    createStaff(tx, admin, { firstName, lastName, phone: phone(n), createAccount: false, roles, schoolId });
  const pA = await staff("مریم", "رضایی", 2, [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }]);
  const vA = await staff("سارا", "کاظمی", 3, [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }]);
  const vA2 = await staff("لاله", "پاکزاد", 4, [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }]);
  const cA = await staff("نگار", "صادقی", 5, [{ roleCode: "counselor", schoolId: f.SCHOOL_A }]);
  const cA2 = await staff("الهام", "نوری", 6, [{ roleCode: "counselor", schoolId: f.SCHOOL_A }]);
  const pB = await staff("زهرا", "موسوی", 7, [{ roleCode: "school_principal", schoolId: schoolB.schoolId }]);
  const cB = await staff("مهسا", "کریمی", 8, [{ roleCode: "counselor", schoolId: schoolB.schoolId }]);
  const tMath = await staff("علی", "حسینی", 9, [], f.SCHOOL_A);
  const tScience = await staff("رضا", "جعفری", 10, [], f.SCHOOL_A);
  // With an account: its phone is a colleague's login, so «افزودن ولی» with it joins the «ولی» role to this person.
  const tA2 = await createStaff(tx, admin, { firstName: "حسن", lastName: "مرادی", phone: phone(11), schoolId: f.SCHOOL_A });
  await assignTeacher(tx, admin, { staffProfileId: tMath.staffProfileId, classOfferingId: f.OFFERING_A1 });
  await assignTeacher(tx, admin, { staffProfileId: tScience.staffProfileId, classOfferingId: offScience.classOfferingId });
  await assignTeacher(tx, admin, { staffProfileId: tA2.staffProfileId, classOfferingId: offA2.classOfferingId });

  const student = async (firstName: string, lastName: string, number: string, classGroupId: string, guardianPhone: string): Promise<Student> => {
    const res = await createStudent(tx, admin, { firstName, lastName, studentNumber: number, guardianPhone, enrollment: { classGroupId } });
    return { studentProfileId: res.studentProfileId, personId: res.personId, name: `${firstName} ${lastName}` };
  };
  const s1 = await student("لیلا", "نیک‌خواه", "M-1", f.CLASS_GROUP_A1, phone(21));
  const s2 = await student("سارا", "نیک‌خواه", "M-2", f.CLASS_GROUP_A2, phone(21));
  const s3 = await student("نگار", "رستمی", "M-3", f.CLASS_GROUP_A1, phone(23));
  const sB = await student("رها", "شریفی", "M-4", cgB.classGroupId, phone(24));
  const add = (s: Student, p: string, names: { firstName: string; lastName: string }) => addGuardian(tx, admin, { studentProfileId: s.studentProfileId, ...names, phone: p, relation: "mother" });
  const l1 = await add(s1, phone(21), { firstName: "زهره", lastName: "نیک‌خواه" });
  await add(s2, phone(21), { firstName: "زهره", lastName: "نیک‌خواه" });
  const l3 = await add(s3, phone(23), { firstName: "شیرین", lastName: "رستمی" });
  // The A2 teacher is ALSO s3's parent (the «ولی» role joins their own staff account).
  await add(s3, phone(11), { firstName: "حسن", lastName: "مرادی" });
  const lB = await add(sB, phone(24), { firstName: "فرشته", lastName: "شریفی" });

  return {
    admin,
    principalA: await actor(tx, pA.personId),
    viceA: await actor(tx, vA.personId),
    viceA2: await actor(tx, vA2.personId),
    counselorA: await actor(tx, cA.personId),
    counselorA2: await actor(tx, cA2.personId),
    principalB: await actor(tx, pB.personId),
    counselorB: await actor(tx, cB.personId),
    teacherMath: await actor(tx, tMath.personId),
    mathOfferingId: f.OFFERING_A1,
    teacherScience: await actor(tx, tScience.personId),
    scienceOfferingId: offScience.classOfferingId,
    teacherA2: await actor(tx, tA2.personId),
    offeringA2: offA2.classOfferingId,
    s1,
    s2,
    s3,
    sB,
    g1: await actor(tx, l1.guardianPersonId),
    g1LinkS1: l1.linkId,
    g3: await actor(tx, l3.guardianPersonId),
    gB: await actor(tx, lB.guardianPersonId),
  };
}

const msg = (s: Student, over: Partial<SendMessageInput> = {}): SendMessageInput => ({
  studentProfileId: s.studentProfileId,
  kind: "question",
  destination: "principal",
  subject: "زمان جلسهٴ اولیا",
  body: "سلام؛ جلسهٴ اولیا کی برگزار می‌شود؟",
  ...over,
});
const toTeacher = (w: World, s: Student, who: "math" | "science" = "math", over: Partial<SendMessageInput> = {}) =>
  msg(s, {
    destination: "teacher",
    classOfferingId: who === "math" ? w.mathOfferingId : w.scienceOfferingId,
    teacherPersonId: who === "math" ? w.teacherMath.personId : w.teacherScience.personId,
    ...over,
  });

/** What the database lets `who` select of the message rows (0022's RESTRICTIVE policy). */
async function rowsSeenBy(tx: Tx, who: { personId: string }): Promise<string[]> {
  const res = await as(tx, who, (t) => t.execute<{ id: string }>(sql`select id from workspace.guardian_message order by id`));
  return res.rows.map((r) => r.id);
}

describe("«ارتباط ولی و مدرسه» — guardian messages", () => {
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

  it("migration 0022: workspace.guardian_message is tenant-isolated (ENABLE + FORCE) with its two RESTRICTIVE policies; app_rw may neither UPDATE nor DELETE it", async () => {
    await asAppRw(async (c) => {
      const rls = await c.query<{ enabled: boolean; forced: boolean }>(
        `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'workspace' and c.relname = 'guardian_message'`,
      );
      expect(rls.rows).toEqual([{ enabled: true, forced: true }]);
      const policies = await c.query<{ policyname: string; cmd: string; permissive: string; roles: string[] }>(
        `select policyname, cmd, permissive, array(select r::text from unnest(roles) r where r <> 'app_worker' order by r) as roles /* the worker's role (0032) is bound like app_rw */ from pg_policies where schemaname = 'workspace' and tablename = 'guardian_message' order by policyname`,
      );
      expect(policies.rows).toEqual([
        { policyname: "guardian_message_insert", cmd: "INSERT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { policyname: "guardian_message_read", cmd: "SELECT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["public"] },
      ]);
      const priv = await c.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
        `select has_table_privilege('app_rw', 'workspace.guardian_message', 'SELECT') as s, has_table_privilege('app_rw', 'workspace.guardian_message', 'INSERT') as i,
                has_table_privilege('app_rw', 'workspace.guardian_message', 'UPDATE') as u, has_table_privilege('app_rw', 'workspace.guardian_message', 'DELETE') as d`,
      );
      expect(priv.rows[0]).toEqual({ s: true, i: true, u: false, d: false });
      // The earlier REVOKEs of app.apply_grants() survived its re-creation (0020's definition + one).
      const kept = await c.query<{ g: boolean; r: boolean }>(
        `select has_table_privilege('app_rw', 'iam.guardian_link', 'DELETE') as g, has_table_privilege('app_rw', 'counseling.referral', 'UPDATE') as r`,
      );
      expect(kept.rows[0]).toEqual({ g: false, r: false });
    });
  });

  it("a guardian sends to each valid destination — exactly those addressees get the confidential item, its inbox row and bell; the guardian gets no row of the item", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const page = await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId));
      expect(page.child.studentProfileId).toBe(w.s1.studentProfileId);
      expect(page.destinations.schoolId).toBe(f.SCHOOL_A);
      expect(new Set(page.destinations.teachers.map((t) => `${t.subjectName} — ${t.teacherName}`))).toEqual(new Set(["ریاضی — علی حسینی", "علوم — رضا جعفری"]));
      expect(page.destinations.offices).toEqual(["counselor", "vice_principal", "principal"]);
      expect(page.messages).toEqual([]);

      const cases: Array<{ input: SendMessageInput; to: string[]; link: string | null }> = [
        { input: toTeacher(w, w.s1, "math"), to: [w.teacherMath.personId], link: null },
        { input: msg(w.s1, { destination: "counselor", kind: "suggestion" }), to: [w.counselorA.personId, w.counselorA2.personId], link: COUNSELOR_MESSAGES_HREF },
        { input: msg(w.s1, { destination: "vice_principal", kind: "criticism" }), to: [w.viceA.personId, w.viceA2.personId], link: null },
        { input: msg(w.s1, { destination: "principal", kind: "criticism" }), to: [w.principalA.personId], link: null },
      ];
      for (const c of cases) {
        const res = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, c.input));
        expect(res, c.input.destination).toMatchObject({ recipients: c.to.length, duplicate: false });
        const [item] = await tx
          .select({ title: workItem.title, description: workItem.description, confidential: workItem.isConfidential, createdBy: workItem.createdByPersonId })
          .from(workItem)
          .where(eq(workItem.id, res.workItemId));
        expect(item.confidential).toBe(true);
        expect(item.createdBy).toBe(w.g1.personId);
        expect(item.title).toBe(`پیام ولی: ${{ question: "سؤال", suggestion: "پیشنهاد", criticism: "انتقاد" }[c.input.kind]} دربارهٴ ${w.s1.name}`);
        expect(item.title).not.toContain(c.input.subject);
        expect(item.description).toBe(`موضوع: ${c.input.subject}\n\n${c.input.body}`);
        const assignees = await tx.select({ personId: workItemAssignee.personId }).from(workItemAssignee).where(eq(workItemAssignee.workItemId, res.workItemId));
        expect(assignees.map((a) => a.personId).sort()).toEqual([...c.to].sort());
        // The guardian is NOT a participant: no watcher row, no inbox row.
        expect(await tx.select({ p: workItemWatcher.personId }).from(workItemWatcher).where(eq(workItemWatcher.workItemId, res.workItemId))).toEqual([]);
        const inbox = await tx.select({ p: inboxEntry.personId }).from(inboxEntry).where(eq(inboxEntry.workItemId, res.workItemId));
        expect(inbox.map((i) => i.p).sort()).toEqual([...c.to].sort());
        const bells = await tx
          .select({ to: notification.recipientPersonId, title: notification.title, body: notification.body, link: notification.deepLink })
          .from(notification)
          .where(and(eq(notification.sourceId, res.workItemId), eq(notification.typeCode, "work_item.assigned")));
        expect(bells.map((b) => b.to).sort()).toEqual([...c.to].sort());
        for (const b of bells) expect(b).toMatchObject({ title: item.title, body: "زهره نیک‌خواه", link: c.link ?? `/inbox/${res.workItemId}` });
        const [row] = await tx
          .select({ kind: guardianMessage.kind, destination: guardianMessage.destinationKind, offering: guardianMessage.classOfferingId, school: guardianMessage.schoolId, student: guardianMessage.studentProfileId })
          .from(guardianMessage)
          .where(eq(guardianMessage.workItemId, res.workItemId));
        expect(row).toEqual({ kind: c.input.kind, destination: c.input.destination, offering: c.input.destination === "teacher" ? w.mathOfferingId : null, school: f.SCHOOL_A, student: w.s1.studentProfileId });
      }
      // «پیام‌های من»: the four, newest first, all «ارسال‌شده»; s2's page (the sibling) has none of them.
      const mine = await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId));
      expect(mine.messages).toHaveLength(4);
      expect(mine.messages.every((m) => m.state === "sent" && m.answer === null)).toBe(true);
      expect(mine.messages.find((m) => m.destination === "teacher")).toMatchObject({ subjectName: "ریاضی", teacherName: "علی حسینی", subject: "زمان جلسهٴ اولیا" });
      expect((await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s2.studentProfileId))).messages).toEqual([]);
    });
  });

  it("«انتقاد» never goes to a teacher (the service and the CHECK of 0022); another child, a removed student, a teacher who does not teach the child, an office the school lacks, a non-guardian and the organization admin are refused", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const send = (who: Actor, input: SendMessageInput) => sub(tx, (sp) => as(sp, who, (t) => sendGuardianMessage(t, who, input)));
      await expect(send(w.g1, toTeacher(w, w.s1, "math", { kind: "criticism" }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.teacherCriticism));
      // The database refuses the same row on its own (as the guardian, through every other policy).
      const sent = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, toTeacher(w, w.s1)));
      const err = await sub(tx, (sp) =>
        as(sp, w.g1, (t) =>
          t.insert(guardianMessage).values({
            organizationId: f.ORG_A,
            schoolId: f.SCHOOL_A,
            guardianPersonId: w.g1.personId,
            studentProfileId: w.s1.studentProfileId,
            workItemId: sent.workItemId,
            kind: "criticism",
            destinationKind: "teacher",
            classOfferingId: w.mathOfferingId,
          }),
        ),
      ).catch((e: unknown) => e);
      expect(pgCode(err)).toBe(PG.CHECK_VIOLATION);
      // …and a row in someone else's name (the RESTRICTIVE insert policy).
      const forged = await sub(tx, (sp) =>
        as(sp, w.g3, (t) =>
          t.insert(guardianMessage).values({ organizationId: f.ORG_A, schoolId: f.SCHOOL_A, guardianPersonId: w.g1.personId, studentProfileId: w.s1.studentProfileId, workItemId: sent.workItemId, kind: "question", destinationKind: "principal" }),
        ),
      ).catch((e: unknown) => e);
      expect(pgCode(forged)).toBe(PG.INSUFFICIENT_PRIVILEGE);

      // Another family's child, a child of another school: NOT_FOUND — the same answer an unknown id gets.
      await expect(send(w.g1, msg(w.s3))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(send(w.g1, msg(w.sB))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(send(w.g1, msg({ ...w.s3, studentProfileId: "0199a000-000d-7000-8000-00000000dead" }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // A teacher who does not teach s1 (A2's), a درس × teacher pair that does not exist, no teacher at all.
      await expect(send(w.g1, msg(w.s1, { destination: "teacher", classOfferingId: w.offeringA2, teacherPersonId: w.teacherA2.personId }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.notTheirTeacher));
      await expect(send(w.g1, msg(w.s1, { destination: "teacher", classOfferingId: w.mathOfferingId, teacherPersonId: w.teacherScience.personId }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.notTheirTeacher));
      await expect(send(w.g1, msg(w.s1, { destination: "teacher" }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.pickTeacher));
      // School B has no vice principal: a clear Persian error naming the office (its principal and counselor are there).
      await expect(send(w.gB, msg(w.sB, { destination: "vice_principal" }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.noVicePrincipal));
      expect((await as(tx, w.gB, (t) => childMessagesPage(t, w.gB, w.sB.studentProfileId))).destinations.offices).toEqual(["counselor", "principal"]);
      expect(await as(tx, w.gB, (t) => sendGuardianMessage(t, w.gB, msg(w.sB, { destination: "counselor" })))).toMatchObject({ recipients: 1 });
      // Not a guardian, or a manager whose organization-wide role matches every chain: no child of theirs, NOT_FOUND.
      for (const who of [w.teacherMath, w.principalA, w.counselorA, w.admin]) await expect(send(who, msg(w.s1)), who.personId).rejects.toSatisfy(isError("NOT_FOUND"));
      // Empty or whitespace text never reaches a row (the DTO refuses it first; the service once more).
      await expect(send(w.g1, msg(w.s1, { subject: " \n " }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.subjectRequired));
      await expect(send(w.g1, msg(w.s1, { body: "   " }))).rejects.toSatisfy(isError("VALIDATION", GUARDIAN_MESSAGE_MESSAGES.bodyRequired));
      // A removed student: the links end with them — nothing more can be sent about them.
      await removePerson(tx, w.admin, { personId: w.s1.personId, kind: "student" });
      await expect(send(w.g1, msg(w.s1))).rejects.toSatisfy(isError("NOT_FOUND"));
    });
  });

  it("only the addressees open it: never the guardian (a teacher-parent included), another teacher, the other offices, another school's staff, another guardian or the organization admin — in the service and in the database", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, toTeacher(w, w.s1, "math")));
      // The teacher-parent (A2's teacher) writes about their own child s3 to its ریاضی teacher.
      const tp = await as(tx, w.teacherA2, (t) => sendGuardianMessage(t, w.teacherA2, toTeacher(w, w.s3, "math", { kind: "suggestion" })));

      const opens = (who: Actor, id: string) => sub(tx, (sp) => as(sp, who, (t) => getWorkItemDetail(t, who, id)));
      expect((await opens(w.teacherMath, m.workItemId)).item.typeCode).toBe("parent_message");
      for (const who of [w.g1, w.g3, w.gB, w.teacherScience, w.teacherA2, w.principalA, w.viceA, w.counselorA, w.principalB, w.counselorB, w.admin]) {
        await expect(opens(who, m.workItemId), who.personId).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      // The teacher-parent holds workspace permissions as a teacher — and still never opens, manages or lists their message.
      await expect(opens(w.teacherA2, tp.workItemId)).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(sub(tx, (sp) => as(sp, w.teacherA2, (t) => changeStatus(t, w.teacherA2, { workItemId: tp.workItemId, toStatusCode: "rejected" })))).rejects.toSatisfy(isError("NOT_FOUND"));
      const theirList = await as(tx, w.teacherA2, (t) => listInbox(t, w.teacherA2.personId, { tab: "all", limit: 100 }));
      expect(theirList.rows.map((r) => r.id)).not.toContain(tp.workItemId);
      const mathList = await as(tx, w.teacherMath, (t) => listInbox(t, w.teacherMath.personId, { tab: "all", limit: 100 }));
      expect(mathList.rows.filter((r) => r.typeCode === "parent_message").map((r) => r.id).sort()).toEqual([m.workItemId, tp.workItemId].sort());
      for (const who of [w.principalA, w.admin, w.teacherScience]) {
        const list = await as(tx, who, (t) => listInbox(t, who.personId, { tab: "all", limit: 100 }));
        expect(list.rows.filter((r) => r.typeCode === "parent_message"), who.personId).toEqual([]);
      }
      // The database: the sender and the addressee select the rows; nobody else does.
      // (read as the ریاضی teacher — the addressee of both — since RLS decides per person)
      const ids = await as(tx, w.teacherMath, (t) =>
        t.select({ id: guardianMessage.id, wi: guardianMessage.workItemId }).from(guardianMessage).where(inArray(guardianMessage.workItemId, [m.workItemId, tp.workItemId])),
      );
      expect(ids).toHaveLength(2);
      const idOf = (wi: string) => ids.find((r) => r.wi === wi)!.id;
      expect(await rowsSeenBy(tx, w.g1)).toEqual([idOf(m.workItemId)]);
      expect(await rowsSeenBy(tx, w.teacherA2)).toEqual([idOf(tp.workItemId)]);
      expect(await rowsSeenBy(tx, w.teacherMath)).toEqual([idOf(m.workItemId), idOf(tp.workItemId)].sort());
      for (const who of [w.g3, w.gB, w.teacherScience, w.principalA, w.counselorA, w.principalB, w.admin]) expect(await rowsSeenBy(tx, who), who.personId).toEqual([]);
      // Another organization sees nothing.
      await asAppRw(async (c) => {
        await c.query("begin");
        try {
          await c.query("select set_config('app.current_org_id', $1, true), set_config('app.current_person_id', $2, true)", [f.ORG_B, f.PERSON_B1]);
          expect((await c.query<{ n: number }>("select count(*)::int as n from workspace.guardian_message")).rows[0].n).toBe(0);
        } finally {
          await c.query("rollback");
        }
      });
    });
  });

  it("the first addressee's «ثبت پاسخ» — text required — closes it for all; the guardian reads status and answer and gets ONE notification without the answer; the trail keeps no text", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const subject = "رفتار سرویس مدرسه";
      const body = "راننده‌ی سرویس صبح‌ها دیر می‌رسد و بچه‌ها زنگ اول را از دست می‌دهند.";
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1, { destination: "vice_principal", kind: "criticism", subject, body })));
      const answerOf = (who: Actor, note: string | null, code = "answered") => sub(tx, (sp) => as(sp, who, (t) => changeStatus(t, who, { workItemId: m.workItemId, toStatusCode: code, note })));
      // «در حال بررسی» with text is refused on a confidential item (only the closing answer carries text); an empty answer too.
      await expect(answerOf(w.viceA, "بررسی می‌کنیم", "in_review")).rejects.toSatisfy(isError("VALIDATION", CONFIDENTIAL_NOTE_MESSAGE));
      await expect(answerOf(w.viceA, null)).rejects.toSatisfy(isError("VALIDATION", ANSWER_TEXT_MESSAGE));
      await expect(answerOf(w.viceA, "   ")).rejects.toSatisfy(isError("VALIDATION", ANSWER_TEXT_MESSAGE));
      expect(await answerOf(w.viceA, null, "in_review")).toMatchObject({ itemChanged: true });
      const answer = "با شرکت سرویس صحبت شد؛ از شنبه زودتر حرکت می‌کنند.";
      expect(await answerOf(w.viceA, answer)).toMatchObject({ statusCode: "answered", itemChanged: true });
      // The other vice principal reads it closed; nobody answers twice.
      await expect(answerOf(w.viceA2, "پاسخ دوم")).rejects.toSatisfy(isError("VALIDATION"));

      const page = await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId));
      expect(page.messages).toEqual([
        expect.objectContaining({ kind: "criticism", destination: "vice_principal", subject, body, state: "answered", answer, teacherName: null, subjectName: null }),
      ]);
      expect(page.messages[0].answeredAt).toBeInstanceOf(Date);
      const bell = await tx
        .select({ title: notification.title, body: notification.body, link: notification.deepLink, payload: notification.payload })
        .from(notification)
        .where(and(eq(notification.recipientPersonId, w.g1.personId), eq(notification.typeCode, "guardian.message_answered")));
      expect(bell).toEqual([{ title: `پاسخ مدرسه به پیام شما دربارهٴ ${w.s1.name}`, body: null, link: `/child/messages?child=${w.s1.studentProfileId}`, payload: { studentProfileId: w.s1.studentProfileId } }]);
      // Nothing else of the item reaches the guardian's bell (the creation, the «در حال بررسی»).
      const all = await tx.select({ type: notification.typeCode }).from(notification).where(eq(notification.recipientPersonId, w.g1.personId));
      expect(all.map((n) => n.type)).toEqual(["guardian.message_answered"]);

      // The audit trail: ids, kinds and lengths — never the subject, the body or the answer.
      const trail = await tx.select({ action: auditLog.action, before: auditLog.before, after: auditLog.after }).from(auditLog).where(sql`${auditLog.action} in ('workspace.guardian_message.created', 'workspace.work_item.created', 'workspace.work_item.status_changed')`);
      expect(trail.map((t) => t.action).sort()).toEqual(["workspace.guardian_message.created", "workspace.work_item.created", "workspace.work_item.status_changed", "workspace.work_item.status_changed"].sort());
      const text = JSON.stringify(trail);
      for (const secret of [subject, body, answer, "سرویس"]) expect(text, secret).not.toContain(secret);
      expect(trail.find((t) => t.action === "workspace.guardian_message.created")!.after).toMatchObject({ kind: "criticism", destination: "vice_principal", recipients: 2, subjectLength: subject.length, bodyLength: body.length });
      expect(trail.find((t) => t.action === "workspace.work_item.status_changed" && (t.after as { statusCode: string }).statusCode === "answered")!.after).toMatchObject({ noteLength: answer.length });
    });
  });

  it("a counselor answers in «مشاوره»: their list holds only the messages given to them; another school's counselor or a non-addressee cannot answer; the workspace gate would refuse a counselor", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1, { destination: "counselor", kind: "suggestion", subject: "کلاس مطالعه", body: "پیشنهاد کلاس مطالعهٴ عصر را دارم." })));
      await as(tx, w.gB, (t) => sendGuardianMessage(t, w.gB, msg(w.sB, { destination: "counselor" })));
      const listOf = (who: Actor) => as(tx, who, (t) => listAddressedMessages(t, who));
      const a = await listOf(w.counselorA);
      expect(a).toEqual([expect.objectContaining({ workItemId: m.workItemId, kind: "suggestion", fromName: "زهره نیک‌خواه", studentName: w.s1.name, subject: "کلاس مطالعه", open: true, answer: null })]);
      expect((await listOf(w.counselorA2)).map((r) => r.workItemId)).toEqual([m.workItemId]);
      expect((await listOf(w.counselorB)).map((r) => r.workItemId)).not.toContain(m.workItemId);
      expect(await listOf(w.principalA)).toEqual([]);
      const answer = (who: Actor, text: string) => sub(tx, (sp) => as(sp, who, (t) => answerAddressedMessage(t, who, { workItemId: m.workItemId, answer: text })));
      for (const who of [w.counselorB, w.teacherMath, w.g1]) await expect(answer(who, "پاسخ"), who.personId).rejects.toSatisfy(isError("NOT_FOUND"));
      // A counselor holds no workspace.* permission: the «پنل من» path refuses them (that is why «مشاوره» answers).
      await expect(sub(tx, (sp) => as(sp, w.counselorA, (t) => changeStatus(t, w.counselorA, { workItemId: m.workItemId, toStatusCode: "answered", note: "پاسخ" })))).rejects.toSatisfy(isError("FORBIDDEN"));
      expect(await answer(w.counselorA, "عالی است؛ از هفتهٴ بعد برگزار می‌شود.")).toEqual({ closed: true });
      expect((await listOf(w.counselorA2))[0]).toMatchObject({ open: false, answer: "عالی است؛ از هفتهٴ بعد برگزار می‌شود.", answeredBy: "نگار صادقی" });
      await expect(answer(w.counselorA2, "دوباره")).rejects.toSatisfy(isError("VALIDATION"));
      expect((await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId))).messages[0]).toMatchObject({ state: "answered", answer: "عالی است؛ از هفتهٴ بعد برگزار می‌شود." });
      const bell = await tx.select({ id: notification.id }).from(notification).where(and(eq(notification.recipientPersonId, w.g1.personId), eq(notification.typeCode, "guardian.message_answered")));
      expect(bell).toHaveLength(1);
    });
  });

  it(`the rate limit: the ${MESSAGE_RATE_LIMIT + 1}th message about one child within an hour is refused, a sibling's are counted apart, and a replayed form returns the first send`, async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const keys: string[] = [];
      for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) {
        const key = `0199a000-00cc-7000-8000-${String(i).padStart(12, "0")}`;
        keys.push(key);
        await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1, { subject: `موضوع ${i}`, idempotencyKey: key })));
      }
      await expect(sub(tx, (sp) => as(sp, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1))))).rejects.toSatisfy(isError("RATE_LIMITED", GUARDIAN_MESSAGE_MESSAGES.rateLimited));
      // A double tap of the last form (same key) is that message again — not counted, not refused.
      const replay = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1, { subject: "موضوع ۹", idempotencyKey: keys[MESSAGE_RATE_LIMIT - 1] })));
      expect(replay.duplicate).toBe(true);
      expect(await tx.select({ id: guardianMessage.id }).from(guardianMessage).where(eq(guardianMessage.studentProfileId, w.s1.studentProfileId))).toHaveLength(MESSAGE_RATE_LIMIT);
      // The sibling has a limit of their own.
      expect(await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s2)))).toMatchObject({ duplicate: false });
    });
  });

  it("an ended link: the child's messages leave the guardian's page and an answer given afterwards reaches nobody's bell", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1)));
      await unlinkGuardian(tx, w.admin, { linkId: w.g1LinkS1 });
      const g1 = await actor(tx, w.g1.personId); // the session after the link ended: s2's assignment only
      await expect(sub(tx, (sp) => as(sp, g1, (t) => childMessagesPage(t, g1, w.s1.studentProfileId)))).rejects.toSatisfy(isError("NOT_FOUND"));
      // The school can still answer (the message stays with its addressees) — but no former child's name reaches the bell.
      expect(await as(tx, w.principalA, (t) => changeStatus(t, w.principalA, { workItemId: m.workItemId, toStatusCode: "answered", note: "پاسخ" }))).toMatchObject({ itemChanged: true });
      expect(await tx.select({ id: notification.id }).from(notification).where(and(eq(notification.recipientPersonId, w.g1.personId), eq(notification.typeCode, "guardian.message_answered")))).toEqual([]);
      expect(await canViewWorkItem(tx, w.principalA, m.workItemId)).toMatchObject({ statusCategory: "done" });
    });
  });

  it("security review D3 — no comment on a «پیام ولی»: `addComment` refuses it and nothing reaches the guardian; a work-item bell about their own message (written before the fix) is pruned when a link ends, a colleague's work-item bell never", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, toTeacher(w, w.s1, "math")));
      const comment = (who: Actor, body: string) => sub(tx, (sp) => as(sp, who, (t) => addComment(t, who, { workItemId: m.workItemId, body })));
      // The addressee holds `workspace.work_item.comment` (a teacher) and is refused; anyone else still gets NOT_FOUND first.
      await expect(comment(w.teacherMath, "نظری دربارهٴ این پیام")).rejects.toSatisfy(isError("VALIDATION", COMMENT_REFUSED_MESSAGE));
      for (const who of [w.teacherScience, w.principalA, w.g1]) await expect(comment(who, "نظر"), who.personId).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await tx.select({ id: workItemComment.id }).from(workItemComment).where(eq(workItemComment.workItemId, m.workItemId))).toEqual([]);
      expect(await tx.select({ id: notification.id }).from(notification).where(eq(notification.recipientPersonId, w.g1.personId))).toEqual([]);

      // Rows a comment wrote before this fix: to the guardian about their message, and to its addressee. The teacher-parent
      // (A2's teacher, s3's parent) has one about THEIR message and an ordinary «تسک» bell as a colleague.
      const tp = await as(tx, w.teacherA2, (t) => sendGuardianMessage(t, w.teacherA2, toTeacher(w, w.s3, "math", { kind: "suggestion" })));
      const task = await createWorkItem(tx, w.admin, { typeCode: "task", title: "تحویل برنامهٴ درسی", priority: "normal", recipients: { kind: "persons", ids: [w.teacherA2.personId] } });
      const legacy = (recipientPersonId: string, workItemId: string) => ({
        organizationId: f.ORG_A,
        recipientPersonId,
        typeCode: "work_item.comment",
        title: "نظر جدید: پیام ولی",
        body: "علی حسینی: متن نظر",
        sourceKind: "work_item",
        sourceId: workItemId,
        deepLink: `/inbox/${workItemId}`,
      });
      await tx.insert(notification).values([legacy(w.g1.personId, m.workItemId), legacy(w.teacherMath.personId, m.workItemId), legacy(w.teacherA2.personId, tp.workItemId)]);
      const bellOf = async (personId: string) =>
        (await tx.select({ type: notification.typeCode, source: notification.sourceId }).from(notification).where(eq(notification.recipientPersonId, personId))).map((n) => `${n.type}:${n.source}`).sort();

      // g1 keeps the sibling (s2): the link to s1 ends, the login stays — and the comment row about their message goes.
      await unlinkGuardian(tx, w.admin, { linkId: w.g1LinkS1 });
      expect(await bellOf(w.g1.personId)).toEqual([]);
      expect(await bellOf(w.teacherMath.personId)).toContain(`work_item.comment:${m.workItemId}`);
      const [linkS3] = await tx
        .select({ id: guardianLink.id })
        .from(guardianLink)
        .where(and(eq(guardianLink.guardianPersonId, w.teacherA2.personId), eq(guardianLink.studentProfileId, w.s3.studentProfileId)));
      await unlinkGuardian(tx, w.admin, { linkId: linkS3.id });
      expect(await bellOf(w.teacherA2.personId)).toEqual([`work_item.assigned:${task.id}`]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // security review D1 — a message nobody can answer any more goes on (iam/guardian-message-routing, migration 0023)
  // ---------------------------------------------------------------------------------------------------------------

  const assigneesOf = async (tx: Tx, workItemId: string) =>
    (await tx.select({ p: workItemAssignee.personId }).from(workItemAssignee).where(and(eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.role, "assignee")))).map((a) => a.p).sort();
  const reroutesOf = (tx: Tx, workItemId: string) =>
    tx
      .select({ before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, "workspace.guardian_message.rerouted"), eq(auditLog.entityId, workItemId)));
  const assignedBells = async (tx: Tx, workItemId: string) =>
    (
      await tx
        .select({ to: notification.recipientPersonId, title: notification.title, body: notification.body, link: notification.deepLink })
        .from(notification)
        .where(and(eq(notification.sourceId, workItemId), eq(notification.typeCode, "work_item.assigned")))
    ).sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  const unreadInbox = async (tx: Tx, workItemId: string) =>
    (await tx.select({ p: inboxEntry.personId }).from(inboxEntry).where(and(eq(inboxEntry.workItemId, workItemId), eq(inboxEntry.state, "unread")))).map((i) => i.p).sort();
  const teachingOf = async (tx: Tx, personId: string, classOfferingId: string) => {
    const res = await tx.execute<{ id: string }>(sql`
      select ta.id from academic.teacher_assignment ta join iam.staff_profile stp on stp.id = ta.staff_profile_id
      where stp.person_id = ${personId}::uuid and ta.class_offering_id = ${classOfferingId}::uuid and ta.valid_to is null`);
    return res.rows[0].id;
  };
  const officeOf = async (tx: Tx, personId: string, code: string) => {
    const res = await tx.execute<{ id: string }>(sql`
      select ra.id from iam.role_assignment ra join iam.role r on r.id = ra.role_id
      where ra.person_id = ${personId}::uuid and r.code = ${code} and ra.revoked_at is null`);
    return res.rows[0].id;
  };
  const sorted = (...ids: string[]) => [...ids].sort();

  it("security review D1 — school A empties: the sole principal removed → the principal's message goes to the vice principals; the ریاضی teaching ended → the teacher's message too; both vice principals removed → a message is left with nobody, open, «در حال ارجاع به مدیریت»; a week without an answer reads «در انتظار پاسخ»", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const send = (input: SendMessageInput) => as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, input));
      const toPrincipal = await send(msg(w.s1, { destination: "principal" }));
      const toMath = await send(toTeacher(w, w.s1, "math"));
      const toVice = await send(msg(w.s1, { destination: "vice_principal", kind: "criticism" }));
      const toCounselor = await send(msg(w.s1, { destination: "counselor", kind: "suggestion" }));
      const vices = sorted(w.viceA.personId, w.viceA2.personId);
      const title = (id: string) => tx.select({ t: workItem.title }).from(workItem).where(eq(workItem.id, id)).then((r) => r[0].t);

      // 1. The principal removed: their message has no live addressee → «مدیر مدرسه» (none left) → the vice principals.
      const removedP = await as(tx, w.admin, (t) => removePerson(t, w.admin, { personId: w.principalA.personId, kind: "staff" }));
      expect(removedP).toMatchObject({ withdrawnWorkItems: 1, reroutedGuardianMessages: 1 });
      expect(await assigneesOf(tx, toPrincipal.workItemId)).toEqual(vices);
      expect(await unreadInbox(tx, toPrincipal.workItemId)).toEqual(vices);
      // The standard bell, as a send gives it (the removed principal keeps theirs from the send).
      const bellsP = await assignedBells(tx, toPrincipal.workItemId);
      expect(bellsP.map((b) => b.to)).toEqual(sorted(w.principalA.personId, ...vices));
      const itemTitle = await title(toPrincipal.workItemId);
      expect(bellsP.filter((b) => vices.includes(b.to))).toEqual(vices.map((to) => ({ to, title: itemTitle, body: "زهره نیک‌خواه", link: `/inbox/${toPrincipal.workItemId}` })));
      const [r1] = await reroutesOf(tx, toPrincipal.workItemId);
      expect(r1.before).toEqual({ assigneeIds: [] });
      expect(r1.after).toEqual({ reason: "removed", fromPersonId: w.principalA.personId, schoolId: f.SCHOOL_A, destination: "principal", step: "vice_principal", addedPersonIds: vices });
      // The other messages had live addressees: untouched.
      expect(await assigneesOf(tx, toMath.workItemId)).toEqual([w.teacherMath.personId]);
      expect(await assigneesOf(tx, toVice.workItemId)).toEqual(vices);
      // A vice principal opens it now; the guardian's tag is still «ارسال‌شده» (someone holds it).
      expect((await as(tx, w.viceA, (t) => getWorkItemDetail(t, w.viceA, toPrincipal.workItemId))).item.typeCode).toBe("parent_message");

      // 2. The ریاضی teaching ended (no other teacher of it, no principal): the teacher's message → the vice principals.
      //    The teacher keeps their row and still reads the item (docs/decisions.md «Open (owner)», D2).
      const ended = await as(tx, w.admin, async (t) => endTeacherAssignment(t, w.admin, { teacherAssignmentId: await teachingOf(t, w.teacherMath.personId, w.mathOfferingId) }));
      expect(ended.personId).toBe(w.teacherMath.personId);
      expect(await assigneesOf(tx, toMath.workItemId)).toEqual(sorted(w.teacherMath.personId, ...vices));
      expect(await assignedBells(tx, toMath.workItemId)).toEqual(
        sorted(w.teacherMath.personId, ...vices).map((to) => ({ to, title: expect.any(String), body: "زهره نیک‌خواه", link: `/inbox/${toMath.workItemId}` })),
      );
      expect((await reroutesOf(tx, toMath.workItemId)).map((r) => r.after)).toEqual([
        { reason: "teaching_ended", fromPersonId: w.teacherMath.personId, schoolId: f.SCHOOL_A, destination: "teacher", step: "vice_principal", addedPersonIds: vices },
      ]);
      expect(await canViewWorkItem(tx, w.teacherMath, toMath.workItemId)).toMatchObject({ statusCategory: "todo" });
      // The guardian still reads «ریاضی — <the teacher they picked>» — a vice principal is never named.
      const page = await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId));
      expect(page.messages.find((m) => m.destination === "teacher")).toMatchObject({ subjectName: "ریاضی", teacherName: "علی حسینی", state: "sent" });
      // A re-routed addressee answers; the guardian hears of it as from any addressee.
      expect(await as(tx, w.viceA, (t) => changeStatus(t, w.viceA, { workItemId: toMath.workItemId, toStatusCode: "answered", note: "معاون آموزشی پیگیری می‌کند." }))).toMatchObject({ itemChanged: true });
      expect(await tx.select({ id: notification.id }).from(notification).where(and(eq(notification.recipientPersonId, w.g1.personId), eq(notification.typeCode, "guardian.message_answered")))).toHaveLength(1);

      // 3. Both vice principals removed: the first leaves the other live (nothing moves); the second leaves nobody at
      //    the school for the principal's and the vice principal's messages — open, no assignee, «در حال ارجاع به مدیریت».
      expect(await as(tx, w.admin, (t) => removePerson(t, w.admin, { personId: w.viceA.personId, kind: "staff" }))).toMatchObject({ reroutedGuardianMessages: 0 });
      expect(await assigneesOf(tx, toVice.workItemId)).toEqual([w.viceA2.personId]);
      expect(await reroutesOf(tx, toVice.workItemId)).toEqual([]);
      expect(await as(tx, w.admin, (t) => removePerson(t, w.admin, { personId: w.viceA2.personId, kind: "staff" }))).toMatchObject({ reroutedGuardianMessages: 0 });
      const steps = async (workItemId: string) => (await reroutesOf(tx, workItemId)).map((r) => (r.after as { step: string }).step).sort();
      expect(await steps(toPrincipal.workItemId)).toEqual(["nobody", "vice_principal"]);
      expect(await steps(toVice.workItemId)).toEqual(["nobody"]);
      for (const m of [toPrincipal, toVice]) expect(await assigneesOf(tx, m.workItemId)).toEqual([]);
      expect((await reroutesOf(tx, toVice.workItemId))[0].after).toEqual({ reason: "removed", fromPersonId: w.viceA2.personId, schoolId: f.SCHOOL_A, destination: "vice_principal", step: "nobody", addedPersonIds: [] });

      const now = new Date();
      const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
      const stateOf = async (at: Date) => {
        const p = await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId, at));
        const by = (destination: string) => p.messages.find((m) => m.destination === destination)!.state;
        return { principal: by("principal"), teacher: by("teacher"), vice: by("vice_principal"), counselor: by("counselor") };
      };
      expect(await stateOf(now)).toEqual({ principal: "routing", teacher: "answered", vice: "routing", counselor: "sent" });
      expect(await stateOf(later)).toEqual({ principal: "routing", teacher: "answered", vice: "routing", counselor: "waiting" });
      // The audit rows of the re-route carry ids and kinds only.
      const trail = JSON.stringify(await tx.select({ after: auditLog.after }).from(auditLog).where(eq(auditLog.action, "workspace.guardian_message.rerouted")));
      for (const secret of ["زمان جلسهٴ اولیا", "جلسهٴ اولیا کی", "معاون آموزشی", "زهره"]) expect(trail, secret).not.toContain(secret);
      expect(await assigneesOf(tx, toCounselor.workItemId)).toEqual(sorted(w.counselorA.personId, w.counselorA2.personId));
    });
  });

  it("security review D1 — the last counselor's role revoked (by the principal) → the counselor message goes to the principal, who gets the item but no bell of their own act; the counselors keep their rows; school B's sole counselor revoked → its principal, belled, answering in «پنل من»", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1, { destination: "counselor", kind: "suggestion" })));
      const counselors = sorted(w.counselorA.personId, w.counselorA2.personId);
      const revoke = (who: Actor, personId: string) => as(tx, who, async (t) => revokeRoleAssignment(t, who, { roleAssignmentId: await officeOf(t, personId, "counselor") }));

      // The other counselor still holds the office: nothing moves.
      await revoke(w.principalA, w.counselorA.personId);
      expect(await assigneesOf(tx, m.workItemId)).toEqual(counselors);
      expect(await reroutesOf(tx, m.workItemId)).toEqual([]);
      // No counselor left: «مشاور» (none) → «مدیر مدرسه» — the principal who revoked it.
      await revoke(w.principalA, w.counselorA2.personId);
      expect(await assigneesOf(tx, m.workItemId)).toEqual(sorted(...counselors, w.principalA.personId));
      expect((await reroutesOf(tx, m.workItemId)).map((r) => r.after)).toEqual([
        { reason: "role_revoked", fromPersonId: w.counselorA2.personId, schoolId: f.SCHOOL_A, destination: "counselor", step: "principal", addedPersonIds: [w.principalA.personId] },
      ]);
      expect(await unreadInbox(tx, m.workItemId)).toContain(w.principalA.personId);
      expect((await assignedBells(tx, m.workItemId)).map((b) => b.to)).toEqual(counselors); // the send's bells; none for the actor
      expect(await as(tx, w.principalA, (t) => changeStatus(t, w.principalA, { workItemId: m.workItemId, toStatusCode: "answered", note: "به‌زودی مشاور تازه معرفی می‌شود." }))).toMatchObject({ itemChanged: true });
      expect((await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId))).messages[0]).toMatchObject({ state: "answered", answer: "به‌زودی مشاور تازه معرفی می‌شود." });

      // School B (one counselor, a principal, no vice principal), revoked by the organization admin.
      const mb = await as(tx, w.gB, (t) => sendGuardianMessage(t, w.gB, msg(w.sB, { destination: "counselor" })));
      await revoke(w.admin, w.counselorB.personId);
      expect(await assigneesOf(tx, mb.workItemId)).toEqual(sorted(w.counselorB.personId, w.principalB.personId));
      const bells = await assignedBells(tx, mb.workItemId);
      expect(bells.find((b) => b.to === w.principalB.personId)).toMatchObject({ link: `/inbox/${mb.workItemId}`, body: "فرشته شریفی" });
      expect(bells.find((b) => b.to === w.counselorB.personId)).toMatchObject({ link: COUNSELOR_MESSAGES_HREF });
      expect((await as(tx, w.principalB, (t) => listInbox(t, w.principalB.personId, { tab: "all", limit: 100 }))).rows.map((r) => r.id)).toContain(mb.workItemId);
    });
  });

  it("security review D1 — «افزودن تدریس» replacing the ریاضی main teacher: the teacher's message goes to the NEW teacher of the درس (the same destination), never to the management; the guardian reads the درس's teacher now", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, toTeacher(w, w.s1, "math")));
      const next = await createStaff(tx, w.admin, { firstName: "بهاره", lastName: "سلیمی", phone: phone(12), createAccount: false, schoolId: f.SCHOOL_A });
      const rctx = { ...w.admin, userId: "00000000-0000-7000-8000-000000000000", ip: "127.0.0.1", userAgent: null };
      await as(tx, w.admin, (t) => assignTeaching(t, rctx, { personId: next.personId, classGroupId: f.CLASS_GROUP_A1, classOfferingId: w.mathOfferingId, role: "main", replaceMain: true }));
      expect(await assigneesOf(tx, m.workItemId)).toEqual(sorted(w.teacherMath.personId, next.personId));
      expect((await reroutesOf(tx, m.workItemId)).map((r) => r.after)).toEqual([
        { reason: "teaching_ended", fromPersonId: w.teacherMath.personId, schoolId: f.SCHOOL_A, destination: "teacher", step: "same", addedPersonIds: [next.personId] },
      ]);
      expect((await assignedBells(tx, m.workItemId)).find((b) => b.to === next.personId)).toMatchObject({ link: `/inbox/${m.workItemId}` });
      expect((await as(tx, w.g1, (t) => childMessagesPage(t, w.g1, w.s1.studentProfileId))).messages[0]).toMatchObject({ subjectName: "ریاضی", teacherName: "بهاره سلیمی", state: "sent" });
    });
  });

  it("migration 0023: app.guardian_message_routes is SECURITY DEFINER (app_owner, pinned search_path), EXECUTE for app_rw only, and gives the routing facts — nothing else — of a person's OPEN messages to a manager of that school only; the table's policies are unchanged", async () => {
    await asAppRw(async (c) => {
      const fn = await c.query<{ secdef: boolean; owner: string; config: string[]; rw: boolean; backup: boolean; args: string; result: string }>(
        `select p.prosecdef as secdef, pg_get_userbyid(p.proowner) as owner, p.proconfig::text[] as config,
                has_function_privilege('app_rw', p.oid, 'EXECUTE') as rw, has_function_privilege('app_backup', p.oid, 'EXECUTE') as backup,
                pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'guardian_message_routes'`,
      );
      expect(fn.rows).toEqual([
        {
          secdef: true,
          owner: "app_owner",
          config: ["search_path=pg_catalog, app, pg_temp"],
          rw: true,
          backup: false,
          args: "p_person_id uuid",
          result: "TABLE(work_item_id uuid, school_id uuid, student_profile_id uuid, destination_kind text, class_offering_id uuid)",
        },
      ]);
    });
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const m = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, msg(w.s1, { destination: "principal" })));
      const t2 = await as(tx, w.g1, (t) => sendGuardianMessage(t, w.g1, toTeacher(w, w.s1, "science")));
      const routesSeenBy = async (who: { personId: string }, of: string) =>
        (await as(tx, who, (t) => t.execute(sql`select * from app.guardian_message_routes(${of}::uuid) order by work_item_id`))).rows;
      // A manager of school A — the organization admin, a vice principal — gets the facts.
      const expected = [{ work_item_id: m.workItemId, school_id: f.SCHOOL_A, student_profile_id: w.s1.studentProfileId, destination_kind: "principal", class_offering_id: null }];
      expect(await routesSeenBy(w.admin, w.principalA.personId)).toEqual(expected);
      expect(await routesSeenBy(w.viceA, w.principalA.personId)).toEqual(expected);
      expect(await routesSeenBy(w.admin, w.teacherScience.personId)).toEqual([
        { work_item_id: t2.workItemId, school_id: f.SCHOOL_A, student_profile_id: w.s1.studentProfileId, destination_kind: "teacher", class_offering_id: w.scienceOfferingId },
      ]);
      // Nobody else: another school's principal, a teacher, a counselor, the guardian — and an unrelated person has none.
      for (const who of [w.principalB, w.teacherMath, w.counselorA, w.g1, w.gB]) expect(await routesSeenBy(who, w.principalA.personId), who.personId).toEqual([]);
      expect(await routesSeenBy(w.admin, w.teacherMath.personId)).toEqual([]);
      // An answered message is no longer open: no row.
      await as(tx, w.principalA, (t) => changeStatus(t, w.principalA, { workItemId: m.workItemId, toStatusCode: "answered", note: "پاسخ" }));
      expect(await routesSeenBy(w.admin, w.principalA.personId)).toEqual([]);
      // The managers still select no row of the table itself (0022's RESTRICTIVE policy, unchanged).
      for (const who of [w.admin, w.viceA, w.principalB]) expect(await rowsSeenBy(tx, who), who.personId).toEqual([]);
    });
  });
});
