// workspace service + read model: createWorkItem fan-out (assignees, inbox entries, notifications with dedupe),
// visibility (NOT_FOUND, never FORBIDDEN), per-assignee completion, staff-only comments and the Tehran buckets of
// listInbox / inboxCounts. Every business write happens inside a withTenant transaction that ends with Rollback;
// only the catalog rows (a system `task` type + statuses + notification types, written as app_owner) are committed
// and removed again in afterAll, so the alphabetical neighbours keep their fixture counts.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import { auditLog, inboxEntry, notification, workItem, workItemAssignee } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { tehranDayBounds, toFaDigits } from "@/lib/format";
import type { Assignment } from "@/modules/iam/can";
import { notifyMany } from "@/modules/notif/service";
import { inboxCounts, listComments, listInbox } from "@/modules/workspace/repo";
import { addComment, canViewWorkItem, changeStatus, createWorkItem, getWorkItemDetail, markInboxRead, type WorkspaceCtx } from "@/modules/workspace/service";
import * as f from "./fixtures";
import { Rollback, asAppOwner } from "./helpers";

const TASK_TYPE = "0199a000-00f0-7000-8000-000000000a5c";
const ST = {
  open: "0199a000-00f1-7000-8000-000000000001",
  in_progress: "0199a000-00f1-7000-8000-000000000002",
  done: "0199a000-00f1-7000-8000-000000000003",
  cancelled: "0199a000-00f1-7000-8000-000000000004",
};
const NT = ["work_item.assigned", "work_item.comment", "work_item.status_changed"];

const WORK_PERMS = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment", "workspace.work_item.assign_class"];
const STUDENT_PERMS = ["workspace.work_item.read", "workspace.work_item.update", "workspace.work_item.comment"];

const teacherOf = (offeringId: string): Assignment => ({ roleCode: "teacher", roleId: "r-teacher", scopeType: "class_offering", scopeId: offeringId, permissions: WORK_PERMS });
const studentRole = (profileId: string): Assignment => ({ roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: STUDENT_PERMS });
const adminRole: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: WORK_PERMS };

const ctxOf = (personId: string, assignments: Assignment[]): WorkspaceCtx => ({ orgId: f.ORG_A, personId, userId: null, requestId: "int-test", assignments });
const teacher = ctxOf(f.PERSON_A2, [teacherOf(f.OFFERING_A1)]);
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };

const uuid = (n: number) => `0199a000-00f2-7000-8000-${String(n).padStart(12, "0")}`;

interface Student {
  personId: string;
  profileId: string;
  ctx: WorkspaceCtx;
}

/** Extra students of class group A1 (roster of OFFERING_A1) written INSIDE the rolled-back transaction as app_rw. */
async function enrollStudents(tx: Tx, n: number, from = 1): Promise<Student[]> {
  const out: Student[] = [];
  for (let i = from; i < from + n; i++) {
    const personId = uuid(i);
    const profileId = uuid(100 + i);
    await tx.execute(`insert into iam.person (id, organization_id, first_name, last_name) values ('${personId}', '${f.ORG_A}', 'دانش‌آموز', 'شمارهٴ ${toFaDigits(String(i))}')`);
    await tx.execute(
      `insert into iam.student_profile (id, organization_id, person_id, student_number) values ('${profileId}', '${f.ORG_A}', '${personId}', 'T${String(i).padStart(4, "0")}')`,
    );
    const se = uuid(200 + i);
    await tx.execute(
      `insert into academic.school_enrollment (id, organization_id, student_profile_id, school_id, academic_year_id, grade_level_id)
       values ('${se}', '${f.ORG_A}', '${profileId}', '${f.SCHOOL_A}', '${f.YEAR_A}', '${f.GRADE_A}')`,
    );
    await tx.execute(
      `insert into academic.class_enrollment (id, organization_id, school_enrollment_id, class_group_id, student_profile_id, status)
       values ('${uuid(300 + i)}', '${f.ORG_A}', '${se}', '${f.CLASS_GROUP_A1}', '${profileId}', 'active')`,
    );
    out.push({ personId, profileId, ctx: ctxOf(personId, [studentRole(profileId)]) });
  }
  return out;
}

/** Runs `fn` in a tenant transaction that is always rolled back; assertion errors inside propagate unchanged. */
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
  throw new Error("expected the transaction to roll back");
}

const isCode = (code: string) => (err: unknown) => AppError.is(err) && err.code === code;

