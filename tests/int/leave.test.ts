// «مرخصی و خروج مجاز» (owner, 2026-10-20; migration 0029; src/modules/iam/guardian-leave.ts, src/modules/academic/leave.ts,
// src/modules/academic/leave-coverage.ts). Both layers are tested: the services (requireChild for a guardian, the
// permission AT THE SCHOOL for a manager, NOT_FOUND everywhere else) and the database — 0029's CHECKs, the partial
// unique index and its RESTRICTIVE policies bind per `app.current_person_id()`, so every call runs as its actor (`as`:
// what withTenant binds for a request of theirs, switched inside the one test transaction):
//   • 0029: academic.leave_request / academic.early_exit under tenant RLS (ENABLE + FORCE) plus a no-DELETE and an
//     own-name INSERT policy; the CHECKs (14 days, one-day partial, categories, decision / cancel pairs, notes) and one
//     active exit per student per day;
//   • a guardian requests only for their OWN live child — another child, another guardian, the student, a manager, a
//     teacher and the organization admin are NOT_FOUND; the date rules, the overlap rule and the pending limit;
//   • the managers of the child's school hear of it (title only); the manager of ANOTHER school and a teacher decide
//     nothing (NOT_FOUND); the decision tells the guardians; a guardian cancels only their own pending request;
//   • an APPROVED leave pre-marks the roster «موجه» with its tag (a partial day only its زنگ‌ها, a pending one nothing) and
//     the guardians get no «غیبت» for a covered child — others still do;
//   • «خروج مجاز» pre-marks the later زنگ‌ها of the day, notifies the guardians, is a manager's (school) write only, one
//     per student per day, cancellable;
//   • the audit trail and every bell carry ids, dates, categories and lengths — never a note's text.
// The catalog is seeded in beforeAll; every write runs inside a withTenant transaction that ends with Rollback;
// afterAll re-creates the fixture database (later files assert exact fixture counts).
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, leaveRequest, notification } from "@/db/schema";
import { addDaysIso, tehranToday, weekdayOfIso } from "@/lib/attendance";
import { AppError } from "@/lib/errors";
import { LEAVE_MESSAGES } from "@/lib/leave";
import { DEFAULT_PERIODS } from "@/lib/timetable";
import { getSessionForTaking, takeAttendance } from "@/modules/academic/attendance";
import { cancelEarlyExit, decideLeave, listLeaveQueue, listTodaysEarlyExits, pendingLeaveCount, recordEarlyExit } from "@/modules/academic/leave";
import { assignTeacher, setTimetableSlot } from "@/modules/academic/service";
import { holdsAtSchool, type Assignment } from "@/modules/iam/can";
import { addGuardian, unlinkGuardian } from "@/modules/iam/guardian";
import { cancelLeave, childLeavePage, requestLeave } from "@/modules/iam/guardian-leave";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { listValidAssignments } from "@/modules/iam/repo";
import { assignRole, createStaff, createStudent } from "@/modules/iam/service";
import { createAcademicYear, createClassGroup, createSchool, setSchoolPeriods } from "@/modules/tenancy/service";
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
  requestId: "int-leave",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const phone = (n: number) => `0912753${String(n).padStart(4, "0")}`;

/** A fixed Tehran instant inside a school day (سه‌شنبه): every date below derives from it, never from the wall clock. */
const NOW = new Date("2026-09-22T08:35:00Z"); // 12:05 Tehran
const TODAY = tehranToday(NOW);
const TOMORROW = addDaysIso(TODAY, 1);
const YESTERDAY = addDaysIso(TODAY, -1);

/** Texts that must never reach an audit row or a bell. */
const SECRET_NOTE = "یادداشت-محرمانهٔ-ولی-۴۴۱";
const SECRET_DECISION = "توضیح-محرمانهٔ-مدرسه-۵۵۲";
const SECRET_EXIT_NOTE = "یادداشت-خروج-۶۶۳";
const SECRET_PICKUP = "تحویل‌گیرنده-۷۷۴";

const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
/** A savepoint, so a failing statement never poisons the test's transaction. */
const sub = <T>(tx: Tx, fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));

/** Binds `app.current_person_id` to `who` (what withTenant does for a request of theirs), then runs `fn`. */
async function as<T>(tx: Tx, who: { personId: string }, fn: (t: Tx) => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.current_person_id', ${who.personId}, true)`);
  return fn(tx);
}

async function actor(tx: Tx, personId: string): Promise<Actor> {
  return { orgId: f.ORG_A, personId, userId: null, requestId: "int-leave", assignments: await listValidAssignments(tx, personId) };
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
  principalB: Actor;
  /** ریاضی of class A1 — teaches زنگ ۲ and ۴ of TODAY. */
  teacher: Actor;
  /** Class A1 — g1's child. */
  s1: Student;
  /** Class A1 — g2's child. */
  s2: Student;
  /** School B — gB's child. */
  sB: Student;
  /** A student's own session (the child itself). */
  studentS1: Actor;
  g1: Actor;
  g1Link: string;
  g2: Actor;
  gB: Actor;
  classGroupA1: string;
}

