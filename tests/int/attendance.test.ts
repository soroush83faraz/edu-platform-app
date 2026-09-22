// «حضور و غیاب» (migration 0016): taking a roll call and re-taking it (one row, updated), the scope rule (the
// teacher of the زنگ's درس may write, a teacher of another class is NOT_FOUND, an admin of another school too),
// the date rule (never the future), the roster rule (only active enrollments of that class), the student's own
// summary, the class report totals and the tenant boundary. Every write happens inside a withTenant transaction
// that ends with Rollback, so the fixture counts other files assert stay intact.
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import { attendanceEntry, attendanceSession, auditLog } from "@/db/schema";
import { addDaysIso, tehranToday, weekdayOfIso } from "@/lib/attendance";
import { AppError } from "@/lib/errors";
import { DEFAULT_PERIODS } from "@/lib/timetable";
import { classAttendanceReport, getSessionForTaking, studentAttendanceSummary, takeAttendance, teacherDay, type AttendanceCtx } from "@/modules/academic/attendance";
import { assignTeacher, enrollStudent, setTimetableSlot } from "@/modules/academic/service";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { setSchoolPeriods } from "@/modules/tenancy/service";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const VICE_PERMS = ["iam.admin.access", "academic.timetable.read", "academic.timetable.write", "academic.attendance.read", "academic.attendance.write", "academic.attendance.report"];
const TEACHER_PERMS = ["workspace.work_item.read", "academic.timetable.read", "academic.attendance.read", "academic.attendance.write"];
const STUDENT_PERMS = ["workspace.work_item.read", "academic.timetable.read", "academic.attendance.read"];

const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: VICE_PERMS });
const teacherOf = (offeringId: string): Assignment => ({ roleCode: "teacher", roleId: "r-teacher", scopeType: "class_offering", scopeId: offeringId, permissions: TEACHER_PERMS });
const studentRole = (profileId: string): Assignment => ({ roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: STUDENT_PERMS });

const ctxOf = (orgId: string, personId: string, assignments: Assignment[]): AttendanceCtx => ({ orgId, personId, userId: null, requestId: "int-test", assignments });
const admin = ctxOf(f.ORG_A, f.PERSON_A2, [orgAdmin]);
const vice = ctxOf(f.ORG_A, f.PERSON_A2, [viceOf(f.SCHOOL_A)]);
/** Nobody in particular: a person id that exists in no table — reads never need the row, writes never get there. */
const OUTSIDER = "0199a000-00f9-7000-8000-0000000000cc";
const viceElsewhere = ctxOf(f.ORG_A, OUTSIDER, [viceOf(f.SCHOOL_B)]);
const nobody = ctxOf(f.ORG_A, OUTSIDER, [orgAdmin]);
const teacher = ctxOf(f.ORG_A, f.PERSON_A2, [teacherOf(f.OFFERING_A1)]);
const student = ctxOf(f.ORG_A, f.PERSON_A1, [studentRole(f.STUDENT_A1)]);
const otherOrg = ctxOf(f.ORG_B, f.PERSON_B1, [{ roleCode: "org_admin", roleId: "r-b", scopeType: "organization", scopeId: f.ORG_B, permissions: ALL }]);

const isCode = (code: string) => (err: unknown) => AppError.is(err) && err.code === code;

/** A fixed Tehran instant well inside a school day; the dates below are derived from it, never from the wall clock. */
const NOW = new Date("2026-09-22T08:35:00Z"); // سه‌شنبه ۱۴۰۵/۰۶/۳۱, 12:05 Tehran
const TODAY = tehranToday(NOW); // 2026-09-22
const YESTERDAY = addDaysIso(TODAY, -1);
const TOMORROW = addDaysIso(TODAY, 1);
const PERIOD = 2;

async function rolledBack(fn: (tx: Tx) => Promise<void>, tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 }): Promise<void> {
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

/** The fixtures carry no زنگ‌بندی, no timetable and no enrollment: build the minimum a roll call needs. */
async function setUpClass(tx: Tx): Promise<void> {
  await setSchoolPeriods(tx, admin, f.SCHOOL_A, DEFAULT_PERIODS.map((p) => ({ ...p })));
  await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
  await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
  // The درس of زنگ ۲ on both days the tests use, so the teacher's class_offering scope resolves.
  for (const iso of [TODAY, YESTERDAY]) {
    await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: weekdayOfIso(iso)!, periodNo: PERIOD, classOfferingId: f.OFFERING_A1 });
  }
}

const cell = { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo: PERIOD };

