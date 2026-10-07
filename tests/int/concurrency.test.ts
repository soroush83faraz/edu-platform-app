// Races that one transaction cannot show (every other int test runs inside ONE rolled-back transaction): two real
// transactions on two pool connections, the first one held open BEFORE its commit while the second one runs into it
// (src/modules/iam/removal.ts «Concurrency» — the lock modes and the lock order these prove):
//   C1 placing a student into another class while they are removed: refused, the class stays ended — and a placement
//      that goes first is waited for by the removal, which then ends the new class too;
//   C2 enrolling a class-less student while they are removed: refused, no class, the school stays withdrawn;
//   C3 a teaching / C4 a manager role / C5 a temporary password for a colleague being removed: refused, nothing live,
//      the account stays disabled;
//   C6 a class work item created while a student is removed: the student is not an assignee and is not notified;
//   C7 a work item for named persons, one of them being removed: refused like any inactive recipient, nothing written;
//   C8 an edit racing «اتمام»: waits and is refused, never written to the closed item — or goes first and is kept;
//   C9 two last «انجام شد» at once close the item;
//   C10 a removal racing another assignee's last «انجام شد» closes the item, whichever of the two runs first;
//   C11 a «بازیابی» racing the removal of a student who is history on the item: they never come back with it,
//      whichever runs first (the reopening locks its assignees' person rows before the item);
//   C12 a removal that holds its person row (and has not reached the items yet) against «اتمام» / «ویرایش» of an
//      item they are assigned: no deadlock — the item write waits BEFORE taking the item (its notification would
//      otherwise lock the person after the item, through the foreign-key check), and the removed one is not notified.
// Each race asserts that the second transaction really WAITED for the first (pg_blocking_pids), so a pass means the
// lock was there, not that the timing happened to be kind. The rows must be COMMITTED for the second connection to
// see them, so the catalog is seeded in beforeAll and the database is re-created in afterAll (as
// admin-remove-person.test.ts does) — the files after this one see the fixtures only.
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
  notification,
  roleAssignment,
  schoolEnrollment,
  teacherAssignment,
  userAccount,
  workItem,
  workItemAssignee,
  workItemStatus,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { assignTeacher } from "@/modules/academic/service";
import { adminPlaceStudent, adminResetInitialPassword, type AdminCtx } from "@/modules/iam/admin";
import type { Assignment } from "@/modules/iam/can";
import { PERSON_REMOVED_MESSAGE } from "@/modules/iam/messages";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { removePerson } from "@/modules/iam/removal";
import { assignRole, createStaff, createStudent, MESSAGES } from "@/modules/iam/service";
import { listOfferingRoster } from "@/modules/workspace/repo";
import { changeStatus, createWorkItem, updateWorkItem } from "@/modules/workspace/service";
import { SYSTEM_ROLES } from "../../scripts/catalog";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { asAppRw } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const catalogPerms = (code: string): string[] => {
  const r = SYSTEM_ROLES.find((x) => x.code === code);
  if (!r) throw new Error(`catalog has no ${code}`);
  return [...r.permissions];
};
const orgAdmin: AdminCtx = {
  orgId: f.ORG_A,
  personId: f.PERSON_A2,
  userId: null,
  requestId: "int-concurrency",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
const studentCtx = (personId: string, profileId: string): AdminCtx => ({
  ...orgAdmin,
  personId,
  assignments: [{ roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: catalogPerms("student") } satisfies Assignment],
});
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };

const isError = (code: string, message?: string | RegExp) => (e: unknown) =>
  AppError.is(e) && e.code === code && (message === undefined || (typeof message === "string" ? e.message === message : message.test(e.message)));
const removedError = isError("CONFLICT", PERSON_REMOVED_MESSAGE);

/** Committed on purpose: the other connection must see it (the database is re-created in afterAll). */
const committed = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(tenant, fn);

