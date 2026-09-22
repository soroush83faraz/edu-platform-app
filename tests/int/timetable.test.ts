// Weekly class timetable («برنامهٴ کلاسی», migration 0015): the bell schedule (setSchoolPeriods), the slot upsert /
// clear with its scope rule (vice at own school OK, another school or an unknown class NOT_FOUND, an offering of
// another class VALIDATION, a teacher booked twice → allowed with a Persian warning), the personal read models
// (getMyTimetable for a student and a teacher, getOfferingPage visibility) and the workspace link
// (createWorkItem stores class_offering_id; listInbox / inboxTabCounts filter by it). Every write happens inside a
// withTenant transaction that ends with Rollback; only the `work_item.assigned` notification type (a global
// catalog row, app_owner) is committed for the file and removed again in afterAll.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import { auditLog, classOffering, schoolPeriod, timetableSlot } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { DEFAULT_PERIODS } from "@/lib/timetable";
import { assignTeacher, enrollStudent, getClassTimetable, getMyTimetable, getOfferingPage, setTimetableSlot, type TimetableCtx } from "@/modules/academic/service";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { setSchoolPeriods } from "@/modules/tenancy/service";
import { inboxTabCounts, listInbox } from "@/modules/workspace/repo";
import { createWorkItem, type WorkspaceCtx } from "@/modules/workspace/service";
import * as f from "./fixtures";
import { Rollback, asAppOwner } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const VICE_PERMS = ["iam.admin.access", "tenancy.structure.read", "academic.timetable.read", "academic.timetable.write", "workspace.work_item.read"];
const TEACHER_PERMS = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.assign_class", "academic.timetable.read"];
const STUDENT_PERMS = ["workspace.work_item.read", "academic.timetable.read"];

const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: VICE_PERMS });
const teacherOf = (offeringId: string): Assignment => ({ roleCode: "teacher", roleId: "r-teacher", scopeType: "class_offering", scopeId: offeringId, permissions: TEACHER_PERMS });
const studentRole = (profileId: string): Assignment => ({ roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: STUDENT_PERMS });

const ctxOf = (personId: string, assignments: Assignment[]): TimetableCtx & WorkspaceCtx => ({ orgId: f.ORG_A, personId, userId: null, requestId: "int-test", assignments });
const admin = ctxOf(f.PERSON_A2, [orgAdmin]);
const vice = ctxOf(f.PERSON_A2, [viceOf(f.SCHOOL_A)]);
const viceElsewhere = ctxOf(f.PERSON_A2, [viceOf(f.SCHOOL_B)]);
const teacher = ctxOf(f.PERSON_A2, [teacherOf(f.OFFERING_A1)]);
const student = ctxOf(f.PERSON_A1, [studentRole(f.STUDENT_A1)]);
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };

// A Tuesday 12:05 Tehran (08:35 UTC): زنگ پنجم of the default schedule rings.
const TUE_1205 = new Date("2026-09-22T08:35:00Z");
const isCode = (code: string) => (err: unknown) => AppError.is(err) && err.code === code;

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

/** The fixture school has no زنگ‌بندی (fixtures are inserted after the migrations): seed the six defaults in the tx. */
async function seedPeriods(tx: Tx): Promise<void> {
  await setSchoolPeriods(tx, admin, f.SCHOOL_A, DEFAULT_PERIODS.map((p) => ({ ...p })));
}

const NT = "work_item.assigned";
beforeAll(async () => {
  await asAppOwner((c) => c.query(`insert into notif.notification_type (code, module, name) values ($1, 'workspace', $1) on conflict (code) do nothing`, [NT]));
});
afterAll(async () => {
  await asAppOwner((c) => c.query(`delete from notif.notification_type where code = $1`, [NT]));
});