describe("takeAttendance", () => {
  it("the teacher of the زنگ's درس takes the roll call, re-taking UPDATES the same row and audits both", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const first = await takeAttendance(tx, teacher, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "present" }] }, NOW);
      expect(first.created).toBe(true);
      expect(first.counts).toEqual({ present: 1, absent: 0, late: 0, excused: 0 });

      const again = await takeAttendance(tx, teacher, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "late", minutesLate: 7 }] }, NOW);
      expect(again.created).toBe(false);
      expect(again.sessionId).toBe(first.sessionId);
      expect(again.counts).toEqual({ present: 0, absent: 0, late: 1, excused: 0 });

      const sessions = await tx.select({ id: attendanceSession.id, offeringId: attendanceSession.classOfferingId }).from(attendanceSession).where(eq(attendanceSession.classGroupId, f.CLASS_GROUP_A1));
      expect(sessions).toHaveLength(1);
      // The درس came from the weekly timetable, not from the client.
      expect(sessions[0].offeringId).toBe(f.OFFERING_A1);
      const entries = await tx
        .select({ id: attendanceEntry.id, status: attendanceEntry.status, minutesLate: attendanceEntry.minutesLate })
        .from(attendanceEntry)
        .where(eq(attendanceEntry.attendanceSessionId, first.sessionId));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ status: "late", minutesLate: 7 });

      const trail = await tx.select({ action: auditLog.action, actor: auditLog.actorPersonId }).from(auditLog).where(eq(auditLog.entityId, first.sessionId));
      expect(trail.map((t) => t.action)).toEqual(["academic.attendance_session.taken", "academic.attendance_session.retaken"]);
      expect(trail.every((t) => t.actor === f.PERSON_A2)).toBe(true);
    });
  });

  it("minutes_late survives only on «تأخیر»; a student dropped from the list loses their entry", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const taken = await takeAttendance(tx, admin, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "present", minutesLate: 15 }] }, NOW);
      const [row] = await tx.select({ minutesLate: attendanceEntry.minutesLate }).from(attendanceEntry).where(eq(attendanceEntry.attendanceSessionId, taken.sessionId));
      expect(row.minutesLate).toBeNull();

      // The daily roll call (no زنگ) is a SECOND session of the same day, not a duplicate of this one.
      const daily = await takeAttendance(tx, admin, { classGroupId: f.CLASS_GROUP_A1, date: TODAY, entries: [{ studentProfileId: f.STUDENT_A1, status: "excused" }] }, NOW);
      expect(daily.sessionId).not.toBe(taken.sessionId);
      const all = await tx.select({ id: attendanceSession.id }).from(attendanceSession).where(eq(attendanceSession.classGroupId, f.CLASS_GROUP_A1));
      expect(all).toHaveLength(2);
    });
  });

  it("scope: a teacher of another class, an admin of another school and another tenant are NOT_FOUND", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const entries = [{ studentProfileId: f.STUDENT_A1, status: "present" as const }];
      // CLASS_GROUP_A2 is a class this teacher does not teach in (and زنگ ۲ there has no درس of theirs).
      await expect(takeAttendance(tx, teacher, { classGroupId: f.CLASS_GROUP_A2, date: TODAY, periodNo: PERIOD, entries }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(takeAttendance(tx, viceElsewhere, { ...cell, entries }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      // A teacher with no زنگ at that period cannot reach the class either (no timetable cell → no offering scope).
      await expect(takeAttendance(tx, teacher, { ...cell, periodNo: 4, entries }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(getSessionForTaking(tx, viceElsewhere, cell, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
    // Another tenant: the class group is invisible under its RLS context, so the id reads as nonexistent.
    await rolledBack(
      async (tx) => {
        await expect(
          takeAttendance(tx, otherOrg, { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo: PERIOD, entries: [{ studentProfileId: f.STUDENT_A1, status: "present" }] }, NOW),
        ).rejects.toSatisfy(isCode("NOT_FOUND"));
      },
      { orgId: f.ORG_B, personId: f.PERSON_B1 },
    );
  });

  it("a future date, an unknown زنگ and someone outside the roster are VALIDATION", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const entries = [{ studentProfileId: f.STUDENT_A1, status: "present" as const }];
      await expect(takeAttendance(tx, admin, { ...cell, date: TOMORROW, entries }, NOW)).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "برای روز آینده نمی‌توان حضور و غیاب ثبت کرد.",
      );
      await expect(takeAttendance(tx, admin, { ...cell, periodNo: 9, entries }, NOW)).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "این زنگ در زنگ‌بندی مدرسه وجود ندارد.",
      );
      await expect(takeAttendance(tx, admin, { ...cell, date: "2026-02-31", entries }, NOW)).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "تاریخ نامعتبر است.",
      );
      // STUDENT_B1 is not enrolled in this class (and belongs to another tenant): not in the roster.
      await expect(takeAttendance(tx, admin, { ...cell, entries: [{ studentProfileId: f.STUDENT_B1, status: "absent" }] }, NOW)).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "برای کسی که در این کلاس ثبت‌نام فعال ندارد نمی‌توان حضور و غیاب ثبت کرد.",
      );
      await expect(
        takeAttendance(tx, admin, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "present" }, { studentProfileId: f.STUDENT_A1, status: "absent" }] }, NOW),
      ).rejects.toSatisfy((err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "برای یک دانش‌آموز دو وضعیت فرستاده شده است.");
      // An offering of ANOTHER class may not be pinned to this roll call.
      await expect(takeAttendance(tx, admin, { classGroupId: f.CLASS_GROUP_A2, date: TODAY, periodNo: PERIOD, classOfferingId: f.OFFERING_A1, entries }, NOW)).rejects.toSatisfy(
        (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === "این درس برای این کلاس تعریف نشده است.",
      );
    });
  });
});