async function backendPid(tx: Tx): Promise<number> {
  const res = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  return Number(res.rows[0].pid);
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

interface Raced<A, B> {
  first: A;
  second: Settled<B>;
  /** The database showed `second` blocked by `first`'s open transaction before `first` committed. */
  waited: boolean;
}

/**
 * `first` runs in one transaction and then HOLDS it open (not committed); `second` starts in another transaction on
 * another connection and runs until the database reports it blocked by `first` (pg_blocking_pids, polled from a third
 * connection) or until it settles — which means it never waited. Then `thenFirst` (if any) runs in the FIRST
 * transaction — the rest of a write whose opening locks were all `first` took — and `first` commits; `second` finishes.
 */
async function race<A, B>(first: (tx: Tx) => Promise<A>, second: (tx: Tx) => Promise<B>, thenFirst?: (tx: Tx) => Promise<unknown>): Promise<Raced<A, B>> {
  let commitFirst!: () => void;
  const hold = new Promise<void>((resolve) => (commitFirst = resolve));
  let firstHeld!: (pid: number) => void;
  const held = new Promise<number>((resolve) => (firstHeld = resolve));
  const t1 = settle(
    withTenant(tenant, async (tx) => {
      const pid = await backendPid(tx);
      const out = await first(tx);
      firstHeld(pid);
      await hold;
      if (thenFirst) await thenFirst(tx);
      return out;
    }),
  );
  const start = await Promise.race([held.then((pid) => ({ pid })), t1.then((r) => ({ early: r }))]);
  if ("early" in start) throw start.early.ok ? new Error("first committed before it was held") : start.early.error;

  const pids = { second: 0 };
  let secondSettled = false;
  const t2 = settle(
    withTenant(tenant, async (tx) => {
      pids.second = await backendPid(tx);
      return second(tx);
    }),
  ).then((r) => {
    secondSettled = true;
    return r;
  });
  let waited = false;
  try {
    waited = await asAppRw(async (c) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (secondSettled) return false;
        if (pids.second !== 0) {
          const res = await c.query<{ blocked: boolean }>("select $1::int = any(pg_blocking_pids($2::int)) as blocked", [start.pid, pids.second]);
          if (res.rows[0].blocked) return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("the second transaction neither waited for the first nor finished");
    });
  } finally {
    commitFirst();
  }
  const r1 = await t1;
  if (!r1.ok) throw r1.error;
  return { first: r1.value, second: await t2, waited };
}

function expectRejected<B>(s: Settled<B>, check: (e: unknown) => boolean): void {
  if (s.ok) throw new Error(`expected the second transaction to be refused, it returned ${JSON.stringify(s.value)}`);
  if (!check(s.error)) throw s.error;
}

function expectFulfilled<B>(s: Settled<B>): B {
  if (!s.ok) throw s.error;
  return s.value;
}

const enrollmentsOf = (studentProfileId: string) =>
  committed((tx) =>
    tx
      .select({ classGroupId: classEnrollment.classGroupId, status: classEnrollment.status })
      .from(classEnrollment)
      .where(eq(classEnrollment.studentProfileId, studentProfileId))
      .orderBy(classEnrollment.createdAt),
  );

const liveRolesOf = (personId: string) =>
  committed((tx) => tx.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, personId), isNull(roleAssignment.revokedAt))));

const itemState = (workItemId: string) =>
  committed(async (tx) => {
    const [row] = await tx
      .select({ title: workItem.title, category: workItemStatus.category })
      .from(workItem)
      .innerJoin(workItemStatus, eq(workItemStatus.id, workItem.statusId))
      .where(eq(workItem.id, workItemId));
    const assignees = await tx
      .select({ personId: workItemAssignee.personId, state: workItemAssignee.state })
      .from(workItemAssignee)
      .where(and(eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.role, "assignee")));
    return { ...row, assignees: assignees.sort((a, b) => a.personId.localeCompare(b.personId)) };
  });

let seq = 0;
/** A fresh student of class A1 (no login), committed. */
const newStudent = (firstName: string, opts: { classless?: boolean } = {}) =>
  committed((tx) =>
    createStudent(tx, orgAdmin, {
      firstName,
      lastName: "صالحی",
      studentNumber: `C-${String(++seq).padStart(3, "0")}`,
      ...(opts.classless ? { schoolId: f.SCHOOL_A } : { enrollment: { classGroupId: f.CLASS_GROUP_A1 } }),
    }),
  );