/**
 * School A (the fixture school) with the default زنگ‌بندی, a principal, a vice principal and the ریاضی teacher of A1 who
 * teaches زنگ ۲ and ۴ of TODAY; two students of A1 (s1, s2) each with their own guardian. School B of the same
 * organization: a principal and one student with a guardian.
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
  await setSchoolPeriods(tx, admin, f.SCHOOL_A, DEFAULT_PERIODS.map((p) => ({ ...p })));

  type Office = "school_principal" | "vice_principal";
  const staff = (firstName: string, lastName: string, n: number, roles: Array<{ roleCode: Office; schoolId: string }> = [], schoolId?: string) =>
    createStaff(tx, admin, { firstName, lastName, phone: phone(n), createAccount: false, roles, schoolId });
  const pA = await staff("مریم", "رضایی", 2, [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }]);
  const vA = await staff("سارا", "کاظمی", 3, [{ roleCode: "vice_principal", schoolId: f.SCHOOL_A }]);
  const pB = await staff("زهرا", "موسوی", 4, [{ roleCode: "school_principal", schoolId: schoolB.schoolId }]);
  const tMath = await staff("علی", "حسینی", 5, [], f.SCHOOL_A);
  await assignTeacher(tx, admin, { staffProfileId: tMath.staffProfileId, classOfferingId: f.OFFERING_A1 });
  for (const periodNo of [2, 4]) {
    await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: weekdayOfIso(TODAY)!, periodNo, classOfferingId: f.OFFERING_A1 });
  }

  const student = async (firstName: string, lastName: string, number: string, classGroupId: string, guardianPhone: string): Promise<Student> => {
    const res = await createStudent(tx, admin, { firstName, lastName, studentNumber: number, guardianPhone, enrollment: { classGroupId } });
    return { studentProfileId: res.studentProfileId, personId: res.personId, name: `${firstName} ${lastName}` };
  };
  const s1 = await student("لیلا", "نیک‌خواه", "L-1", f.CLASS_GROUP_A1, phone(21));
  const s2 = await student("نگار", "رستمی", "L-2", f.CLASS_GROUP_A1, phone(22));
  const sB = await student("رها", "شریفی", "L-3", cgB.classGroupId, phone(23));
  const add = (s: Student, p: string, first: string, last: string) => addGuardian(tx, admin, { studentProfileId: s.studentProfileId, firstName: first, lastName: last, phone: p, relation: "mother" });
  const l1 = await add(s1, phone(21), "زهره", "نیک‌خواه");
  const l2 = await add(s2, phone(22), "شیرین", "رستمی");
  const lB = await add(sB, phone(23), "فرشته", "شریفی");

  return {
    admin,
    principalA: await actor(tx, pA.personId),
    viceA: await actor(tx, vA.personId),
    principalB: await actor(tx, pB.personId),
    teacher: await actor(tx, tMath.personId),
    s1,
    s2,
    sB,
    studentS1: await actor(tx, s1.personId),
    g1: await actor(tx, l1.guardianPersonId),
    g1Link: l1.linkId,
    g2: await actor(tx, l2.guardianPersonId),
    gB: await actor(tx, lB.guardianPersonId),
    classGroupA1: f.CLASS_GROUP_A1,
  };
}

type Who = { personId: string };
const ask = (tx: Tx, w: World, who: Actor, s: Student, over: Partial<Parameters<typeof requestLeave>[2]> = {}) =>
  as(tx, who, (t) => requestLeave(t, who, { child: s.studentProfileId, fromDate: TODAY, toDate: TODAY, category: "illness", ...over }, NOW));
const decide = (tx: Tx, who: Actor, id: string, decision: "approved" | "rejected", note: string | null = null) => as(tx, who, (t) => decideLeave(t, who, { id, decision, note }, NOW));
const exitFor = (tx: Tx, who: Actor, s: Student, over: Partial<Parameters<typeof recordEarlyExit>[2]> = {}) =>
  as(tx, who, (t) => recordEarlyExit(t, who, { studentProfileId: s.studentProfileId, category: "illness", time: "10:30", ...over }, NOW));
const roster = (tx: Tx, who: Actor, periodNo: number | null) => as(tx, who, (t) => getSessionForTaking(t, who, { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo }, NOW));

const bells = (tx: Tx, who: Who, typeCode: string) =>
  tx
    .select({ title: notification.title, body: notification.body, link: notification.deepLink, payload: notification.payload })
    .from(notification)
    .where(and(eq(notification.recipientPersonId, who.personId), eq(notification.typeCode, typeCode)));

/** Every audit row's JSON, so a leaked note would show up in a plain substring check. */
async function auditText(tx: Tx): Promise<string> {
  const rows = await tx.select({ action: auditLog.action, before: auditLog.before, after: auditLog.after }).from(auditLog).where(sql`${auditLog.action} like 'academic.leave_request.%' or ${auditLog.action} like 'academic.early_exit.%'`);
  return JSON.stringify(rows);
}