describe("getSessionForTaking / teacherDay", () => {
  it("pre-fills the saved marks, defaults everyone else to «حاضر» and carries the day's زنگ‌ها", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const before = await getSessionForTaking(tx, teacher, cell, NOW);
      expect(before.saved).toBeNull();
      expect(before.canWrite).toBe(true);
      expect(before.offering).toEqual({ id: f.OFFERING_A1, subjectName: "ریاضی" });
      expect(before.period?.label).toBe("زنگ دوم");
      expect(before.rows.map((r) => [r.studentProfileId, r.status, r.recorded])).toEqual([[f.STUDENT_A1, "present", false]]);
      expect(before.periodsOfDay).toEqual([{ periodNo: PERIOD, label: "زنگ دوم", subjectName: "ریاضی", taken: false }]);

      await takeAttendance(tx, teacher, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "absent", note: " سرماخوردگی " }] }, NOW);
      const after = await getSessionForTaking(tx, teacher, cell, NOW);
      expect(after.saved?.takenByName).toBe("زهرا کریمی");
      expect(after.rows[0]).toMatchObject({ status: "absent", recorded: true, note: "سرماخوردگی" });
      expect(after.periodsOfDay[0].taken).toBe(true);

      // Next week's same زنگ may be looked at, never written (the future is read-only).
      const future = await getSessionForTaking(tx, teacher, { ...cell, date: addDaysIso(TODAY, 7) }, NOW);
      expect(future.canWrite).toBe(false);
      expect(future.saved).toBeNull();
    });
  });

  it("the teacher's day lists their own زنگ‌ها with the «ثبت‌شده» mark", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const day = await teacherDay(tx, teacher, NOW);
      expect(day.date).toBe(TODAY);
      expect(day.cells).toHaveLength(1);
      expect(day.cells[0]).toMatchObject({ classGroupId: f.CLASS_GROUP_A1, periodNo: PERIOD, subjectName: "ریاضی", taken: false, absent: 0 });
      await takeAttendance(tx, teacher, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "absent" }] }, NOW);
      const after = await teacherDay(tx, teacher, NOW);
      expect(after.cells[0]).toMatchObject({ taken: true, absent: 1 });
      // A person who teaches nothing has an empty day.
      expect((await teacherDay(tx, nobody, NOW)).cells).toEqual([]);
    });
  });
});

describe("studentAttendanceSummary", () => {
  it("a student reads their OWN marks; another student's profile is NOT_FOUND; staff of the class may read", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await takeAttendance(tx, teacher, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "absent" }] }, NOW);
      await takeAttendance(tx, teacher, { ...cell, date: YESTERDAY, entries: [{ studentProfileId: f.STUDENT_A1, status: "late", minutesLate: 5 }] }, NOW);

      const mine = await studentAttendanceSummary(tx, student, { studentProfileId: f.STUDENT_A1, from: addDaysIso(TODAY, -7), to: TODAY });
      expect(mine.counts).toEqual({ present: 0, absent: 1, late: 1, excused: 0 });
      expect(mine.className).toBe("اول 1");
      expect(mine.recent.map((r) => [r.date, r.status, r.subjectName])).toEqual([
        [TODAY, "absent", "ریاضی"],
        [YESTERDAY, "late", "ریاضی"],
      ]);

      // Another student's profile (org B's) — not mine, no scope over them.
      await expect(studentAttendanceSummary(tx, student, { studentProfileId: f.STUDENT_B1, from: YESTERDAY, to: TODAY })).rejects.toSatisfy(isCode("NOT_FOUND"));
      // The vice principal of the school and the teacher of the class may read the same student.
      expect((await studentAttendanceSummary(tx, vice, { studentProfileId: f.STUDENT_A1, from: YESTERDAY, to: TODAY })).counts.absent).toBe(1);
      expect((await studentAttendanceSummary(tx, teacher, { studentProfileId: f.STUDENT_A1, from: YESTERDAY, to: TODAY })).counts.late).toBe(1);
      await expect(studentAttendanceSummary(tx, viceElsewhere, { studentProfileId: f.STUDENT_A1, from: YESTERDAY, to: TODAY })).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });
});