/** A fresh colleague of school A (with the login every colleague gets), committed. */
const newStaff = (firstName: string) =>
  committed((tx) => createStaff(tx, orgAdmin, { firstName, lastName: "صالحی", phone: `0912740${String(++seq).padStart(4, "0")}`, schoolId: f.SCHOOL_A }));
/** A تسک of the organization admin for exactly these persons, committed. */
const giveTo = (title: string, personIds: string[]) =>
  committed(async (tx) => (await createWorkItem(tx, orgAdmin, { typeCode: "task", title, priority: "normal", recipients: { kind: "persons", ids: personIds } })).id);

describe("concurrency: a removal against the doors that would bring the person back, and work items against each other", () => {
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

  it("C1: a placement racing the removal is refused and the class stays ended; a placement that goes first is ended by the removal too", async () => {
    const s = await newStudent("سینا");
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" }),
      (tx) => adminPlaceStudent(tx, orgAdmin, { personId: s.personId, classGroupId: f.CLASS_GROUP_A2 }),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, removedError);
    expect(await enrollmentsOf(s.studentProfileId)).toEqual([{ classGroupId: f.CLASS_GROUP_A1, status: "ended" }]);

    // The other way round: the removal waits for the placement, then sees the new class and ends it.
    const t = await newStudent("ترانه");
    const back = await race(
      (tx) => adminPlaceStudent(tx, orgAdmin, { personId: t.personId, classGroupId: f.CLASS_GROUP_A2 }),
      (tx) => removePerson(tx, orgAdmin, { personId: t.personId, kind: "student" }),
    );
    expect(back.waited).toBe(true);
    expect(back.first.moved).toBe(true);
    expect(expectFulfilled(back.second)).toMatchObject({ alreadyRemoved: false, endedClassEnrollments: 1 });
    expect(await enrollmentsOf(t.studentProfileId)).toEqual([
      { classGroupId: f.CLASS_GROUP_A1, status: "transferred" },
      { classGroupId: f.CLASS_GROUP_A2, status: "ended" },
    ]);
  });

  it("C2: enrolling a class-less student while they are removed is refused — no class, the school stays withdrawn", async () => {
    const s = await newStudent("کیان", { classless: true });
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: s.personId, kind: "student" }),
      (tx) => adminPlaceStudent(tx, orgAdmin, { personId: s.personId, classGroupId: f.CLASS_GROUP_A1 }),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, removedError);
    expect(await enrollmentsOf(s.studentProfileId)).toEqual([]);
    const schools = await committed((tx) => tx.select({ status: schoolEnrollment.status }).from(schoolEnrollment).where(eq(schoolEnrollment.studentProfileId, s.studentProfileId)));
    expect(schools).toEqual([{ status: "withdrawn" }]);
  });

  it("C3: a teaching given while the colleague is removed is refused — no live teaching, no live role", async () => {
    const c = await newStaff("بهرام");
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: c.personId, kind: "staff" }),
      (tx) => assignTeacher(tx, orgAdmin, { staffProfileId: c.staffProfileId, classOfferingId: f.OFFERING_A1 }),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, removedError);
    const teaching = await committed((tx) =>
      tx.select({ id: teacherAssignment.id }).from(teacherAssignment).where(and(eq(teacherAssignment.staffProfileId, c.staffProfileId), isNull(teacherAssignment.validTo))),
    );
    expect(teaching).toEqual([]);
    expect(await liveRolesOf(c.personId)).toEqual([]);
  });

  it("C4: a manager role given while the colleague is removed is refused — no live role", async () => {
    const c = await newStaff("مهتاب");
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: c.personId, kind: "staff" }),
      (tx) => assignRole(tx, orgAdmin, { personId: c.personId, roleCode: "vice_principal", schoolId: f.SCHOOL_A }),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, isError("VALIDATION", MESSAGES.managerRoleNeedsStaff));
    expect(await liveRolesOf(c.personId)).toEqual([]);
  });

  it("C5: a temporary password set while the person is removed is refused — the account stays disabled, no printable password", async () => {
    const c = await newStaff("نیما");
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: c.personId, kind: "staff" }),
      (tx) => adminResetInitialPassword(tx, orgAdmin, c.personId),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, removedError);
    const [account] = await committed((tx) => tx.select({ status: userAccount.status }).from(userAccount).where(eq(userAccount.id, c.userAccountId!)));
    expect(account.status).toBe("disabled");
    const [identity] = await committed((tx) => tx.select({ enc: authIdentity.initialPasswordEnc }).from(authIdentity).where(eq(authIdentity.userAccountId, c.userAccountId!)));
    expect(identity.enc).toBeNull();
  });

  it("C6: a class work item created while a student is removed: the student is no assignee, has no inbox row and no notification; the classmate has", async () => {
    const leaving = await newStudent("آرمان");
    const staying = await newStudent("آوا");
    const rosterBefore = (await committed((tx) => listOfferingRoster(tx, f.OFFERING_A1))).map((p) => p.personId);
    expect(rosterBefore).toEqual(expect.arrayContaining([leaving.personId, staying.personId]));
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: leaving.personId, kind: "student" }),
      (tx) => createWorkItem(tx, orgAdmin, { typeCode: "task", title: "تمرین کلاسی", priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } }),
    );
    expect(r.waited).toBe(true);
    const created = expectFulfilled(r.second);
    const expected = rosterBefore.filter((id) => id !== leaving.personId).sort();
    expect(created.assigneeCount).toBe(expected.length);
    expect((await itemState(created.id)).assignees.map((a) => a.personId)).toEqual(expected);
    const inbox = await committed((tx) => tx.select({ personId: inboxEntry.personId }).from(inboxEntry).where(eq(inboxEntry.workItemId, created.id)));
    expect(inbox.map((e) => e.personId)).not.toContain(leaving.personId);
    expect(inbox.map((e) => e.personId)).toContain(staying.personId);
    const notified = await committed((tx) => tx.select({ personId: notification.recipientPersonId }).from(notification).where(eq(notification.sourceId, created.id)));
    expect(notified.map((n) => n.personId)).not.toContain(leaving.personId);
    expect(notified.map((n) => n.personId)).toContain(staying.personId);
  });

  it("C7: a work item for named persons, one of them being removed, is refused like any inactive recipient — nothing written", async () => {
    const leaving = await newStudent("رها");
    const staying = await newStudent("سام");
    const title = "پیام به دو نفر";
    const r = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: leaving.personId, kind: "student" }),
      (tx) => createWorkItem(tx, orgAdmin, { typeCode: "task", title, priority: "normal", recipients: { kind: "persons", ids: [leaving.personId, staying.personId] } }),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, isError("INVALID_REFERENCE"));
    expect(await committed((tx) => tx.select({ id: workItem.id }).from(workItem).where(eq(workItem.title, title)))).toEqual([]);
    expect(await committed((tx) => tx.select({ id: notification.id }).from(notification).where(eq(notification.recipientPersonId, leaving.personId)))).toEqual([]);
  });

  it("C8: an edit racing «اتمام» waits and is refused (never written to the closed item); an edit that goes first is kept and «اتمام» waits for it", async () => {
    const k = await newStudent("یاس");
    const closed = await giveTo("تمرین اول", [k.personId]);
    const r = await race(
      (tx) => changeStatus(tx, orgAdmin, { workItemId: closed, toStatusCode: "done" }),
      (tx) => updateWorkItem(tx, orgAdmin, { workItemId: closed, title: "عنوان تازه" }),
    );
    expect(r.waited).toBe(true);
    expectRejected(r.second, isError("VALIDATION", /بسته شده است/));
    expect(await itemState(closed)).toMatchObject({ title: "تمرین اول", category: "done" });
    const edits = await committed((tx) => tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "workspace.work_item.updated"), eq(auditLog.entityId, closed))));
    expect(edits).toEqual([]);

    const edited = await giveTo("تمرین دوم", [k.personId]);
    const back = await race(
      (tx) => updateWorkItem(tx, orgAdmin, { workItemId: edited, title: "تمرین دوم (اصلاح‌شده)" }),
      (tx) => changeStatus(tx, orgAdmin, { workItemId: edited, toStatusCode: "done" }),
    );
    expect(back.waited).toBe(true);
    expect(back.first.changed).toEqual(["title"]);
    expect(expectFulfilled(back.second)).toMatchObject({ statusCode: "done", itemChanged: true });
    expect(await itemState(edited)).toMatchObject({ title: "تمرین دوم (اصلاح‌شده)", category: "done" });
    const [trail] = await committed((tx) => tx.select({ before: auditLog.before }).from(auditLog).where(and(eq(auditLog.action, "workspace.work_item.updated"), eq(auditLog.entityId, edited))));
    expect(trail.before).toEqual({ title: "تمرین دوم" });
  });

  it("C9: two last «انجام شد» at once close the item", async () => {
    const a = await newStudent("نوید");
    const b = await newStudent("نگین");
    const item = await giveTo("تمرین دونفره", [a.personId, b.personId]);
    const r = await race(
      (tx) => changeStatus(tx, studentCtx(a.personId, a.studentProfileId), { workItemId: item, toStatusCode: "done" }),
      (tx) => changeStatus(tx, studentCtx(b.personId, b.studentProfileId), { workItemId: item, toStatusCode: "done" }),
    );
    expect(r.waited).toBe(true);
    expect(r.first).toMatchObject({ itemChanged: false, assigneesDone: 1, assigneesTotal: 2 });
    expect(expectFulfilled(r.second)).toMatchObject({ itemChanged: true, statusCode: "done", assigneesDone: 2, assigneesTotal: 2 });
    expect(await itemState(item)).toMatchObject({ category: "done" });
  });

  it("C10: a removal racing the other assignee's last «انجام شد» closes the item, whichever runs first", async () => {
    // «انجام شد» first; the removal waits for the item, takes the leaver out and sees everyone left done.
    const leaving = await newStudent("پارسا");
    const staying = await newStudent("پریا");
    const item = await giveTo("تمرین گروهی", [leaving.personId, staying.personId]);
    const r = await race(
      (tx) => changeStatus(tx, studentCtx(staying.personId, staying.studentProfileId), { workItemId: item, toStatusCode: "done" }),
      (tx) => removePerson(tx, orgAdmin, { personId: leaving.personId, kind: "student" }),
    );
    expect(r.waited).toBe(true);
    expect(r.first.itemChanged).toBe(false);
    expect(expectFulfilled(r.second)).toMatchObject({ withdrawnWorkItems: 1, completedWorkItems: 1 });
    expect(await itemState(item)).toEqual({ title: "تمرین گروهی", category: "done", assignees: [{ personId: staying.personId, state: "done" }] });

    // The removal first; «انجام شد» waits for the item and finds itself the last one.
    const leaving2 = await newStudent("کامران");
    const staying2 = await newStudent("کیمیا");
    const item2 = await giveTo("تمرین گروهی دوم", [leaving2.personId, staying2.personId]);
    const back = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: leaving2.personId, kind: "student" }),
      (tx) => changeStatus(tx, studentCtx(staying2.personId, staying2.studentProfileId), { workItemId: item2, toStatusCode: "done" }),
    );
    expect(back.waited).toBe(true);
    expect(back.first).toMatchObject({ withdrawnWorkItems: 1, completedWorkItems: 0 });
    expect(expectFulfilled(back.second)).toMatchObject({ itemChanged: true, statusCode: "done", assigneesDone: 1, assigneesTotal: 1 });
    expect(await itemState(item2)).toEqual({ title: "تمرین گروهی دوم", category: "done", assignees: [{ personId: staying2.personId, state: "done" }] });
  });

  it("C11: a «بازیابی» racing the removal of a student who is history on the item: they never come back with it, whichever runs first", async () => {
    // «بازیابی» first (the leaver is still here, so it starts over with them): the removal waits for the reopening's
    // lock on the leaver's person row, then finds the item open and takes them out.
    const leaving = await newStudent("بردیا");
    const staying = await newStudent("بنفشه");
    const item = await giveTo("تمرین بازگشته", [leaving.personId, staying.personId]);
    await committed((tx) => changeStatus(tx, orgAdmin, { workItemId: item, toStatusCode: "done" }));
    const r = await race(
      (tx) => changeStatus(tx, orgAdmin, { workItemId: item, toStatusCode: "open" }),
      (tx) => removePerson(tx, orgAdmin, { personId: leaving.personId, kind: "student" }),
    );
    expect(r.waited).toBe(true);
    expect(r.first).toMatchObject({ statusCode: "open", assigneesTotal: 2 });
    expect(expectFulfilled(r.second)).toMatchObject({ withdrawnWorkItems: 1, completedWorkItems: 0 });
    expect(await itemState(item)).toEqual({ title: "تمرین بازگشته", category: "todo", assignees: [{ personId: staying.personId, state: "pending" }] });

    // The removal first (a closed item: history, nothing to take out yet): «بازیابی» waits for the removal on the
    // leaver's person row, then reads them as removed and takes them out instead of starting them over.
    const leaving2 = await newStudent("بهاره");
    const staying2 = await newStudent("بیژن");
    const item2 = await giveTo("تمرین بازگشته دوم", [leaving2.personId, staying2.personId]);
    await committed((tx) => changeStatus(tx, orgAdmin, { workItemId: item2, toStatusCode: "done" }));
    const back = await race(
      (tx) => removePerson(tx, orgAdmin, { personId: leaving2.personId, kind: "student" }),
      (tx) => changeStatus(tx, orgAdmin, { workItemId: item2, toStatusCode: "open" }),
    );
    expect(back.waited).toBe(true);
    expect(back.first).toMatchObject({ withdrawnWorkItems: 0 });
    expect(expectFulfilled(back.second)).toMatchObject({ statusCode: "open", assigneesTotal: 1, assigneesDone: 0 });
    expect(await itemState(item2)).toEqual({ title: "تمرین بازگشته دوم", category: "todo", assignees: [{ personId: staying2.personId, state: "pending" }] });
  });

  it("C12: a removal holding its person row against «اتمام» / «ویرایش» of an open item they are assigned — no deadlock, the item write waits before the item, the removed one is not notified", async () => {
    const lockPerson = (personId: string) => (tx: Tx) => tx.select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.id, personId)).for("update");
    const notifiedOn = (personId: string, workItemId: string) =>
      committed((tx) => tx.select({ type: notification.typeCode }).from(notification).where(and(eq(notification.recipientPersonId, personId), eq(notification.sourceId, workItemId))));

    // «اتمام»: the removal's first lock is taken (as `planRemoval` takes it), then the giver closes the item; only once
    // that is seen waiting does the removal go on — to the item, which must still be free.
    const leaving = await newStudent("تینا");
    const staying = await newStudent("تیام");
    const item = await giveTo("تمرین پایانی", [leaving.personId, staying.personId]);
    const r = await race(
      lockPerson(leaving.personId),
      (tx) => changeStatus(tx, orgAdmin, { workItemId: item, toStatusCode: "done" }),
      (tx) => removePerson(tx, orgAdmin, { personId: leaving.personId, kind: "student" }),
    );
    expect(r.waited).toBe(true);
    expect(expectFulfilled(r.second)).toMatchObject({ statusCode: "done", itemChanged: true, assigneesTotal: 1 });
    expect(await itemState(item)).toEqual({ title: "تمرین پایانی", category: "done", assignees: [{ personId: staying.personId, state: "done" }] });
    expect(await notifiedOn(leaving.personId, item)).toEqual([{ type: "work_item.assigned" }]);

    // «ویرایش»: the same, the edit's notification would have locked the leaver after the item.
    const leaving2 = await newStudent("تارا");
    const staying2 = await newStudent("تورج");
    const item2 = await giveTo("تمرین ویرایشی", [leaving2.personId, staying2.personId]);
    const edit = await race(
      lockPerson(leaving2.personId),
      (tx) => updateWorkItem(tx, orgAdmin, { workItemId: item2, title: "تمرین ویرایشی (تازه)" }),
      (tx) => removePerson(tx, orgAdmin, { personId: leaving2.personId, kind: "student" }),
    );
    expect(edit.waited).toBe(true);
    expect(expectFulfilled(edit.second)).toMatchObject({ changed: ["title"], notified: 1 });
    expect(await itemState(item2)).toEqual({ title: "تمرین ویرایشی (تازه)", category: "todo", assignees: [{ personId: staying2.personId, state: "pending" }] });
    expect(await notifiedOn(leaving2.personId, item2)).toEqual([{ type: "work_item.assigned" }]);
  });
});