describe("setSchoolPeriods (زنگ‌بندی)", () => {
  it("replaces the bell schedule by period number, rejects an overlap with a Persian field error and audits on the school", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      const rows = await tx.select({ periodNo: schoolPeriod.periodNo, startsAt: schoolPeriod.startsAt }).from(schoolPeriod).where(eq(schoolPeriod.schoolId, f.SCHOOL_A)).orderBy(schoolPeriod.periodNo);
      expect(rows.map((r) => r.periodNo)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(rows[0].startsAt).toMatch(/^08:00/);

      // Shorten to four periods with a later start: rows 5–6 go, 1–4 update in place.
      await setSchoolPeriods(tx, admin, f.SCHOOL_A, [
        { periodNo: 1, label: "زنگ اول", startsAt: "۰۸:۳۰", endsAt: "09:15" },
        { periodNo: 2, label: "زنگ دوم", startsAt: "09:25", endsAt: "10:10" },
        { periodNo: 3, label: "زنگ سوم", startsAt: "10:20", endsAt: "11:05" },
        { periodNo: 4, label: "زنگ چهارم", startsAt: "11:15", endsAt: "12:00" },
      ]);
      const after = await tx.select({ periodNo: schoolPeriod.periodNo, startsAt: schoolPeriod.startsAt }).from(schoolPeriod).where(eq(schoolPeriod.schoolId, f.SCHOOL_A)).orderBy(schoolPeriod.periodNo);
      expect(after.map((r) => [r.periodNo, r.startsAt.slice(0, 5)])).toEqual([
        [1, "08:30"],
        [2, "09:25"],
        [3, "10:20"],
        [4, "11:15"],
      ]);

      await expect(
        setSchoolPeriods(tx, admin, f.SCHOOL_A, [
          { periodNo: 1, label: "زنگ اول", startsAt: "08:00", endsAt: "08:45" },
          { periodNo: 2, label: "زنگ دوم", startsAt: "08:40", endsAt: "09:25" },
        ]),
      ).rejects.toSatisfy((err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "زنگ ۲ با زنگ قبلی هم‌پوشانی دارد.");
      await expect(setSchoolPeriods(tx, admin, f.SCHOOL_B, DEFAULT_PERIODS.map((p) => ({ ...p })))).rejects.toSatisfy(isCode("NOT_FOUND"));

      const trail = await tx.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.entityId, f.SCHOOL_A), eq(auditLog.action, "tenancy.school_period.replaced")));
      expect(trail).toHaveLength(2);
    });
  });
});

describe("setTimetableSlot", () => {
  it("a vice principal of the class's school upserts and clears a cell; the row is deleted on clear; both are audited", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      const set = await setTimetableSlot(tx, vice, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: f.OFFERING_A1, room: " ۱۲ " });
      expect(set.slot).toMatchObject({ classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, offeringId: f.OFFERING_A1, subjectName: "ریاضی", teacherName: null, room: "۱۲" });
      expect(set.warning).toBeNull();

      // Same cell again with the same offering: updated in place (still one row).
      const again = await setTimetableSlot(tx, vice, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: f.OFFERING_A1 });
      expect(again.slot?.slotId).toBe(set.slot?.slotId);
      expect(again.slot?.room).toBeNull();
      const rows = await tx.select({ id: timetableSlot.id }).from(timetableSlot).where(eq(timetableSlot.classGroupId, f.CLASS_GROUP_A1));
      expect(rows).toHaveLength(1);

      const cleared = await setTimetableSlot(tx, vice, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: null });
      expect(cleared).toEqual({ slot: null, warning: null });
      expect(await tx.select({ id: timetableSlot.id }).from(timetableSlot).where(eq(timetableSlot.classGroupId, f.CLASS_GROUP_A1))).toEqual([]);
      // Clearing an empty cell is a no-op (no audit row).
      expect(await setTimetableSlot(tx, vice, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: null })).toEqual({ slot: null, warning: null });

      const trail = await tx.select({ action: auditLog.action, actor: auditLog.actorPersonId }).from(auditLog).where(eq(auditLog.entityId, set.slot!.slotId));
      expect(trail.map((t) => t.action)).toEqual(["academic.timetable_slot.set", "academic.timetable_slot.set", "academic.timetable_slot.cleared"]);
      expect(trail.every((t) => t.actor === f.PERSON_A2)).toBe(true);
    });
  });

  it("scope: another school's vice and an unknown class are NOT_FOUND; an offering of another class, a closed offering and an unknown زنگ are VALIDATION", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      const cell = { classGroupId: f.CLASS_GROUP_A1, weekday: 0, periodNo: 1 };
      await expect(setTimetableSlot(tx, viceElsewhere, { ...cell, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(setTimetableSlot(tx, vice, { ...cell, classGroupId: f.CLASS_GROUP_B1, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(isCode("NOT_FOUND"));
      // OFFERING_A1 belongs to CLASS_GROUP_A1, not A2.
      await expect(setTimetableSlot(tx, vice, { ...cell, classGroupId: f.CLASS_GROUP_A2, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "این درس برای این کلاس تعریف نشده است.",
      );
      await expect(setTimetableSlot(tx, vice, { ...cell, periodNo: 9, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "این زنگ در زنگ‌بندی مدرسه وجود ندارد.",
      );
      await expect(setTimetableSlot(tx, vice, { ...cell, weekday: 6, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(isCode("VALIDATION"));
      await tx.update(classOffering).set({ status: "closed" }).where(eq(classOffering.id, f.OFFERING_A1));
      await expect(setTimetableSlot(tx, vice, { ...cell, classOfferingId: f.OFFERING_A1 })).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "این درس پایان یافته و در برنامه قرار نمی‌گیرد.",
      );
    });
  });

  it("a teacher booked in two classes at the same زنگ is allowed by the database but flagged with a Persian warning", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      // A second offering of the same subject in class A2, taught by the same staff member as OFFERING_A1.
      const [second] = await tx
        .insert(classOffering)
        .values({ organizationId: f.ORG_A, classGroupId: f.CLASS_GROUP_A2, subjectId: f.SUBJECT_A, termId: f.TERM_A })
        .returning({ id: classOffering.id });
      await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
      await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: second.id });

      const first = await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: 1, periodNo: 2, classOfferingId: f.OFFERING_A1 });
      expect(first.warning).toBeNull();
      const clash = await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A2, weekday: 1, periodNo: 2, classOfferingId: second.id });
      expect(clash.slot).not.toBeNull();
      expect(clash.warning).toBe("زهرا کریمی در همین زنگ در کلاس اول 1 (ریاضی) هم درس دارد.");
      // A different زنگ: no warning.
      const other = await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A2, weekday: 1, periodNo: 3, classOfferingId: second.id });
      expect(other.warning).toBeNull();
    });
  });
});