describe("«مرخصی و خروج مجاز» — leave requests and authorized early exits", () => {
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

  it("migration 0029: both tables are tenant-isolated (ENABLE + FORCE) with a no-DELETE and an own-name INSERT RESTRICTIVE policy; no REVOKE was needed", async () => {
    await asAppRw(async (c) => {
      const rls = await c.query<{ t: string; enabled: boolean; forced: boolean }>(
        `select c.relname as t, c.relrowsecurity as enabled, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'academic' and c.relname in ('early_exit', 'leave_request') order by 1`,
      );
      expect(rls.rows).toEqual([
        { t: "early_exit", enabled: true, forced: true },
        { t: "leave_request", enabled: true, forced: true },
      ]);
      for (const t of ["leave_request", "early_exit"]) {
        const policies = await c.query<{ policyname: string; cmd: string; permissive: string; roles: string[] }>(
          `select policyname, cmd, permissive, roles::text[] as roles from pg_policies where schemaname = 'academic' and tablename = $1 order by policyname`,
          [t],
        );
        expect(policies.rows, t).toEqual([
          { policyname: `${t}_insert`, cmd: "INSERT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
          { policyname: `${t}_no_delete`, cmd: "DELETE", permissive: "RESTRICTIVE", roles: ["app_rw"] },
          { policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["public"] },
        ]);
      }
      // app.apply_grants() was NOT redefined: the default grants are still there (the policy, not a REVOKE, blocks DELETE) and
      // the earlier REVOKEs of 0020 / 0022 survived.
      const priv = await c.query<{ d: boolean; g: boolean; m: boolean }>(
        `select has_table_privilege('app_rw', 'academic.leave_request', 'DELETE') as d, has_table_privilege('app_rw', 'iam.guardian_link', 'DELETE') as g,
                has_table_privilege('app_rw', 'workspace.guardian_message', 'UPDATE') as m`,
      );
      expect(priv.rows[0]).toEqual({ d: true, g: false, m: false });
    });
  });

  it("the database repeats the bounds: 14 days, a partial day on one date, the five reasons, the decision and cancel pairs, one active exit per student per day, no DELETE, no INSERT in another's name", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const row = {
        organizationId: f.ORG_A,
        schoolId: f.SCHOOL_A,
        studentProfileId: w.s1.studentProfileId,
        requestedByPersonId: w.g1.personId,
        fromDate: TODAY,
        toDate: TODAY,
        category: "illness",
      };
      const insert = (over: Record<string, unknown>) => as(tx, w.g1, (t) => sub(t, async (sp) => { await sp.insert(leaveRequest).values({ ...row, ...over }); }));
      await insert({});
      await insert({ fromDate: addDaysIso(TODAY, 3), toDate: addDaysIso(TODAY, 16) }); // exactly 14 days
      const fails = async (over: Record<string, unknown>) => expect(await insert(over).then(() => undefined, (e) => pgCode(e)), JSON.stringify(over)).toBe(PG.CHECK_VIOLATION);
      await fails({ fromDate: addDaysIso(TODAY, 20), toDate: addDaysIso(TODAY, 34) }); // 15 days
      await fails({ fromDate: TOMORROW, toDate: TODAY }); // reversed
      await fails({ fromDate: addDaysIso(TODAY, 40), toDate: addDaysIso(TODAY, 41), fromPeriod: 1, toPeriod: 2 }); // a partial day over two dates
      await fails({ fromDate: addDaysIso(TODAY, 40), toDate: addDaysIso(TODAY, 40), fromPeriod: 3, toPeriod: 2 }); // periods reversed
      await fails({ fromDate: addDaysIso(TODAY, 40), toDate: addDaysIso(TODAY, 40), fromPeriod: 3 }); // one period alone
      await fails({ fromDate: addDaysIso(TODAY, 40), toDate: addDaysIso(TODAY, 40), fromPeriod: 0, toPeriod: 2 });
      await fails({ category: "vacation" });
      await fails({ status: "approved" }); // approved without who and when
      await fails({ note: "" });
      await fails({ note: "x".repeat(301) });
      await fails({ decisionNote: "no decision yet" });
      // …and a valid partial day on one date is accepted.
      await insert({ fromDate: addDaysIso(TODAY, 40), toDate: addDaysIso(TODAY, 40), fromPeriod: 2, toPeriod: 3 });

      // Another person's name: refused by the RESTRICTIVE insert policy (the current person is the guardian g2, the row says g1).
      const stolen = await as(tx, w.g2, (t) => sub(t, async (sp) => { await sp.insert(leaveRequest).values({ ...row, fromDate: addDaysIso(TODAY, 60), toDate: addDaysIso(TODAY, 60) }); })).then(() => undefined, (e) => pgCode(e));
      expect(stolen).toBe(PG.INSUFFICIENT_PRIVILEGE);

      // No DELETE: the RESTRICTIVE policy leaves the rows where they are, for the guardian and the principal alike.
      for (const who of [w.g1, w.principalA]) {
        const gone = await as(tx, who, (t) => t.execute<{ id: string }>(sql`delete from academic.leave_request returning id`));
        expect(gone.rows, who.personId).toEqual([]);
      }
      const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from academic.leave_request`);
      expect(Number(left.rows[0].n)).toBe(3);

      // The early exit: one ACTIVE row per student per day; a cancelled one frees the slot; the pairs are CHECKed; no DELETE.
      const exitRow = { organizationId: f.ORG_A, schoolId: f.SCHOOL_A, studentProfileId: w.s1.studentProfileId, date: TODAY, exitTime: "10:30", category: "illness", recordedByPersonId: w.principalA.personId };
      const { earlyExit } = schema;
      const addExit = (over: Record<string, unknown>, who: Actor = w.principalA) => as(tx, who, (t) => sub(t, async (sp) => { await sp.insert(earlyExit).values({ ...exitRow, ...over }); }));
      await addExit({});
      expect(await addExit({ exitTime: "11:00" }).then(() => undefined, (e) => pgCode(e))).toBe("23505");
      expect(await addExit({ studentProfileId: w.s2.studentProfileId, category: "travel" }).then(() => undefined, (e) => pgCode(e))).toBe(PG.CHECK_VIOLATION);
      expect(await addExit({ studentProfileId: w.s2.studentProfileId, pickedUpBy: "x".repeat(61) }).then(() => undefined, (e) => pgCode(e))).toBe(PG.CHECK_VIOLATION);
      expect(await addExit({ studentProfileId: w.s2.studentProfileId, status: "cancelled" }).then(() => undefined, (e) => pgCode(e))).toBe(PG.CHECK_VIOLATION);
      expect(await addExit({ studentProfileId: w.s2.studentProfileId }, w.viceA).then(() => undefined, (e) => pgCode(e))).toBe(PG.INSUFFICIENT_PRIVILEGE);
      const noDelete = await as(tx, w.principalA, (t) => t.execute<{ id: string }>(sql`delete from academic.early_exit returning id`));
      expect(noDelete.rows).toEqual([]);
    });
  });

  it("a guardian requests only for their OWN live child; the student, a manager, a teacher, another family's guardian and a stranger's child are all NOT_FOUND", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const ok = await ask(tx, w, w.g1, w.s1, { note: SECRET_NOTE });
      expect(ok.id).toMatch(/^[0-9a-f-]{36}$/);
      const [row] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, ok.id));
      // Everything but the dates and the reason came from the session and the database.
      expect(row).toMatchObject({ schoolId: f.SCHOOL_A, studentProfileId: w.s1.studentProfileId, requestedByPersonId: w.g1.personId, status: "pending", category: "illness", note: SECRET_NOTE, decidedByPersonId: null });

      const notFound = isError("NOT_FOUND");
      // Another family's guardian, and a guardian asking for a child that is not theirs (school B included).
      await expect(ask(tx, w, w.g2, w.s1)).rejects.toSatisfy(notFound);
      await expect(ask(tx, w, w.g1, w.s2)).rejects.toSatisfy(notFound);
      await expect(ask(tx, w, w.g1, w.sB)).rejects.toSatisfy(notFound);
      await expect(ask(tx, w, w.gB, w.s1)).rejects.toSatisfy(notFound);
      // Nobody but a live guardian: the child's own session, both managers, the organization admin, the teacher.
      for (const who of [w.studentS1, w.principalA, w.viceA, w.principalB, w.admin, w.teacher]) {
        await expect(ask(tx, w, who, w.s1), who.personId).rejects.toSatisfy(notFound);
      }
      // …nor may they read the guardian's page of the child.
      for (const who of [w.g2, w.studentS1, w.principalA, w.teacher]) {
        await expect(as(tx, who, (t) => childLeavePage(t, who, w.s1.studentProfileId, NOW)), who.personId).rejects.toSatisfy(notFound);
      }
      // A forged `?child=` of a stranger's child never falls back to the caller's own.
      await expect(as(tx, w.g1, (t) => childLeavePage(t, w.g1, w.sB.studentProfileId, NOW))).rejects.toSatisfy(notFound);
      const page = await as(tx, w.g1, (t) => childLeavePage(t, w.g1, w.s1.studentProfileId, NOW));
      expect(page.requests).toHaveLength(1);
      expect(page.requests[0]).toMatchObject({ id: ok.id, status: "pending", mine: true });
      expect(page.periods.map((p) => p.periodNo)).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  it("the date rules: never before today (Tehran), at most 14 days, a partial day on one date within the school's زنگ‌ها, no overlap, at most five waiting", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const invalid = (message: string) => isError("VALIDATION", message);
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: YESTERDAY, toDate: TODAY })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.pastDate));
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: addDaysIso(TODAY, 14) })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.tooLong));
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: TOMORROW, toDate: TODAY })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.badRange));
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TOMORROW, fromPeriod: 1, toPeriod: 2 })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.periodsOneDay));
      await expect(ask(tx, w, w.g1, w.s1, { fromPeriod: 2 })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.periodsPair));
      // Period 9 is a valid number but not in this school's bell schedule.
      await expect(ask(tx, w, w.g1, w.s1, { fromPeriod: 8, toPeriod: 9 })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.periodUnknown));

      // Exactly 14 days is fine; a second request meeting it overlaps; a partial day beside a partial day does not.
      const long = await ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 10), toDate: addDaysIso(TODAY, 23) });
      expect(long.id).toBeTruthy();
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 23), toDate: addDaysIso(TODAY, 24) })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.overlap));
      await ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TODAY, fromPeriod: 1, toPeriod: 2 });
      await ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TODAY, fromPeriod: 3, toPeriod: 4 });
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TODAY, fromPeriod: 4, toPeriod: 5 })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.overlap));
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TODAY })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.overlap));
      // A cancelled request frees its dates.
      const [pendingRow] = await tx.select({ id: leaveRequest.id }).from(leaveRequest).where(and(eq(leaveRequest.fromPeriod, 1), eq(leaveRequest.studentProfileId, w.s1.studentProfileId)));
      await as(tx, w.g1, (t) => cancelLeave(t, w.g1, { id: pendingRow.id }));
      await ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TODAY, fromPeriod: 1, toPeriod: 2 });

      // Five waiting at once is the limit.
      await ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 30), toDate: addDaysIso(TODAY, 30) });
      await ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 32), toDate: addDaysIso(TODAY, 32) });
      await expect(ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 34), toDate: addDaysIso(TODAY, 34) })).rejects.toSatisfy(invalid(LEAVE_MESSAGES.tooManyPending));
    });
  });

  it("the school's managers hear of a request (title only); another school's manager and a teacher decide nothing; the decision tells the guardian; a guardian cancels only their own pending request", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const req = await ask(tx, w, w.g1, w.s1, { note: SECRET_NOTE });
      expect(req.notified).toBe(2);

      // Principal and vice principal of school A: one bell each, the child's name and the kind — no reason, no note, no date.
      for (const who of [w.principalA, w.viceA]) {
        const mine = await bells(tx, who, "academic.leave_requested");
        expect(mine, who.personId).toHaveLength(1);
        expect(mine[0]).toMatchObject({ title: `درخواست مرخصی: ${w.s1.name}`, body: null, link: `/admin/leave?school=${f.SCHOOL_A}` });
        expect(JSON.stringify(mine)).not.toContain(SECRET_NOTE);
      }
      expect(await bells(tx, w.principalB, "academic.leave_requested")).toEqual([]);
      expect(await bells(tx, w.g1, "academic.leave_requested")).toEqual([]);

      // The queue: school A's managers see it; school B's principal sees nothing of it, and its school filter is NOT_FOUND.
      const queue = await as(tx, w.principalA, (t) => listLeaveQueue(t, w.principalA, {}, NOW));
      expect(queue.pending.map((r) => r.id)).toEqual([req.id]);
      expect(queue.pending[0]).toMatchObject({ studentName: w.s1.name, schoolId: f.SCHOOL_A, note: SECRET_NOTE, status: "pending" });
      expect((await as(tx, w.viceA, (t) => listLeaveQueue(t, w.viceA, { schoolId: f.SCHOOL_A }, NOW))).pending).toHaveLength(1);
      expect((await as(tx, w.principalB, (t) => listLeaveQueue(t, w.principalB, {}, NOW))).pending).toEqual([]);
      await expect(as(tx, w.principalB, (t) => listLeaveQueue(t, w.principalB, { schoolId: f.SCHOOL_A }, NOW))).rejects.toSatisfy(isError("NOT_FOUND"));
      expect(await as(tx, w.principalA, (t) => pendingLeaveCount(t, w.principalA))).toBe(1);
      expect(await as(tx, w.principalB, (t) => pendingLeaveCount(t, w.principalB))).toBe(0);
      // A teacher holds no queue at all; a guardian neither.
      expect(await as(tx, w.teacher, (t) => pendingLeaveCount(t, w.teacher))).toBe(0);
      await expect(as(tx, w.teacher, (t) => listLeaveQueue(t, w.teacher, {}, NOW))).rejects.toSatisfy(isError("FORBIDDEN"));
      await expect(as(tx, w.g1, (t) => listLeaveQueue(t, w.g1, {}, NOW))).rejects.toSatisfy(isError("FORBIDDEN"));

      // Nobody outside school A's management decides it.
      for (const who of [w.principalB, w.teacher, w.g1, w.g2, w.studentS1]) {
        await expect(decide(tx, who, req.id, "approved"), who.personId).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      const [still] = await tx.select({ status: leaveRequest.status }).from(leaveRequest).where(eq(leaveRequest.id, req.id));
      expect(still.status).toBe("pending");

      // The vice principal approves: the guardian hears «مرخصی تأیید شد» — the name only; the second decision is refused.
      const done = await decide(tx, w.viceA, req.id, "approved", SECRET_DECISION);
      expect(done).toMatchObject({ status: "approved", notified: 1 });
      const heard = await bells(tx, w.g1, "guardian.leave_decided");
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ title: `مرخصی تأیید شد: ${w.s1.name}`, body: null, link: `/child/leave?child=${w.s1.studentProfileId}`, payload: { studentProfileId: w.s1.studentProfileId } });
      expect(JSON.stringify(heard)).not.toContain(SECRET_DECISION);
      await expect(decide(tx, w.principalA, req.id, "rejected")).rejects.toSatisfy(isError("VALIDATION", LEAVE_MESSAGES.notPending));
      const [after] = await tx.select({ status: leaveRequest.status, by: leaveRequest.decidedByPersonId, at: leaveRequest.decidedAt, note: leaveRequest.decisionNote }).from(leaveRequest).where(eq(leaveRequest.id, req.id));
      expect(after).toMatchObject({ status: "approved", by: w.viceA.personId, note: SECRET_DECISION });
      expect(after.at).toBeInstanceOf(Date);
      // The guardian reads the decision note; the other family does not even reach the page.
      const page = await as(tx, w.g1, (t) => childLeavePage(t, w.g1, w.s1.studentProfileId, NOW));
      expect(page.requests[0]).toMatchObject({ status: "approved", decisionNote: SECRET_DECISION });
      // An approved request can no longer be cancelled.
      await expect(as(tx, w.g1, (t) => cancelLeave(t, w.g1, { id: req.id }))).rejects.toSatisfy(isError("VALIDATION", LEAVE_MESSAGES.notPending));

      // A rejection tells the guardian too; the guardian of another family cancels nothing of theirs.
      const second = await ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 5), toDate: addDaysIso(TODAY, 5) });
      await expect(as(tx, w.g2, (t) => cancelLeave(t, w.g2, { id: second.id }))).rejects.toSatisfy(isError("NOT_FOUND"));
      await decide(tx, w.principalA, second.id, "rejected");
      expect((await bells(tx, w.g1, "guardian.leave_decided")).map((b) => b.title).sort()).toEqual([`مرخصی تأیید شد: ${w.s1.name}`, `مرخصی رد شد: ${w.s1.name}`].sort());
      // …and one the guardian cancels while pending is gone from the queue.
      const third = await ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 8), toDate: addDaysIso(TODAY, 8) });
      await as(tx, w.g1, (t) => cancelLeave(t, w.g1, { id: third.id }));
      expect((await as(tx, w.principalA, (t) => listLeaveQueue(t, w.principalA, {}, NOW))).pending).toEqual([]);
      await expect(decide(tx, w.principalA, third.id, "approved")).rejects.toSatisfy(isError("VALIDATION", LEAVE_MESSAGES.notPending));

      // The trail: ids, dates, categories and lengths — never a note's text.
      const trail = await auditText(tx);
      expect(trail).toContain("academic.leave_request.requested");
      expect(trail).toContain("academic.leave_request.approved");
      expect(trail).toContain("academic.leave_request.rejected");
      expect(trail).toContain("academic.leave_request.cancelled");
      expect(trail).toContain(`"noteLength":${SECRET_NOTE.length}`);
      expect(trail).not.toContain(SECRET_NOTE);
      expect(trail).not.toContain(SECRET_DECISION);
    });
  });

  it("an APPROVED leave pre-marks the roster «موجه» with its tag — still editable; a pending one, a partial day outside its زنگ‌ها and another child change nothing — and the covered child's guardian gets no «غیبت»", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const row = (r: Awaited<ReturnType<typeof roster>>, s: Student) => r.rows.find((x) => x.studentProfileId === s.studentProfileId)!;

      // Nothing yet: everybody opens «حاضر».
      let sheet = await roster(tx, w.teacher, 2);
      expect(row(sheet, w.s1)).toMatchObject({ status: "present", coverage: null, recorded: false });

      // A PENDING request changes nothing.
      const req = await ask(tx, w, w.g1, w.s1, { fromDate: TODAY, toDate: TOMORROW, note: SECRET_NOTE });
      sheet = await roster(tx, w.teacher, 2);
      expect(row(sheet, w.s1)).toMatchObject({ status: "present", coverage: null });

      // Approved: the roster of a زنگ AND the daily one open «موجه» + «مرخصی»; the other child is untouched.
      await decide(tx, w.principalA, req.id, "approved");
      for (const periodNo of [2, 4, null]) {
        sheet = await roster(tx, periodNo === null ? w.principalA : w.teacher, periodNo);
        expect(row(sheet, w.s1), String(periodNo)).toMatchObject({ status: "excused", coverage: "leave", recorded: false });
        expect(row(sheet, w.s2), String(periodNo)).toMatchObject({ status: "present", coverage: null });
      }
      // A teacher sees the tag — nothing of the reason is in what the roster carries.
      expect(JSON.stringify(sheet)).not.toContain(SECRET_NOTE);
      // The day after the leave is not covered; neither is the day before (the roster of YESTERDAY is read for it).
      const later = await as(tx, w.principalA, (t) => getSessionForTaking(t, w.principalA, { classGroupId: f.CLASS_GROUP_A1, date: addDaysIso(TODAY, 2), periodNo: null }, NOW));
      expect(row(later, w.s1)).toMatchObject({ status: "present", coverage: null });

      // Saving the roster keeps the pre-mark (it is just the page's default); the teacher may still override it.
      const taken = await as(tx, w.teacher, (t) =>
        takeAttendance(t, w.teacher, { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo: 2, entries: [{ studentProfileId: w.s1.studentProfileId, status: "excused" }, { studentProfileId: w.s2.studentProfileId, status: "absent" }] }, NOW),
      );
      expect(taken.counts).toEqual({ present: 0, absent: 1, late: 0, excused: 1 });
      sheet = await roster(tx, w.teacher, 2);
      expect(row(sheet, w.s1)).toMatchObject({ status: "excused", coverage: "leave", recorded: true });
      // The uncovered child's guardian is told of the absence; the covered one hears nothing — not even when the teacher marks them absent.
      expect(await bells(tx, w.g2, "guardian.child_absent")).toHaveLength(1);
      expect(await bells(tx, w.g1, "guardian.child_absent")).toEqual([]);
      await as(tx, w.teacher, (t) =>
        takeAttendance(t, w.teacher, { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo: 4, entries: [{ studentProfileId: w.s1.studentProfileId, status: "absent" }, { studentProfileId: w.s2.studentProfileId, status: "absent" }] }, NOW),
      );
      expect(await bells(tx, w.g1, "guardian.child_absent")).toEqual([]);
      expect(await bells(tx, w.g2, "guardian.child_absent")).toHaveLength(2);

      // A partial day covers exactly its زنگ‌ها: s2 on زنگ ۴ only.
      const part = await ask(tx, w, w.g2, w.s2, { fromDate: TODAY, toDate: TODAY, fromPeriod: 4, toPeriod: 5 });
      await decide(tx, w.viceA, part.id, "approved");
      expect(row(await roster(tx, w.teacher, 2), w.s2)).toMatchObject({ coverage: null, recorded: true });
      expect(row(await roster(tx, w.teacher, 4), w.s2)).toMatchObject({ coverage: "leave" });
      expect(row(await roster(tx, w.principalA, null), w.s2)).toMatchObject({ coverage: null });
    });
  });

  it("«خروج مجاز»: a school manager records it, the later زنگ‌ها of the day open «موجه» tagged «خروج مجاز», the guardian is told (the name only); a teacher, the other school's principal and a guardian cannot; one per student per day; cancellable", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const row = (r: Awaited<ReturnType<typeof roster>>, s: Student) => r.rows.find((x) => x.studentProfileId === s.studentProfileId)!;
      const notFound = isError("NOT_FOUND");

      // Who may: only the managers of the student's school. NOT_FOUND for everyone else.
      for (const who of [w.teacher, w.principalB, w.g1, w.studentS1]) {
        await expect(exitFor(tx, who, w.s1), who.personId).rejects.toSatisfy(notFound);
      }
      await expect(exitFor(tx, w.principalA, w.sB)).rejects.toSatisfy(notFound); // a student of the OTHER school
      await expect(exitFor(tx, w.principalA, w.s1, { time: "25:99" })).rejects.toSatisfy(isError("VALIDATION", LEAVE_MESSAGES.badTime));

      // The roster tells a manager (not a teacher) that an exit can be recorded.
      expect((await roster(tx, w.principalA, 4)).canRecordExit).toBe(true);
      expect((await roster(tx, w.teacher, 4)).canRecordExit).toBe(false);

      const rec = await exitFor(tx, w.principalA, w.s1, { time: "10:30", note: SECRET_EXIT_NOTE, pickedUpBy: SECRET_PICKUP, category: "appointment" });
      expect(rec).toMatchObject({ exitTime: "10:30", notified: 1 });
      // The date is today (Tehran), the school the student's, the recorder the session's.
      const exits = await as(tx, w.principalA, (t) => listTodaysEarlyExits(t, w.principalA, {}, NOW));
      expect(exits).toHaveLength(1);
      expect(exits[0]).toMatchObject({ id: rec.id, schoolId: f.SCHOOL_A, studentName: w.s1.name, date: TODAY, exitTime: "10:30", category: "appointment", pickedUpBy: SECRET_PICKUP });
      expect(await as(tx, w.principalB, (t) => listTodaysEarlyExits(t, w.principalB, {}, NOW))).toEqual([]);
      await expect(exitFor(tx, w.viceA, w.s1)).rejects.toSatisfy(isError("VALIDATION", LEAVE_MESSAGES.exitExists));

      // The roster: زنگ ۲ (08:55) and ۳ (10:00) began before 10:30 — not covered; زنگ ۴ (10:55) is. The daily roll call never is.
      const second = await roster(tx, w.teacher, 2);
      expect(row(second, w.s1)).toMatchObject({ status: "present", coverage: null });
      const fourth = await roster(tx, w.teacher, 4);
      expect(row(fourth, w.s1)).toMatchObject({ status: "excused", coverage: "early_exit", recorded: false });
      expect(row(fourth, w.s2)).toMatchObject({ status: "present", coverage: null });
      expect(row(await roster(tx, w.principalA, null), w.s1)).toMatchObject({ status: "present", coverage: null });
      expect(JSON.stringify(fourth)).not.toContain(SECRET_EXIT_NOTE);
      expect(JSON.stringify(fourth)).not.toContain(SECRET_PICKUP);
      // The student cannot already have the panel: the manager's page hides the button on a covered row (UI) and the service says so.
      expect(row(await roster(tx, w.principalA, 4), w.s1).coverage).toBe("early_exit");

      // The guardian: exactly one bell, «خروج مجاز: <نام>» — not the time, the reason, the note or the pickup.
      const heard = await bells(tx, w.g1, "guardian.early_exit");
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ title: `خروج مجاز: ${w.s1.name}`, body: null, link: `/child/attendance?child=${w.s1.studentProfileId}` });
      expect(JSON.stringify(heard)).not.toMatch(/10:30|۱۰:۳۰/);
      expect(await bells(tx, w.g2, "guardian.early_exit")).toEqual([]);

      // No absence is told for the covered child on a later زنگ, even if the teacher marks them absent.
      await as(tx, w.teacher, (t) => takeAttendance(t, w.teacher, { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo: 4, entries: [{ studentProfileId: w.s1.studentProfileId, status: "absent" }] }, NOW));
      expect(await bells(tx, w.g1, "guardian.child_absent")).toEqual([]);

      // The guardian sees the exit in the child's page (time, reason category, who — never the manager's note).
      const page = await as(tx, w.g1, (t) => childLeavePage(t, w.g1, w.s1.studentProfileId, NOW));
      expect(page.exits).toHaveLength(1);
      expect(page.exits[0]).toMatchObject({ id: rec.id, date: TODAY, exitTime: "10:30", category: "appointment", pickedUpBy: SECRET_PICKUP });
      expect(JSON.stringify(page.exits)).not.toContain(SECRET_EXIT_NOTE);
      await expect(as(tx, w.g2, (t) => childLeavePage(t, w.g2, w.s1.studentProfileId, NOW))).rejects.toSatisfy(notFound);

      // Cancelling: only the school's managers; the later زنگ‌ها open «حاضر» again; a new exit may then be recorded.
      for (const who of [w.principalB, w.teacher, w.g1]) {
        await expect(as(tx, who, (t) => cancelEarlyExit(t, who, { id: rec.id }, NOW)), who.personId).rejects.toSatisfy(notFound);
      }
      await as(tx, w.viceA, (t) => cancelEarlyExit(t, w.viceA, { id: rec.id }, NOW));
      await expect(as(tx, w.viceA, (t) => cancelEarlyExit(t, w.viceA, { id: rec.id }, NOW))).rejects.toSatisfy(isError("VALIDATION", LEAVE_MESSAGES.exitNotActive));
      expect(row(await roster(tx, w.principalA, 6), w.s1)).toMatchObject({ status: "present", coverage: null });
      expect(await as(tx, w.principalA, (t) => listTodaysEarlyExits(t, w.principalA, {}, NOW))).toEqual([]);
      await exitFor(tx, w.principalA, w.s1, { time: "11:50" });
      // 11:50: زنگ ۴ (10:55) began before it, زنگ ۵ (12:00) after.
      expect(row(await roster(tx, w.teacher, 4), w.s1)).toMatchObject({ coverage: null, recorded: true });
      expect(row(await roster(tx, w.principalA, 5), w.s1)).toMatchObject({ status: "excused", coverage: "early_exit" });

      // The trail: ids, time, category and lengths — never the note or the pickup's name.
      const trail = await auditText(tx);
      expect(trail).toContain("academic.early_exit.recorded");
      expect(trail).toContain("academic.early_exit.cancelled");
      expect(trail).toContain(`"pickedUpByLength":${SECRET_PICKUP.length}`);
      expect(trail).not.toContain(SECRET_EXIT_NOTE);
      expect(trail).not.toContain(SECRET_PICKUP);
    });
  });

  it("an ended guardian link ends the guardian's rights over its requests, while the school can still decide what was filed", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const req = await ask(tx, w, w.g1, w.s1);
      // The link ends (the guardian is removed from the child): the page, a new request and the cancel are all NOT_FOUND.
      await unlinkGuardian(tx, w.admin, { linkId: w.g1Link });
      const gone = await actor(tx, w.g1.personId);
      await expect(as(tx, gone, (t) => childLeavePage(t, gone, w.s1.studentProfileId, NOW))).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(ask(tx, w, gone, w.s1, { fromDate: TOMORROW, toDate: TOMORROW })).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(as(tx, gone, (t) => cancelLeave(t, gone, { id: req.id }))).rejects.toSatisfy(isError("NOT_FOUND"));
      // The school can still decide the request that was already filed — its guardians (none left) are simply not told.
      const done = await decide(tx, w.principalA, req.id, "approved");
      expect(done.notified).toBe(0);
    });
  });

  it("a BRANCH-scoped vice principal holds the permissions below the school: no bell, no queue, no count, no door, no decision, no exit — the lists never offer what the actions refuse", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const vb = await createStaff(tx, w.admin, { firstName: "نرگس", lastName: "صادقی", phone: phone(9), createAccount: false, schoolId: f.SCHOOL_A });
      const roleRes = await tx.execute<{ id: string }>(sql`select id from iam.role where organization_id is null and code = 'vice_principal'`);
      await tx.execute(sql`
        insert into iam.role_assignment (id, organization_id, person_id, role_id, scope_type, branch_id, source_type, granted_by_person_id)
        values (gen_random_uuid(), ${f.ORG_A}::uuid, ${vb.personId}::uuid, ${roleRes.rows[0].id}::uuid, 'branch', ${f.BRANCH_A}::uuid, 'manual', ${w.admin.personId}::uuid)`);
      const branchVice = await actor(tx, vb.personId);
      expect(branchVice.assignments.some((a) => a.scopeType === "branch" && a.permissions.includes("academic.leave.decide"))).toBe(true);

      const req = await ask(tx, w, w.g1, w.s1);
      // The bell goes to the school's principal and (school-scoped) vice principal only — the people who can decide it.
      expect(req.notified).toBe(2);
      expect(await bells(tx, branchVice, "academic.leave_requested")).toEqual([]);
      // No list, no badge, no door, no decision — the same answer everywhere.
      await expect(as(tx, branchVice, (t) => listLeaveQueue(t, branchVice, {}, NOW))).rejects.toSatisfy(isError("FORBIDDEN"));
      expect(await as(tx, branchVice, (t) => pendingLeaveCount(t, branchVice))).toBe(0);
      expect(holdsAtSchool(branchVice.assignments, "academic.leave.decide", f.SCHOOL_A)).toBe(false);
      expect(holdsAtSchool(w.viceA.assignments, "academic.leave.decide", f.SCHOOL_A)).toBe(true);
      expect(holdsAtSchool(w.admin.assignments, "academic.leave.decide", f.SCHOOL_A)).toBe(true);
      await expect(decide(tx, branchVice, req.id, "approved")).rejects.toSatisfy(isError("NOT_FOUND"));
      // «خروج مجاز»: the roll call of a class of their branch offers no button, and the write refuses.
      expect((await roster(tx, branchVice, 4)).canRecordExit).toBe(false);
      await expect(exitFor(tx, branchVice, w.s1)).rejects.toSatisfy(isError("NOT_FOUND"));
      await expect(as(tx, branchVice, (t) => listTodaysEarlyExits(t, branchVice, {}, NOW))).rejects.toSatisfy(isError("FORBIDDEN"));
    });
  });

  it("the school's switch `leave_requests` (default on): off → no NEW request and the page says so; what was asked is still decided, and its guardian may still withdraw it (security review F5)", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const pending = await ask(tx, w, w.g1, w.s1, { fromDate: TOMORROW, toDate: TOMORROW });
      const second = await ask(tx, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 3), toDate: addDaysIso(TODAY, 3) });
      await tx.execute(sql`insert into config.feature_flag (id, organization_id, school_id, key, enabled) values (app.uuid_generate_v7(), ${f.ORG_A}::uuid, ${f.SCHOOL_A}::uuid, 'leave_requests', false)`);
      // A fresh savepoint per call: the switches are read once per transaction.
      const fresh = <T>(fn: (sp: Tx) => Promise<T>) => sub(tx, fn);
      await expect(fresh((sp) => ask(sp, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 5), toDate: addDaysIso(TODAY, 5) }))).rejects.toSatisfy(isError("FORBIDDEN", LEAVE_MESSAGES.switchedOff));
      expect(await fresh((sp) => as(sp, w.g1, (t) => childLeavePage(t, w.g1, w.s1.studentProfileId, NOW)))).toMatchObject({ enabled: false });
      // Another family's child of ANOTHER school is unaffected (the switch is school A's).
      expect(await fresh((sp) => as(sp, w.gB, (t) => childLeavePage(t, w.gB, w.sB.studentProfileId, NOW)))).toMatchObject({ enabled: true });
      // Still decided, still withdrawn.
      await expect(fresh((sp) => decide(sp, w.principalA, pending.id, "approved"))).resolves.toMatchObject({ status: "approved" });
      await expect(fresh((sp) => as(sp, w.g1, (t) => cancelLeave(t, w.g1, { id: second.id })))).resolves.toMatchObject({ id: second.id });
      // Back on: requests again.
      await tx.execute(sql`update config.feature_flag set enabled = true where key = 'leave_requests'`);
      await expect(fresh((sp) => ask(sp, w, w.g1, w.s1, { fromDate: addDaysIso(TODAY, 5), toDate: addDaysIso(TODAY, 5) }))).resolves.toMatchObject({ id: expect.any(String) });
    });
  });
});