beforeAll(async () => {
  await asAppOwner(async (c) => {
    await c.query(
      `insert into workspace.work_item_type (id, organization_id, code, name, requires_assignee) values ($1, null, 'task', 'تکلیف', true) on conflict (organization_id, code) do nothing`,
      [TASK_TYPE],
    );
    const statuses: [string, string, string, string, number, boolean][] = [
      [ST.open, "open", "باز", "todo", 1, false],
      [ST.in_progress, "in_progress", "در حال انجام", "doing", 2, false],
      [ST.done, "done", "انجام‌شده", "done", 3, true],
      [ST.cancelled, "cancelled", "لغوشده", "cancelled", 4, true],
    ];
    for (const [id, code, name, category, seq, terminal] of statuses) {
      await c.query(
        `insert into workspace.work_item_status (id, work_item_type_id, code, name, category, sequence, is_terminal) values ($1, $2, $3, $4, $5, $6, $7) on conflict (work_item_type_id, code) do nothing`,
        [id, TASK_TYPE, code, name, category, seq, terminal],
      );
    }
    for (const code of NT) {
      await c.query(`insert into notif.notification_type (code, module, name) values ($1, 'workspace', $1) on conflict (code) do nothing`, [code]);
    }
  });
});

afterAll(async () => {
  await asAppOwner(async (c) => {
    await c.query(`delete from workspace.work_item_status where work_item_type_id = $1`, [TASK_TYPE]);
    await c.query(`delete from workspace.work_item_type where id = $1`, [TASK_TYPE]);
    await c.query(`delete from notif.notification_type where code = any($1::text[])`, [NT]);
  });
});

describe("createWorkItem for a class offering", () => {
  it("N assignees, N+1 inbox entries (creator read), N deduped notifications, one transition, one audit row", async () => {
    await rolledBack(async (tx) => {
      const students = await enrollStudents(tx, 3);
      const res = await createWorkItem(tx, teacher, {
        typeCode: "task",
        title: "تمرین صفحهٴ ۴۲",
        priority: "normal",
        dueAt: new Date(Date.now() + 3 * 86_400_000),
        recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] },
      });
      // The fixture student (PERSON_A1) is NOT enrolled in class group A1, so the roster is exactly the 3 new ones.
      expect(res.assigneeCount).toBe(3);
      expect(res.notified).toBe(3);

      const assignees = await tx.select({ personId: workItemAssignee.personId, state: workItemAssignee.state }).from(workItemAssignee).where(eq(workItemAssignee.workItemId, res.id));
      expect(assignees.map((a) => a.personId).sort()).toEqual(students.map((s) => s.personId).sort());
      expect(assignees.every((a) => a.state === "pending")).toBe(true);

      const entries = await tx.select({ personId: inboxEntry.personId, state: inboxEntry.state, relation: inboxEntry.relation }).from(inboxEntry).where(eq(inboxEntry.workItemId, res.id));
      expect(entries).toHaveLength(4);
      expect(entries.find((e) => e.personId === f.PERSON_A2)).toMatchObject({ state: "read", relation: "creator" });
      expect(entries.filter((e) => e.personId !== f.PERSON_A2).every((e) => e.state === "unread" && e.relation === "assignee")).toBe(true);

      const notifs = await tx
        .select({ recipient: notification.recipientPersonId, title: notification.title, body: notification.body, deepLink: notification.deepLink, dedupeKey: notification.dedupeKey })
        .from(notification)
        .where(eq(notification.sourceId, res.id));
      expect(notifs).toHaveLength(3);
      expect(notifs[0]).toMatchObject({ title: "کار جدید: تمرین صفحهٴ ۴۲", body: "زهرا کریمی", deepLink: `/inbox/${res.id}` });
      expect(notifs.map((n) => n.dedupeKey)).toEqual(expect.arrayContaining(students.map((s) => `wi:${res.id}:assigned:${s.personId}`)));

      // Re-running the same fan-out inserts nothing (dedupe key per recipient).
      const again = await notifyMany(tx, teacher, students.map((s) => s.personId), {
        typeCode: "work_item.assigned",
        title: "x",
        dedupeKey: (p) => `wi:${res.id}:assigned:${p}`,
      });
      expect(again).toBe(0);

      const trail = await tx.select({ action: auditLog.action, actor: auditLog.actorPersonId }).from(auditLog).where(eq(auditLog.entityId, res.id));
      expect(trail).toEqual([{ action: "workspace.work_item.created", actor: f.PERSON_A2 }]);
    });
  });

  it("un-checked students are left out; a teacher of ANOTHER offering is FORBIDDEN; an empty roster is VALIDATION", async () => {
    await rolledBack(async (tx) => {
      const students = await enrollStudents(tx, 3);
      const res = await createWorkItem(tx, teacher, {
        typeCode: "task",
        title: "فقط دو نفر",
        priority: "low",
        recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [students[0].personId] },
      });
      expect(res.assigneeCount).toBe(2);

      const other = ctxOf(f.PERSON_A2, [teacherOf(f.OFFERING_B1)]);
      await expect(
        createWorkItem(tx, other, { typeCode: "task", title: "x", priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } }),
      ).rejects.toSatisfy(isCode("FORBIDDEN"));

      await expect(
        createWorkItem(tx, teacher, {
          typeCode: "task",
          title: "x",
          priority: "normal",
          recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: students.map((s) => s.personId) },
        }),
      ).rejects.toSatisfy(isCode("VALIDATION"));
    });
  });

  it("a personal todo («خودم»): one assignee row, one read inbox entry, no notification; done closes it at once", async () => {
    await rolledBack(async (tx) => {
      const res = await createWorkItem(tx, teacher, { typeCode: "task", title: "یادداشت شخصی", priority: "high", recipients: { kind: "self" } });
      expect(res).toMatchObject({ assigneeCount: 1, notified: 0 });
      const entries = await tx.select({ relation: inboxEntry.relation, state: inboxEntry.state }).from(inboxEntry).where(eq(inboxEntry.workItemId, res.id));
      expect(entries).toEqual([{ relation: "assignee", state: "read" }]);
      const done = await changeStatus(tx, teacher, { workItemId: res.id, toStatusCode: "done" });
      expect(done).toMatchObject({ statusCode: "done", itemChanged: true, assigneesDone: 1, assigneesTotal: 1 });
    });
  });
});