describe("getClassTimetable / getMyTimetable / getOfferingPage", () => {
  it("the admin grid carries periods, slots with teacher names and the class's open offerings; a teacher cannot read a whole class", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
      await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: f.OFFERING_A1 });
      const grid = await getClassTimetable(tx, vice, f.CLASS_GROUP_A1);
      expect(grid.periods).toHaveLength(6);
      expect(grid.slots).toHaveLength(1);
      expect(grid.slots[0]).toMatchObject({ weekday: 3, periodNo: 5, subjectName: "ریاضی", teacherName: "زهرا کریمی" });
      expect(grid.offerings).toEqual([{ id: f.OFFERING_A1, subjectName: "ریاضی", teacherName: "زهرا کریمی", status: "active" }]);
      expect(grid.canEdit).toBe(true);
      await expect(getClassTimetable(tx, teacher, f.CLASS_GROUP_A1)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(getClassTimetable(tx, viceElsewhere, f.CLASS_GROUP_A1)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });

  it("a student gets their class's days with today and the ringing زنگ; a teacher gets their sessions across classes; a person with neither gets nulls", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
      await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
      await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: f.OFFERING_A1 });
      await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: 0, periodNo: 1, classOfferingId: f.OFFERING_A1 });

      const mine = await getMyTimetable(tx, student, TUE_1205);
      expect(mine.teacher).toBeNull();
      expect(mine.today).toBe(3);
      expect(mine.nowMinutes).toBe(12 * 60 + 5);
      expect(mine.currentPeriodNo).toBe(5);
      expect(mine.nextPeriodNo).toBe(6);
      expect(mine.student).toMatchObject({ classGroupName: "اول 1", schoolName: "دبستان" });
      expect(mine.student!.days.map((d) => [d.weekday, d.sessions.length])).toEqual([
        [0, 1],
        [1, 0],
        [2, 0],
        [3, 1],
        [4, 0],
        [5, 0],
      ]);
      expect(mine.student!.days[3].sessions[0]).toMatchObject({ offeringId: f.OFFERING_A1, subjectName: "ریاضی", teacherName: "زهرا کریمی", label: "زنگ پنجم", startsAt: "12:00", endsAt: "12:45" });

      const theirs = await getMyTimetable(tx, teacher, TUE_1205);
      expect(theirs.student).toBeNull();
      expect(theirs.teacher).toMatchObject({ sessions: 2 });
      expect(theirs.teacher!.days[0].sessions[0]).toMatchObject({ classGroupName: "اول 1", periodNo: 1, startsAt: "08:00" });
    });
    await rolledBack(async (tx) => {
      const none = await getMyTimetable(tx, ctxOf(f.PERSON_A1, [studentRole(f.STUDENT_A1)]), TUE_1205);
      expect(none).toMatchObject({ student: null, teacher: null, currentPeriodNo: null, nextPeriodNo: null });
    });
  });

  it("the subject page: visible to the class's student, the offering's teacher and a broad admin; NOT_FOUND for a student of another class", async () => {
    await rolledBack(async (tx) => {
      await seedPeriods(tx);
      await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
      await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
      await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 5, classOfferingId: f.OFFERING_A1 });
      await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: 3, periodNo: 1, classOfferingId: f.OFFERING_A1 });

      const asStudent = await getOfferingPage(tx, student, f.OFFERING_A1, TUE_1205);
      expect(asStudent.offering).toMatchObject({ id: f.OFFERING_A1, subjectName: "ریاضی", classGroupName: "اول 1", teacherName: "زهرا کریمی" });
      expect(asStudent.sessions.map((s) => s.periodNo)).toEqual([1, 5]);
      // 12:05 on Tuesday: زنگ اول is over, زنگ پنجم rings → it is the next session, today.
      expect(asStudent.nextSession).toMatchObject({ weekday: 3, periodNo: 5, daysAhead: 0 });
      expect(asStudent.viewer).toEqual({ isTeacher: false, isStudent: true, canCreate: false });

      const asTeacher = await getOfferingPage(tx, teacher, f.OFFERING_A1, TUE_1205);
      expect(asTeacher.viewer).toEqual({ isTeacher: true, isStudent: false, canCreate: true });
      // A broad admin who is neither (a read only: the person need not exist).
      const asAdmin = await getOfferingPage(tx, ctxOf("0199a000-00f9-7000-8000-0000000000aa", [orgAdmin]), f.OFFERING_A1, TUE_1205);
      expect(asAdmin.viewer).toEqual({ isTeacher: false, isStudent: false, canCreate: false });

      // A student of class A2 — same school, other class — gets NOT_FOUND, never FORBIDDEN.
      await tx.execute(`insert into iam.person (id, organization_id, first_name, last_name) values ('0199a000-00f9-7000-8000-000000000001', '${f.ORG_A}', 'نیما', 'کیانی')`);
      await tx.execute(`insert into iam.student_profile (id, organization_id, person_id, student_number) values ('0199a000-00f9-7000-8000-000000000002', '${f.ORG_A}', '0199a000-00f9-7000-8000-000000000001', 'T9')`);
      await enrollStudent(tx, admin, { studentProfileId: "0199a000-00f9-7000-8000-000000000002", classGroupId: f.CLASS_GROUP_A2 });
      const other = ctxOf("0199a000-00f9-7000-8000-000000000001", [studentRole("0199a000-00f9-7000-8000-000000000002")]);
      await expect(getOfferingPage(tx, other, f.OFFERING_A1, TUE_1205)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(getOfferingPage(tx, student, f.OFFERING_B1, TUE_1205)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });
});