describe("classAttendanceReport", () => {
  it("totals per student and per day are the sum of the marks; an out-of-scope class is NOT_FOUND", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await takeAttendance(tx, teacher, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "absent" }] }, NOW);
      await takeAttendance(tx, teacher, { ...cell, date: YESTERDAY, entries: [{ studentProfileId: f.STUDENT_A1, status: "present" }] }, NOW);

      const report = await classAttendanceReport(tx, vice, { classGroupId: f.CLASS_GROUP_A1, from: addDaysIso(TODAY, -30), to: TODAY });
      expect(report.totals).toEqual({ present: 1, absent: 1, late: 0, excused: 0 });
      expect(report.sessions).toBe(2);
      expect(report.students).toHaveLength(1);
      expect(report.students[0]).toMatchObject({ studentProfileId: f.STUDENT_A1, total: 2, absencePercent: 50 });
      expect(report.days.map((d) => [d.date, d.total])).toEqual([
        [TODAY, 1],
        [YESTERDAY, 1],
      ]);
      // The teacher of a درس of the class reads it too; an admin of another school does not.
      expect((await classAttendanceReport(tx, teacher, { classGroupId: f.CLASS_GROUP_A1, from: YESTERDAY, to: TODAY })).sessions).toBe(2);
      await expect(classAttendanceReport(tx, viceElsewhere, { classGroupId: f.CLASS_GROUP_A1, from: YESTERDAY, to: TODAY })).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(classAttendanceReport(tx, vice, { classGroupId: f.CLASS_GROUP_A1, from: TODAY, to: YESTERDAY })).rejects.toSatisfy(isCode("VALIDATION"));
    });
  });
});

describe("RLS", () => {
  it("an attendance row tagged with another tenant is rejected, and nothing of A is visible under B", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_B]);
        await expect(
          c.query(
            `insert into academic.attendance_session (id, organization_id, class_group_id, date, taken_by_person_id)
             values (app.uuid_generate_v7(), $1, $2, current_date, $3)`,
            [f.ORG_A, f.CLASS_GROUP_A1, f.PERSON_A2],
          ),
        ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.INSUFFICIENT_PRIVILEGE || pgCode(err) === PG.FOREIGN_KEY_VIOLATION);
      });
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        const rows = await c.query<{ n: number }>("select count(*)::int as n from academic.attendance_session where class_group_id = $1", [f.CLASS_GROUP_B1]);
        expect(rows.rows[0].n).toBe(0);
      });
    });
  });

  it("both attendance tables are under FORCE RLS with a tenant_isolation policy", async () => {
    await asAppRw(async (c) => {
      const res = await c.query<{ relname: string; enabled: boolean; forced: boolean; policies: number }>(
        `select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                (select count(*)::int from pg_policies p where p.schemaname = 'academic' and p.tablename = c.relname) as policies
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'academic' and c.relname in ('attendance_session', 'attendance_entry')
          order by c.relname`,
      );
      expect(res.rows).toHaveLength(2);
      for (const r of res.rows) {
        expect(r.enabled).toBe(true);
        expect(r.forced).toBe(true);
        expect(r.policies).toBeGreaterThan(0);
      }
    });
  });
});

describe("audit", () => {
  it("the roll call and its trail commit together (one audit row per save, on the session)", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const taken = await takeAttendance(tx, admin, { ...cell, entries: [{ studentProfileId: f.STUDENT_A1, status: "present" }] }, NOW);
      const rows = await tx
        .select({ action: auditLog.action, table: auditLog.entityTable })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, taken.sessionId), eq(auditLog.entityTable, "attendance_session")));
      expect(rows).toEqual([{ action: "academic.attendance_session.taken", table: "attendance_session" }]);
    });
  });
});