describe("visibility — canViewWorkItem", () => {
  it("assignee and creator see it; another student, a teacher of another offering: NOT_FOUND; a broad admin sees it", async () => {
    await rolledBack(async (tx) => {
      const [a, b] = await enrollStudents(tx, 2);
      const res = await createWorkItem(tx, teacher, {
        typeCode: "task",
        title: "فقط برای الف",
        priority: "normal",
        recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [b.personId] },
      });
      await expect(canViewWorkItem(tx, a.ctx, res.id)).resolves.toMatchObject({ id: res.id });
      await expect(canViewWorkItem(tx, teacher, res.id)).resolves.toMatchObject({ id: res.id });
      await expect(canViewWorkItem(tx, b.ctx, res.id)).rejects.toSatisfy(isCode("NOT_FOUND"));
      const otherTeacher = ctxOf(f.PERSON_A1, [teacherOf(f.OFFERING_B1)]);
      await expect(getWorkItemDetail(tx, otherTeacher, res.id)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(changeStatus(tx, b.ctx, { workItemId: res.id, toStatusCode: "done" })).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(addComment(tx, b.ctx, { workItemId: res.id, body: "سلام" })).rejects.toSatisfy(isCode("NOT_FOUND"));
      const admin = ctxOf(f.PERSON_A1, [adminRole]);
      await expect(canViewWorkItem(tx, admin, res.id)).resolves.toMatchObject({ id: res.id });
      // Unknown id → NOT_FOUND too (same shape as "not mine").
      await expect(canViewWorkItem(tx, teacher, uuid(999))).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });
});

describe("changeStatus — per-assignee completion", () => {
  it("in_progress marks my row accepted and moves the item; done per student; item done only when all are done; creator reopens", async () => {
    await rolledBack(async (tx) => {
      const [s1, s2, s3] = await enrollStudents(tx, 3);
      const res = await createWorkItem(tx, teacher, { typeCode: "task", title: "تمرین", priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } });

      const started = await changeStatus(tx, s1.ctx, { workItemId: res.id, toStatusCode: "in_progress" });
      expect(started).toMatchObject({ statusCode: "in_progress", itemChanged: true, assigneesDone: 0, assigneesTotal: 3 });

      const d1 = await changeStatus(tx, s1.ctx, { workItemId: res.id, toStatusCode: "done" });
      expect(d1).toMatchObject({ statusCode: "in_progress", itemChanged: false, assigneesDone: 1, assigneesTotal: 3 });
      // Twice is rejected; a student cannot cancel or reopen.
      await expect(changeStatus(tx, s1.ctx, { workItemId: res.id, toStatusCode: "done" })).rejects.toSatisfy(isCode("VALIDATION"));
      await expect(changeStatus(tx, s2.ctx, { workItemId: res.id, toStatusCode: "cancelled" })).rejects.toSatisfy(isCode("FORBIDDEN"));

      // The creator was notified about s1's completion with the progress; her inbox row went back to unread.
      const toCreator = await tx.select({ title: notification.title, type: notification.typeCode }).from(notification).where(eq(notification.recipientPersonId, f.PERSON_A2));
      expect(toCreator).toEqual([{ title: "دانش‌آموز شمارهٴ ۱ «تمرین» را انجام‌شده کرد (۱/۳)", type: "work_item.status_changed" }]);
      const creatorEntry = (await tx.select({ personId: inboxEntry.personId, state: inboxEntry.state }).from(inboxEntry).where(eq(inboxEntry.workItemId, res.id))).find(
        (e) => e.personId === f.PERSON_A2,
      );
      expect(creatorEntry?.state).toBe("unread");

      // Student's own list shows the item under «انجام‌شده» although the item itself is still in progress.
      const mine = await listInbox(tx, s1.personId, { tab: "done" });
      expect(mine.rows.map((r) => r.id)).toEqual([res.id]);
      expect(mine.rows[0]).toMatchObject({ category: "done", myAssigneeState: "done", assigneesDone: 1, assigneesTotal: 3 });
      const teacherDoing = await listInbox(tx, f.PERSON_A2, { tab: "doing", createdByMe: true });
      expect(teacherDoing.rows[0]).toMatchObject({ id: res.id, createdByMe: true, assigneesDone: 1, assigneesTotal: 3 });

      await changeStatus(tx, s2.ctx, { workItemId: res.id, toStatusCode: "done" });
      const d3 = await changeStatus(tx, s3.ctx, { workItemId: res.id, toStatusCode: "done" });
      expect(d3).toMatchObject({ statusCode: "done", itemChanged: true, assigneesDone: 3, assigneesTotal: 3 });
      const [wi] = await tx.select({ completedAt: workItem.completedAt }).from(workItem).where(eq(workItem.id, res.id));
      expect(wi.completedAt).toBeInstanceOf(Date);

      // Creator reopens: every assignee back to pending, completed_at cleared, assignees notified.
      const reopened = await changeStatus(tx, teacher, { workItemId: res.id, toStatusCode: "open" });
      expect(reopened).toMatchObject({ statusCode: "open", itemChanged: true, assigneesDone: 0 });
      const [after] = await tx.select({ completedAt: workItem.completedAt }).from(workItem).where(eq(workItem.id, res.id));
      expect(after.completedAt).toBeNull();
      const detail = await getWorkItemDetail(tx, teacher, res.id);
      expect(detail.transitions.map((t) => t.toStatusName)).toEqual(["باز", "انجام‌شده", "در حال انجام", "باز"]);
      expect(detail.viewer).toMatchObject({ isCreator: true, isManager: true, isStaff: true });
    });
  });
});

describe("comments", () => {
  it("staff_only comments are hidden from students (and a student's staff_only request is downgraded to all)", async () => {
    await rolledBack(async (tx) => {
      const [s1] = await enrollStudents(tx, 1);
      const res = await createWorkItem(tx, teacher, { typeCode: "task", title: "تمرین", priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } });
      await markInboxRead(tx, s1.ctx, { workItemId: res.id });

      const staffNote = await addComment(tx, teacher, { workItemId: res.id, body: "یادداشت داخلی", visibility: "staff_only" });
      expect(staffNote.visibility).toBe("staff_only");
      const pub = await addComment(tx, teacher, { workItemId: res.id, body: "سؤالی بود بپرسید" });
      const fromStudent = await addComment(tx, s1.ctx, { workItemId: res.id, body: "انجام دادم", visibility: "staff_only" });
      expect(fromStudent.visibility).toBe("all");

      const studentView = await getWorkItemDetail(tx, s1.ctx, res.id);
      expect(studentView.comments.map((c) => c.id)).toEqual([pub.id, fromStudent.id]);
      expect(studentView.viewer.isStaff).toBe(false);
      const teacherView = await listComments(tx, res.id, true);
      expect(teacherView.map((c) => c.id)).toEqual([staffNote.id, pub.id, fromStudent.id]);

      // The public comment re-flagged the student's inbox row as unread and notified her; the staff-only one did not.
      const notifs = await tx.select({ title: notification.title, body: notification.body }).from(notification).where(eq(notification.recipientPersonId, s1.personId));
      expect(notifs.map((n) => n.title)).toEqual(["کار جدید: تمرین", "نظر جدید: تمرین"]);
      expect(notifs[1].body).toBe("زهرا کریمی: سؤالی بود بپرسید");
      const mine = await listInbox(tx, s1.personId, { tab: "todo" });
      expect(mine.rows[0]).toMatchObject({ id: res.id, unread: true, commentsCount: 3 - 1 });
    });
  });
});

