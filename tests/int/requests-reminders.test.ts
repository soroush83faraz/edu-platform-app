// «یادآوری مهلت» + «مرکز درخواست‌ها» (owner 2026-10-20; migration 0028; src/modules/workspace/{deadline-reminders,
// requests}.ts). The job functions run as the system actor would — `app.current_person_id` unset, plain tenant RLS —
// inside one rolled-back transaction per test, each call in its own savepoint (the config snapshot is per transaction):
//   • a deadline reminder is enqueued once per item and deadline, reaches the unfinished, active assignees once,
//     waits out the quiet hours, never touches a confidential item; the giver hears the count once; nothing while off;
//   • a request's clock opens with the request (a guardian's message, a counselor's referral); at 80 % its addressees are
//     reminded once; at the deadline the next level is ADDED (teacher → vice principal → principal → organization
//     admin), notified and audited with ids only; nothing during the quiet hours; an answered request stops its clock;
//   • the managers' list masks a confidential title for non-participants, follows the admin scope, and shows nothing
//     while the center is off; «درخواست‌های من»; organization isolation; 0028's no-DELETE policy.
// The catalog is seeded in beforeAll; afterAll re-creates the fixture database (later files assert exact fixture counts).
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { assignTeacher } from "@/modules/academic/service";
import { setFlag, setSetting } from "@/modules/config/service";
import { referToManagement } from "@/modules/counseling/service";
import { type Assignment } from "@/modules/iam/can";
import { addGuardian } from "@/modules/iam/guardian";
import { sendGuardianMessage } from "@/modules/iam/guardian-messages";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { listValidAssignments } from "@/modules/iam/repo";
import { assignRole, createStaff, createStudent } from "@/modules/iam/service";
import { createSchool } from "@/modules/tenancy/service";
import { notifyOverdue, remindDeadline, scanDeadlines } from "@/modules/workspace/deadline-reminders";
import { listInbox } from "@/modules/workspace/repo";
import { CONFIDENTIAL_REQUEST_TITLE } from "@/modules/workspace/request-sla";
import { checkRequestSlas, requestCenterView } from "@/modules/workspace/requests";
import { changeStatus, createConfidentialWorkItem, createWorkItem } from "@/modules/workspace/service";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback } from "./helpers";

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
  requestId: "int-requests",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const phone = (n: number) => `0912761${String(n).padStart(4, "0")}`;
/** The system actor of a job run (src/modules/ops/system-ctx.ts) — what the audit rows carry. */
const SYSTEM = { orgId: f.ORG_A, personId: null, userId: null, requestId: "job:int-requests", ip: null, userAgent: "system:worker" };

const H = 3_600_000;
const TEHRAN = 3.5 * H;
const DAY = 24 * H;
/** The first instant after `after` whose Tehran wall clock reads hh:mm. */
function nextTehran(after: Date, hh: number, mm = 0): Date {
  const local = after.getTime() + TEHRAN;
  let t = local - (local % DAY) + (hh * 60 + mm) * 60_000;
  if (t <= local) t += DAY;
  return new Date(t - TEHRAN);
}

const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));

async function as<T>(tx: Tx, who: { personId: string }, fn: (t: Tx) => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.current_person_id', ${who.personId}, true)`);
  return fn(tx);
}
/** What a job run is: no person bound (fail-closed policies see nobody), a fresh savepoint (a fresh config snapshot). */
async function asSystem<T>(tx: Tx, fn: (t: Tx) => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.current_person_id', '', true)`);
  return sub(tx, fn);
}