describe("work items of a درس", () => {
  it("createWorkItem for a class offering stores class_offering_id; listInbox / inboxTabCounts filter by it for the student and the teacher", async () => {
    await rolledBack(async (tx) => {
      await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
      const linked = await createWorkItem(tx, teacher, { typeCode: "todo", title: "تمرین فصل ۱", priority: "normal", recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] } });
      const personal = await createWorkItem(tx, teacher, { typeCode: "todo", title: "کار شخصی", priority: "normal", recipients: { kind: "self" } });
      const rows = await tx.execute<{ id: string; class_offering_id: string | null }>(`select id, class_offering_id from workspace.work_item where id in ('${linked.id}', '${personal.id}') order by title`);
      expect(rows.rows).toEqual([
        { id: linked.id, class_offering_id: f.OFFERING_A1 },
        { id: personal.id, class_offering_id: null },
      ]);

      const forStudent = await listInbox(tx, f.PERSON_A1, { tab: "todo", offeringId: f.OFFERING_A1 });
      expect(forStudent.rows.map((r) => r.id)).toEqual([linked.id]);
      const forTeacher = await listInbox(tx, f.PERSON_A2, { tab: "all", offeringId: f.OFFERING_A1 });
      expect(forTeacher.rows.map((r) => r.id)).toEqual([linked.id]);
      const unfiltered = await listInbox(tx, f.PERSON_A2, { tab: "all" });
      expect(unfiltered.rows.map((r) => r.id).sort()).toEqual([linked.id, personal.id].sort());
      expect(await inboxTabCounts(tx, f.PERSON_A2, { offeringId: f.OFFERING_A1 })).toEqual({ todo: 1, done: 0 });
      expect(await inboxTabCounts(tx, f.PERSON_A2, {})).toEqual({ todo: 2, done: 0 });
      expect(await inboxTabCounts(tx, f.PERSON_A2, { offeringId: f.OFFERING_B1 })).toEqual({ todo: 0, done: 0 });
    });
  });
});