describe("listInbox buckets and inboxCounts (Tehran day boundaries)", () => {
  it("due today 23:59 Tehran → «امروز»; yesterday → «سررسیده»; Thursday next → «این هفته»/«بعداً»; no due → «بدون مهلت»", async () => {
    await rolledBack(async (tx) => {
      const [s1] = await enrollStudents(tx, 1);
      const now = new Date();
      const b = tehranDayBounds(now);
      const mk = (title: string, dueAt: Date | null) =>
        createWorkItem(tx, teacher, { typeCode: "task", title, priority: "normal", dueAt, recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } });
      const today = await mk("امروز ۲۳:۵۹", new Date(b.todayEnd.getTime() - 60_000));
      const yesterday = await mk("دیروز", new Date(b.todayStart.getTime() - 60_000));
      const inWeek = new Date(b.weekEnd.getTime() - 60_000);
      const week = await mk("آخر هفته", inWeek);
      const later = await mk("ماه بعد", new Date(b.weekEnd.getTime() + 10 * 86_400_000));
      const none = await mk("بی‌مهلت", null);

      const page = await listInbox(tx, s1.personId, { tab: "todo" }, b);
      const byId = new Map(page.rows.map((r) => [r.id, r]));
      expect(byId.get(today.id)?.bucket).toBe("today");
      expect(byId.get(yesterday.id)?.bucket).toBe("overdue");
      // When today is Friday, "end of week" IS the end of today.
      expect(byId.get(week.id)?.bucket).toBe(inWeek < b.todayEnd ? "today" : "week");
      expect(byId.get(later.id)?.bucket).toBe("later");
      expect(byId.get(none.id)?.bucket).toBe("none");
      // Order: due_at NULLS LAST.
      expect(page.rows.map((r) => r.id)).toEqual([yesterday.id, today.id, week.id, later.id, none.id]);

      const onlyOverdue = await listInbox(tx, s1.personId, { tab: "todo", bucket: "overdue" }, b);
      expect(onlyOverdue.rows.map((r) => r.id)).toEqual([yesterday.id]);

      // Keyset pagination: 2 + 2 + 1.
      const p1 = await listInbox(tx, s1.personId, { tab: "todo", limit: 2 }, b);
      expect(p1.rows).toHaveLength(2);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await listInbox(tx, s1.personId, { tab: "todo", limit: 2, cursor: p1.nextCursor }, b);
      const p3 = await listInbox(tx, s1.personId, { tab: "todo", limit: 2, cursor: p2.nextCursor }, b);
      expect([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).toEqual(page.rows.map((r) => r.id));
      expect(p3.nextCursor).toBeNull();

      const counts = await inboxCounts(tx, s1.personId, b);
      expect(counts).toEqual({ overdue: 1, dueToday: inWeek < b.todayEnd ? 2 : 1, unread: 5 });

      // A finished overdue item is no longer overdue (it lands in «امروز» only for grouping, and counts drop).
      await changeStatus(tx, s1.ctx, { workItemId: yesterday.id, toStatusCode: "done" });
      const after = await inboxCounts(tx, s1.personId, b);
      expect(after.overdue).toBe(0);
      const doneTab = await listInbox(tx, s1.personId, { tab: "done" }, b);
      expect(doneTab.rows.map((r) => r.id)).toEqual([yesterday.id]);

      // Read marker flips unread; archive hides it from the list.
      await markInboxRead(tx, s1.ctx, { workItemId: today.id });
      expect((await inboxCounts(tx, s1.personId, b)).unread).toBe(4);
    });
  });
});