async function actor(tx: Tx, personId: string): Promise<Actor> {
  return { orgId: f.ORG_A, personId, userId: null, requestId: "int-requests", assignments: await listValidAssignments(tx, personId) };
}

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    withTenant(tenant, async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

interface World {
  admin: Actor;
  principalA: Actor;
  viceA: Actor;
  counselorA: Actor;
  principalB: Actor;
  teacher: Actor;
  s1: { personId: string; studentProfileId: string };
  s2: { personId: string; studentProfileId: string };
  s3: { personId: string; studentProfileId: string };
  g1: Actor;
}

/** School A: a principal, a vice principal, a counselor, the ریاضی teacher of class A1, three students of A1, s1's guardian. School B: a principal. */
async function buildWorld(tx: Tx): Promise<World> {
  const adminP = await createStaff(tx, bootstrap, { firstName: "محمد", lastName: "امینی", phone: phone(1), createAccount: false });
  await assignRole(tx, { ...bootstrap, personId: adminP.personId }, { personId: adminP.personId, roleCode: "org_admin" });
  const admin = await actor(tx, adminP.personId);
  const schoolB = await createSchool(tx, admin, { name: "دبیرستان دوم", code: "S2", genderPolicy: "girls" });
  type Office = "school_principal" | "vice_principal" | "counselor";
  const staff = (firstName: string, lastName: string, n: number, roles: Array<{ roleCode: Office; schoolId: string }> = [], schoolId?: string) =>
    createStaff(tx, admin, { firstName, lastName, phone: phone(n), createAccount: false, roles, schoolId });
  const pA = await staff("مریم", "رضایی", 2, [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }]);
  const vA = await staff("سارا", "کاظمی", 3, [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }]);
  const cA = await staff("نگار", "صادقی", 4, [{ roleCode: "counselor", schoolId: f.SCHOOL_A }]);
  const pB = await staff("زهرا", "موسوی", 5, [{ roleCode: "school_principal", schoolId: schoolB.schoolId }]);
  const tMath = await staff("علی", "حسینی", 6, [], f.SCHOOL_A);
  await assignTeacher(tx, admin, { staffProfileId: tMath.staffProfileId, classOfferingId: f.OFFERING_A1 });
  const student = async (firstName: string, number: string, guardianPhone: string) => {
    const r = await createStudent(tx, admin, { firstName, lastName: "نیک‌خواه", studentNumber: number, guardianPhone, enrollment: { classGroupId: f.CLASS_GROUP_A1 } });
    return { personId: r.personId, studentProfileId: r.studentProfileId };
  };
  const s1 = await student("لیلا", "R-1", phone(21));
  const s2 = await student("سارا", "R-2", phone(22));
  const s3 = await student("رها", "R-3", phone(23));
  const link = await addGuardian(tx, admin, { studentProfileId: s1.studentProfileId, firstName: "زهره", lastName: "نیک‌خواه", phone: phone(21), relation: "mother" });
  return {
    admin,
    principalA: await actor(tx, pA.personId),
    viceA: await actor(tx, vA.personId),
    counselorA: await actor(tx, cA.personId),
    principalB: await actor(tx, pB.personId),
    teacher: await actor(tx, tMath.personId),
    s1,
    s2,
    s3,
    g1: await actor(tx, link.guardianPersonId),
  };
}

const flag = (tx: Tx, w: World, key: "deadline_reminders" | "request_center", value: "on" | "off") => sub(tx, (sp) => as(sp, w.admin, (t) => setFlag(t, { ...w.admin, userId: "00000000-0000-7000-8000-000000000000", ip: "127.0.0.1", userAgent: "int-test" }, { key, schoolId: null, value })));
const quiet = (tx: Tx, w: World, start: string, end: string) =>
  sub(tx, (sp) => as(sp, w.admin, (t) => setSetting(t, { ...w.admin, userId: "00000000-0000-7000-8000-000000000000", ip: "127.0.0.1", userAgent: "int-test" }, { key: "notif.quiet_hours", schoolId: null, mode: "set", start, end })));

async function notificationsOf(tx: Tx, typeCode: string, sourceId: string): Promise<Array<{ recipient: string; title: string; deepLink: string | null }>> {
  const res = await tx.execute<{ recipient_person_id: string; title: string; deep_link: string | null }>(
    sql`select recipient_person_id, title, deep_link from notif.notification where type_code = ${typeCode} and source_id = ${sourceId}::uuid order by recipient_person_id`,
  );
  return res.rows.map((r) => ({ recipient: r.recipient_person_id, title: r.title, deepLink: r.deep_link }));
}

async function jobsOf(tx: Tx, kind: string): Promise<Array<{ payload: { workItemId: string; dueAt: string }; runAt: Date; dedupeKey: string }>> {
  const res = await tx.execute<{ payload: { workItemId: string; dueAt: string }; run_at: string; dedupe_key: string }>(
    sql`select payload, run_at, dedupe_key from ops.job where kind = ${kind} order by run_at`,
  );
  return res.rows.map((r) => ({ payload: r.payload, runAt: new Date(r.run_at), dedupeKey: r.dedupe_key }));
}

async function slaRow(tx: Tx, workItemId: string) {
  const res = await tx.execute<{ id: string; kind: string; school_id: string; opened_at: string; period_started_at: string; due_at: string; warned_at: string | null; escalation_level: number; closed_at: string | null }>(
    sql`select id, kind, school_id, opened_at, period_started_at, due_at, warned_at, escalation_level, closed_at from workspace.request_sla where work_item_id = ${workItemId}::uuid`,
  );
  const r = res.rows[0];
  return r
    ? { ...r, periodStartedAt: new Date(r.period_started_at), dueAt: new Date(r.due_at), openedAt: new Date(r.opened_at), escalationLevel: Number(r.escalation_level) }
    : undefined;
}

const assigneesOf = async (tx: Tx, workItemId: string) =>
  (await tx.execute<{ person_id: string }>(sql`select person_id from workspace.work_item_assignee where work_item_id = ${workItemId}::uuid and role = 'assignee' order by person_id`)).rows.map(
    (r) => r.person_id,
  );

describe("«یادآوری مهلت» and «مرکز درخواست‌ها»", () => {
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

  describe("deadline reminders", () => {
    it("once per item and deadline, to the unfinished active assignees, out of the quiet hours; the giver hears the count once", async () => {
      await rolledBack(async (tx) => {
        const w = await buildWorld(tx);
        const due = nextTehran(new Date(Date.now() + 3 * DAY), 12);
        const task = await as(tx, w.teacher, (t) =>
          createWorkItem(t, w.teacher, { typeCode: "task", title: "تمرین صفحهٴ ۴۲", priority: "normal", dueAt: due, recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } }),
        );
        // s2 has finished; s3 was removed (an archived person keeps the assignee row).
        const s2 = await actor(tx, w.s2.personId);
        await as(tx, s2, (t) => changeStatus(t, s2, { workItemId: task.id, toStatusCode: "done" }));
        await tx.execute(sql`update iam.person set status = 'archived' where id = ${w.s3.personId}::uuid`);
        const scanAt = new Date(due.getTime() - 24 * H - 10 * 60_000);

        // Off (the default): the scan reads nothing.
        expect(await asSystem(tx, (t) => scanDeadlines(t, SYSTEM, scanAt))).toEqual({ items: 0, reminders: 0, overdue: 0 });
        await flag(tx, w, "deadline_reminders", "on");

        const first = await asSystem(tx, (t) => scanDeadlines(t, SYSTEM, scanAt));
        expect(first.reminders).toBe(1);
        const jobs = (await jobsOf(tx, "workspace.remind_deadline")).filter((j) => j.payload.workItemId === task.id);
        expect(jobs).toEqual([{ payload: { workItemId: task.id, dueAt: due.toISOString() }, runAt: new Date(due.getTime() - 24 * H), dedupeKey: `deadline:${task.id}:${due.toISOString()}` }]);
        // A second scan enqueues nothing new (the dedupe key).
        expect((await asSystem(tx, (t) => scanDeadlines(t, SYSTEM, scanAt))).reminders).toBe(0);

        // Inside the quiet hours (23:00 the night before): nothing sent, the job re-queued to 07:00.
        const night = nextTehran(new Date(due.getTime() - 24 * H), 23);
        expect(await asSystem(tx, (t) => remindDeadline(t, SYSTEM, { workItemId: task.id, dueAt: due.toISOString() }, night))).toBe(0);
        expect(await notificationsOf(tx, "work_item.due_soon", task.id)).toEqual([]);
        const requeued = (await jobsOf(tx, "workspace.remind_deadline")).filter((j) => j.payload.workItemId === task.id && j.dedupeKey !== jobs[0].dedupeKey);
        expect(requeued.map((j) => j.runAt)).toEqual([nextTehran(night, 7)]);

        // At its time: the unfinished, active assignees only — once.
        const sendAt = new Date(due.getTime() - 24 * H);
        const sent = await asSystem(tx, (t) => remindDeadline(t, SYSTEM, { workItemId: task.id, dueAt: due.toISOString() }, sendAt));
        const got = await notificationsOf(tx, "work_item.due_soon", task.id);
        expect(got.map((n) => n.recipient)).toContain(w.s1.personId);
        expect(got.map((n) => n.recipient)).not.toContain(w.s2.personId);
        expect(got.map((n) => n.recipient)).not.toContain(w.s3.personId);
        expect(got.map((n) => n.recipient)).not.toContain(w.teacher.personId);
        expect(sent).toBe(got.length);
        expect(got[0]).toMatchObject({ title: "یادآوری: مهلت «تمرین صفحهٴ ۴۲» تا فردا ساعت ۱۲", deepLink: `/inbox/${task.id}` });
        expect(await asSystem(tx, (t) => remindDeadline(t, SYSTEM, { workItemId: task.id, dueAt: due.toISOString() }, sendAt))).toBe(0);

        // A moved deadline: the old job finds another deadline and does nothing.
        expect(await asSystem(tx, (t) => remindDeadline(t, SYSTEM, { workItemId: task.id, dueAt: new Date(due.getTime() + H).toISOString() }, sendAt))).toBe(0);

        // Past the deadline the giver hears the count (s1 and the fixture's class members; never s2, never removed s3) — once.
        const after = new Date(due.getTime() + 60_000);
        expect((await asSystem(tx, (t) => scanDeadlines(t, SYSTEM, after))).overdue).toBe(1);
        const unfinished = got.length;
        expect(await asSystem(tx, (t) => notifyOverdue(t, SYSTEM, { workItemId: task.id, dueAt: due.toISOString() }, after))).toBe(unfinished);
        const told = await notificationsOf(tx, "work_item.overdue", task.id);
        expect(told).toHaveLength(1);
        expect(told[0].recipient).toBe(w.teacher.personId);
        expect(told[0].title).toBe(`${unfinished.toLocaleString("fa-IR")} نفر هنوز «تمرین صفحهٴ ۴۲» را تمام نکرده‌اند`);
        expect(await asSystem(tx, (t) => notifyOverdue(t, SYSTEM, { workItemId: task.id, dueAt: due.toISOString() }, after))).toBe(0);
      });
    });

    it("never a confidential item, never a personal note's giver notice", async () => {
      await rolledBack(async (tx) => {
        const w = await buildWorld(tx);
        await flag(tx, w, "deadline_reminders", "on");
        const due = nextTehran(new Date(Date.now() + 3 * DAY), 12);
        const secret = await as(tx, w.counselorA, (t) =>
          createConfidentialWorkItem(t, w.counselorA, { typeCode: "task", title: "گزارش محرمانه", description: null, priority: "normal", dueAt: due, recipientIds: [w.teacher.personId], notificationTitle: "x", auditContext: {} }),
        );
        const note = await as(tx, w.teacher, (t) => createWorkItem(t, w.teacher, { typeCode: "todo", title: "یادداشت", priority: "normal", dueAt: due, recipients: { kind: "self" } }));
        await asSystem(tx, (t) => scanDeadlines(t, SYSTEM, new Date(due.getTime() - 24 * H)));
        const reminded = (await jobsOf(tx, "workspace.remind_deadline")).map((j) => j.payload.workItemId);
        expect(reminded).not.toContain(secret.id);
        expect(reminded).toContain(note.id);
        expect(await asSystem(tx, (t) => remindDeadline(t, SYSTEM, { workItemId: secret.id, dueAt: due.toISOString() }, new Date(due.getTime() - 24 * H)))).toBe(0);
        // The personal note reminds its author; its deadline passing tells no «giver».
        await asSystem(tx, (t) => scanDeadlines(t, SYSTEM, new Date(due.getTime() + 60_000)));
        expect((await jobsOf(tx, "workspace.notify_overdue")).map((j) => j.payload.workItemId)).not.toContain(note.id);
        expect(await asSystem(tx, (t) => notifyOverdue(t, SYSTEM, { workItemId: note.id, dueAt: due.toISOString() }, new Date(due.getTime() + 60_000)))).toBe(0);
      });
    });
  });

  describe("request center", () => {
    it("a guardian's message: reminded at 80 %, escalated teacher → vice principal → principal → organization admin, then renewed", async () => {
      await rolledBack(async (tx) => {
        const w = await buildWorld(tx);
        await quiet(tx, w, "00:00", "00:00"); // no quiet window: the times below need not dodge the night
        const sent = await as(tx, w.g1, (t) =>
          sendGuardianMessage(t, w.g1, {
            studentProfileId: w.s1.studentProfileId,
            kind: "question",
            destination: "teacher",
            classOfferingId: f.OFFERING_A1,
            teacherPersonId: w.teacher.personId,
            subject: "تمرین‌های فصل دوم",
            body: "سلام؛ تمرین‌های فصل دوم کی تحویل داده می‌شود؟",
          }),
        );
        const id = sent.workItemId;
        const row0 = (await slaRow(tx, id))!;
        expect(row0).toMatchObject({ kind: "parent_message", school_id: f.SCHOOL_A, escalationLevel: 0, warned_at: null, closed_at: null });
        expect(row0.dueAt.getTime() - row0.periodStartedAt.getTime()).toBe(48 * H);
        const at = (hours: number) => new Date(row0.periodStartedAt.getTime() + hours * H);

        // Off: nothing happens.
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(40)))).warned).toBe(0);
        await flag(tx, w, "request_center", "on");

        // Before 80 %: nothing. At 80 %: the teacher is reminded — once.
        expect(await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(30)))).toEqual({ warned: 0, escalated: 0, renewed: 0, closed: 0, skipped: 0 });
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(40)))).warned).toBe(1);
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(41)))).warned).toBe(0);
        const warned = await notificationsOf(tx, "work_item.response_due", id);
        expect(warned.map((n) => n.recipient)).toEqual([w.teacher.personId]);
        expect(warned[0].title).toMatch(/^یادآوری: پاسخ به «.+» تا /);

        // The deadline: the vice principal is ADDED (the teacher stays), notified, audited.
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(49)))).escalated).toBe(1);
        expect(await assigneesOf(tx, id)).toEqual([w.teacher.personId, w.viceA.personId].sort());
        expect((await notificationsOf(tx, "work_item.escalated", id)).map((n) => n.recipient)).toEqual([w.viceA.personId]);
        const row1 = (await slaRow(tx, id))!;
        expect(row1).toMatchObject({ escalationLevel: 1, warned_at: null });
        expect(row1.periodStartedAt).toEqual(at(49));
        expect(row1.dueAt).toEqual(at(49 + 48));
        const auditRows = await tx.execute<{ actor_person_id: string | null; request_id: string; after: Record<string, unknown> }>(
          sql`select actor_person_id, request_id, after from audit.audit_log where action = 'workspace.request.escalated' and entity_id = ${row1.id}::uuid`,
        );
        expect(auditRows.rows).toHaveLength(1);
        expect(auditRows.rows[0]).toMatchObject({ actor_person_id: null, request_id: "job:int-requests" });
        expect(auditRows.rows[0].after).toMatchObject({ kind: "parent_message", workItemId: id, fromLevel: "staff", toLevel: "vice_principal", addedPersonIds: [w.viceA.personId] });
        // Ids and levels only: neither the title nor the text.
        expect(JSON.stringify(auditRows.rows[0].after)).not.toContain("تمرین");

        // The vice principal can now open it; the next deadline adds the principal, then the organization admin.
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(49 + 49)))).escalated).toBe(1);
        expect(await assigneesOf(tx, id)).toContain(w.principalA.personId);
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(49 + 49 + 49)))).escalated).toBe(1);
        expect(await assigneesOf(tx, id)).toContain(w.admin.personId);
        // Past the organization admin: a new period for the same addressees.
        const before = await assigneesOf(tx, id);
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(49 * 4)))).renewed).toBe(1);
        expect(await assigneesOf(tx, id)).toEqual(before);
        expect((await slaRow(tx, id))!.escalationLevel).toBe(3);

        // Answered: the clock stops at the next check.
        await as(tx, w.teacher, (t) => changeStatus(t, w.teacher, { workItemId: id, toStatusCode: "answered", note: "هفتهٴ آینده." }));
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, at(49 * 6)))).closed).toBe(1);
        expect((await slaRow(tx, id))!.closed_at).not.toBeNull();
      });
    });

    it("a counselor's referral goes from the school's management to the organization admin; nothing in the quiet hours", async () => {
      await rolledBack(async (tx) => {
        const w = await buildWorld(tx);
        await flag(tx, w, "request_center", "on");
        const ref = await as(tx, w.counselorA, (t) => referToManagement(t, w.counselorA, { studentProfileId: w.s1.studentProfileId, subject: "افت تحصیلی", description: "جزئیات محرمانه" }));
        const row0 = (await slaRow(tx, ref.workItemId))!;
        expect(row0).toMatchObject({ kind: "admin_request", school_id: f.SCHOOL_A });
        expect(row0.dueAt.getTime() - row0.periodStartedAt.getTime()).toBe(72 * H);
        // Default quiet hours (22:00–07:00): a check at 23:00 after the deadline does nothing.
        const night = nextTehran(row0.dueAt, 23);
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, night))).skipped).toBe(1);
        expect((await slaRow(tx, ref.workItemId))!.escalationLevel).toBe(0);
        // At 07:00 it escalates: principal + vice principal were the addressees → the organization admin is added.
        const morning = nextTehran(night, 7);
        expect((await asSystem(tx, (t) => checkRequestSlas(t, SYSTEM, morning))).escalated).toBe(1);
        expect(await assigneesOf(tx, ref.workItemId)).toEqual([w.principalA.personId, w.viceA.personId, w.admin.personId].sort());
        const bell = await notificationsOf(tx, "work_item.escalated", ref.workItemId);
        expect(bell.map((n) => n.recipient)).toEqual([w.admin.personId]);
        // The title only — never the referral's text.
        expect(JSON.stringify(bell)).not.toContain("جزئیات محرمانه");
      });
    });

    it("the managers' list: confidential titles for participants only, the admin scope, off while the flag is off; «درخواست‌های من»; isolation; no DELETE", async () => {
      await rolledBack(async (tx) => {
        const w = await buildWorld(tx);
        const sent = await as(tx, w.g1, (t) =>
          sendGuardianMessage(t, w.g1, { studentProfileId: w.s1.studentProfileId, kind: "question", destination: "vice_principal", subject: "جلسه", body: "جلسهٴ اولیا کی است؟" }),
        );
        const view = (who: Actor, input = {}) => sub(tx, (sp) => as(sp, who, (t) => requestCenterView(t, who, input)));
        expect(await view(w.principalA)).toMatchObject({ enabled: false, rows: [] });
        await flag(tx, w, "request_center", "on");

        // The principal is no participant: kind, school, status, addressees — the title masked, no link.
        const p = await view(w.principalA);
        expect(p.rows).toHaveLength(1);
        const row = p.rows[0];
        expect(row).toMatchObject({ kind: "parent_message", kindLabel: "پیام ولی", title: CONFIDENTIAL_REQUEST_TITLE, titleHidden: true, href: null, status: "on_time", escalations: 0, addressees: ["سارا کاظمی"] });
        // The organization admin neither (until escalated to them).
        expect((await view(w.admin)).rows.find((r) => r.id === row.id)).toMatchObject({ titleHidden: true });
        // The addressee sees the title and the link.
        expect((await view(w.viceA)).rows.find((r) => r.id === row.id)).toMatchObject({ titleHidden: false, href: `/inbox/${sent.workItemId}` });
        // Another school's principal: nothing of school A; a school outside the scope reads as empty.
        expect((await view(w.principalB)).rows).toEqual([]);
        expect((await view(w.principalB, { schoolId: f.SCHOOL_A })).rows).toEqual([]);
        // Filters.
        expect((await view(w.principalA, { kind: "admin_request" })).rows).toEqual([]);
        expect((await view(w.principalA, { status: "overdue" })).rows).toEqual([]);
        // A teacher holds no admin access.
        await expect(sub(tx, (sp) => as(sp, w.teacher, (t) => requestCenterView(t, w.teacher, {})))).rejects.toMatchObject({ code: "FORBIDDEN" });

        // «درخواست‌های من»: the vice principal's request, not their other work.
        await as(tx, w.admin, (t) => createWorkItem(t, w.admin, { typeCode: "task", title: "برنامهٴ امتحانات", priority: "normal", recipients: { kind: "persons", ids: [w.viceA.personId] } }));
        const mine = await listInbox(tx, w.viceA.personId, { tab: "todo", requestsOnly: true });
        expect(mine.rows.map((r) => r.id)).toEqual([sent.workItemId]);
        expect((await listInbox(tx, w.viceA.personId, { tab: "todo" })).rows.length).toBe(2);

        // app_rw (this transaction's role) never deletes a clock — 0028's RESTRICTIVE policy: the DELETE matches no row.
        const del = await sub(tx, (t) => t.execute(sql`delete from workspace.request_sla where work_item_id = ${sent.workItemId}::uuid`));
        expect(del.rowCount).toBe(0);
        expect(await slaRow(tx, sent.workItemId)).toBeDefined();

        // Another organization reads none of it, and its check finds nothing (RLS: the tenant bound to the transaction).
        await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_B}, true)`);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from workspace.request_sla`)).rows[0].n).toBe(0);
        expect(await asSystem(tx, (t) => checkRequestSlas(t, { ...SYSTEM, orgId: f.ORG_B }, new Date(Date.now() + 30 * DAY)))).toMatchObject({ escalated: 0, warned: 0 });
        await tx.execute(sql`select set_config('app.current_org_id', ${f.ORG_A}, true)`);
      });
    });
  });
});
