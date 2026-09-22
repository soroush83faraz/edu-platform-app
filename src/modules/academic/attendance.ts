// academic/attendance — «حضور و غیاب»: taking a roll call, the roster a teacher fills in, a student's own summary
// and the class report an admin reads. Same shape as the rest of the module: `(tx, ctx, input)` inside the
// caller's tenant transaction, explicit column selects, `audit()` in the one mutation, and every scope decision
// INSIDE the transaction — out of scope is NOT_FOUND, never FORBIDDEN (docs/admin.md «قانون دامنه»).
//
// The scope rule in one line: a roll call belongs to a CLASS at a زنگ. Admins (org admin, principal, vice) hold
// `academic.attendance.*` at the school, so `can(..., class_group)` answers for them; a teacher holds it at their
// `class_offering` only, so the service resolves the درس of that زنگ from the weekly timetable and asks
// `can(..., class_offering)` — that is what «their own offering at the right period» means. Both checks fail →
// NOT_FOUND.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { notFound, validation } from "@/lib/errors";
import { normalizeFa } from "@/lib/normalize";
import {
  absencePercent,
  addDaysIso,
  emptyCounts,
  isFutureIso,
  isValidIsoDate,
  tally,
  tehranToday,
  totalOf,
  weekdayOfIso,
  type AttendanceCounts,
  type AttendanceStatus,
} from "@/lib/attendance";
import { can } from "@/modules/iam/can";
import { classOffering } from "@/modules/tenancy/schema";
import {
  countClassAttendanceByDate,
  countClassAttendanceByStudent,
  countStudentAttendance,
  findAttendanceSession,
  findClassOfStudentProfile,
  findStudentProfile,
  listClassRoster,
  listPeriodsOfSchools,
  listSessionEntries,
  listStudentAttendance,
  listTakenCells,
  listTaughtSlots,
  listUntakenCells,
  type AttendanceSessionRow,
  type PeriodRow,
  type RosterStudent,
  type StudentAttendanceRow,
  type UntakenCell,
} from "./repo";
import { attendanceEntry, attendanceSession, timetableSlot } from "./schema";
import { findClassGroupFacts, type ClassGroupRef, type TimetableCtx } from "./service";

/** Attendance decides scope itself (`can()` inside), so it needs the caller's assignments — like the timetable. */
export type AttendanceCtx = TimetableCtx;

export const ATTENDANCE_MESSAGES = {
  badDate: "تاریخ نامعتبر است.",
  futureDate: "برای روز آینده نمی‌توان حضور و غیاب ثبت کرد.",
  badRange: "بازهٴ تاریخ نامعتبر است.",
  periodUnknown: "این زنگ در زنگ‌بندی مدرسه وجود ندارد.",
  offeringNotOfClass: "این درس برای این کلاس تعریف نشده است.",
  offeringClosed: "این درس پایان یافته است.",
  notInRoster: "برای کسی که در این کلاس ثبت‌نام فعال ندارد نمی‌توان حضور و غیاب ثبت کرد.",
  duplicateStudent: "برای یک دانش‌آموز دو وضعیت فرستاده شده است.",
  emptyRoster: "این کلاس دانش‌آموز فعالی ندارد.",
  minutesOnlyForLate: "دقیقهٴ تأخیر فقط برای وضعیت «تأخیر» ثبت می‌شود.",
} as const;

/** The longest report range the product asks the database for (one school year). */
const MAX_RANGE_DAYS = 400;

function fail(field: string, message: string): never {
  throw validation({ fieldErrors: { [field]: [message] } }, message);
}

function requireDate(date: string, field = "date"): string {
  if (!isValidIsoDate(date)) fail(field, ATTENDANCE_MESSAGES.badDate);
  return date;
}

// ---------------------------------------------------------------------------------------------------------------
// scope
// ---------------------------------------------------------------------------------------------------------------

/**
 * The درس of a cell: the offering the caller named (validated against the class) or, when they named none, the
 * offering the weekly timetable puts at that (weekday, زنگ). Null for a daily roll call with no timetable cell.
 */
async function resolveOffering(tx: Tx, cg: ClassGroupRef, date: string, periodNo: number | null, classOfferingId: string | null): Promise<string | null> {
  if (classOfferingId) {
    const [o] = await tx
      .select({ id: classOffering.id, classGroupId: classOffering.classGroupId, status: classOffering.status })
      .from(classOffering)
      .where(eq(classOffering.id, classOfferingId))
      .limit(1);
    if (!o || o.classGroupId !== cg.id) fail("classOfferingId", ATTENDANCE_MESSAGES.offeringNotOfClass);
    if (o.status === "closed") fail("classOfferingId", ATTENDANCE_MESSAGES.offeringClosed);
    return o.id;
  }
  if (periodNo === null) return null;
  const weekday = weekdayOfIso(date);
  if (weekday === null) return null;
  const [slot] = await tx
    .select({ offeringId: timetableSlot.classOfferingId })
    .from(timetableSlot)
    .where(and(eq(timetableSlot.classGroupId, cg.id), eq(timetableSlot.weekday, weekday), eq(timetableSlot.periodNo, periodNo)))
    .limit(1);
  return slot?.offeringId ?? null;
}

/** Holds `permission` at the class (admins) or at the درس of this cell (the teacher of that زنگ)? */
async function allowed(tx: Tx, ctx: AttendanceCtx, permission: "academic.attendance.read" | "academic.attendance.write", classGroupId: string, offeringId: string | null): Promise<boolean> {
  if (await can(tx, ctx, permission, { scopeType: "class_group", id: classGroupId })) return true;
  if (offeringId && (await can(tx, ctx, permission, { scopeType: "class_offering", id: offeringId }))) return true;
  return false;
}

/** Does the caller teach an open offering of this class? (a teacher may read the whole class's report). */
async function teachesInClass(tx: Tx, personId: string, classGroupId: string): Promise<boolean> {
  const res = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
    from academic.teacher_assignment ta
    join iam.staff_profile sp on sp.id = ta.staff_profile_id
    join tenancy.class_offering o on o.id = ta.class_offering_id
    where sp.person_id = ${personId}::uuid and ta.valid_to is null and o.class_group_id = ${classGroupId}::uuid and o.status <> 'closed'`);
  return Number(res.rows[0]?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// taking the roll call
// ---------------------------------------------------------------------------------------------------------------

export interface AttendanceEntryInput {
  studentProfileId: string;
  status: AttendanceStatus;
  /** Only kept for `late`; anything else is stored as NULL. */
  minutesLate?: number | null;
  note?: string | null;
}

export interface TakeAttendanceInput {
  classGroupId: string;
  /** ISO `YYYY-MM-DD`, Tehran calendar; never in the future. */
  date: string;
  /** The زنگ; null / undefined = the daily homeroom roll call. */
  periodNo?: number | null;
  /** The درس; when omitted it is resolved from the class's weekly timetable at that زنگ. */
  classOfferingId?: string | null;
  note?: string | null;
  entries: AttendanceEntryInput[];
}

export interface TakeAttendanceResult {
  sessionId: string;
  /** false when an existing roll call was updated (re-taking never duplicates). */
  created: boolean;
  counts: AttendanceCounts;
  takenAt: Date;
}

/**
 * Upserts ONE roll call and its marks in a single transaction: the session row (natural key
 * `(class_group, date, period_no)`, NULLS NOT DISTINCT — re-taking UPDATES it) and one entry per student. Students
 * dropped from the list lose their entry (a roster change), students added get one. Validates the date (never in
 * the future, Tehran), the زنگ (must exist in the school's زنگ‌بندی), the درس (must belong to the class) and the
 * roster (every student must have an active enrollment in that class on that date). Nobody is notified — phase 1
 * keeps attendance silent (docs/attendance.md).
 */
export async function takeAttendance(tx: Tx, ctx: AttendanceCtx, input: TakeAttendanceInput, now = new Date()): Promise<TakeAttendanceResult> {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg) throw notFound();
  const date = requireDate(input.date);
  if (isFutureIso(date, now)) fail("date", ATTENDANCE_MESSAGES.futureDate);
  const periodNo = input.periodNo ?? null;
  if (periodNo !== null) {
    const periods = (await listPeriodsOfSchools(tx, [cg.schoolId])).get(cg.schoolId) ?? [];
    if (!periods.some((p) => p.periodNo === periodNo)) fail("periodNo", ATTENDANCE_MESSAGES.periodUnknown);
  }
  const offeringId = await resolveOffering(tx, cg, date, periodNo, input.classOfferingId ?? null);
  if (!(await allowed(tx, ctx, "academic.attendance.write", cg.id, offeringId))) throw notFound();

  const roster = await listClassRoster(tx, cg.id, date);
  if (roster.length === 0) fail("entries", ATTENDANCE_MESSAGES.emptyRoster);
  const inRoster = new Set(roster.map((r) => r.studentProfileId));
  const seen = new Set<string>();
  const wanted = input.entries.map((e) => {
    if (!inRoster.has(e.studentProfileId)) fail("entries", ATTENDANCE_MESSAGES.notInRoster);
    if (seen.has(e.studentProfileId)) fail("entries", ATTENDANCE_MESSAGES.duplicateStudent);
    seen.add(e.studentProfileId);
    const note = e.note?.trim() ? normalizeFa(e.note.trim()).slice(0, 300) : null;
    return {
      studentProfileId: e.studentProfileId,
      status: e.status,
      minutesLate: e.status === "late" && typeof e.minutesLate === "number" && e.minutesLate > 0 ? Math.min(600, Math.round(e.minutesLate)) : null,
      note,
    };
  });

  const before = await findAttendanceSession(tx, cg.id, date, periodNo);
  const sessionNote = input.note?.trim() ? normalizeFa(input.note.trim()).slice(0, 300) : null;
  let sessionId: string;
  let takenAt: Date;
  if (before) {
    const [row] = await tx
      .update(attendanceSession)
      .set({ classOfferingId: offeringId, takenByPersonId: ctx.personId, takenAt: new Date(), note: sessionNote })
      .where(eq(attendanceSession.id, before.id))
      .returning({ id: attendanceSession.id, takenAt: attendanceSession.takenAt });
    sessionId = row.id;
    takenAt = row.takenAt;
  } else {
    const [row] = await tx
      .insert(attendanceSession)
      .values({
        organizationId: ctx.orgId,
        classGroupId: cg.id,
        classOfferingId: offeringId,
        date,
        periodNo,
        takenByPersonId: ctx.personId,
        note: sessionNote,
      })
      .returning({ id: attendanceSession.id, takenAt: attendanceSession.takenAt });
    sessionId = row.id;
    takenAt = row.takenAt;
  }

  const existing = await listSessionEntries(tx, sessionId);
  const existingBy = new Map(existing.map((e) => [e.studentProfileId, e]));
  for (const e of wanted) {
    const prev = existingBy.get(e.studentProfileId);
    if (prev) {
      if (prev.status !== e.status || prev.minutesLate !== e.minutesLate || prev.note !== e.note) {
        await tx.update(attendanceEntry).set({ status: e.status, minutesLate: e.minutesLate, note: e.note }).where(eq(attendanceEntry.id, prev.id));
      }
    } else {
      await tx.insert(attendanceEntry).values({
        organizationId: ctx.orgId,
        attendanceSessionId: sessionId,
        studentProfileId: e.studentProfileId,
        status: e.status,
        minutesLate: e.minutesLate,
        note: e.note,
      });
    }
  }
  const gone = existing.filter((e) => !seen.has(e.studentProfileId)).map((e) => e.id);
  if (gone.length > 0) await tx.delete(attendanceEntry).where(inArray(attendanceEntry.id, gone));

  const counts = tally(wanted.map((e) => e.status));
  await audit(
    ctx,
    before ? "academic.attendance_session.retaken" : "academic.attendance_session.taken",
    { schema: "academic", table: "attendance_session", id: sessionId },
    before ? { date: before.date, periodNo: before.periodNo, classOfferingId: before.classOfferingId, counts: tally(existing.map((e) => e.status)) } : null,
    { classGroupId: cg.id, date, periodNo, classOfferingId: offeringId, counts, removed: gone.length },
    tx,
  );
  return { sessionId, created: before === null, counts, takenAt };
}

// ---------------------------------------------------------------------------------------------------------------
// the roster a teacher fills in
// ---------------------------------------------------------------------------------------------------------------

export interface TakingRow extends RosterStudent {
  status: AttendanceStatus;
  minutesLate: number | null;
  note: string | null;
  /** false when this student has no mark yet in a saved roll call (the UI defaults them to «حاضر»). */
  recorded: boolean;
}

export interface SessionForTaking {
  classGroup: ClassGroupRef;
  date: string;
  periodNo: number | null;
  /** The زنگ of the school's زنگ‌بندی (null for the daily roll call or an unknown number). */
  period: PeriodRow | null;
  /** The درس of that زنگ, from the timetable. */
  offering: { id: string; subjectName: string } | null;
  rows: TakingRow[];
  /** The saved roll call, when there is one («ثبت‌شده در …»). */
  saved: { takenAt: Date; takenByName: string | null; note: string | null } | null;
  canWrite: boolean;
  /** The زنگ‌های the class has on this weekday — the page's period switcher. */
  periodsOfDay: Array<{ periodNo: number; label: string; subjectName: string; taken: boolean }>;
}

/**
 * Everything the taking page needs: the roster with the saved marks pre-filled (default «حاضر»), the زنگ and its
 * درس, the signature of the last save, and the other زنگ‌های of that day so the teacher can move along the row.
 * Read scope: `academic.attendance.read` at the class (admins) or at the درس of the زنگ (its teacher).
 */
export async function getSessionForTaking(
  tx: Tx,
  ctx: AttendanceCtx,
  input: { classGroupId: string; date: string; periodNo?: number | null },
  now = new Date(),
): Promise<SessionForTaking> {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg) throw notFound();
  const date = requireDate(input.date);
  const periodNo = input.periodNo ?? null;
  const periods = (await listPeriodsOfSchools(tx, [cg.schoolId])).get(cg.schoolId) ?? [];
  const period = periodNo === null ? null : (periods.find((p) => p.periodNo === periodNo) ?? null);
  const offeringId = await resolveOffering(tx, cg, date, periodNo, null);
  if (!(await allowed(tx, ctx, "academic.attendance.read", cg.id, offeringId))) throw notFound();
  const canWrite = !isFutureIso(date, now) && (await allowed(tx, ctx, "academic.attendance.write", cg.id, offeringId));

  const roster = await listClassRoster(tx, cg.id, date);
  const session = await findAttendanceSession(tx, cg.id, date, periodNo);
  const entries = session ? await listSessionEntries(tx, session.id) : [];
  const byStudent = new Map(entries.map((e) => [e.studentProfileId, e]));
  const rows: TakingRow[] = roster.map((s) => {
    const e = byStudent.get(s.studentProfileId);
    return {
      ...s,
      status: (e?.status as AttendanceStatus | undefined) ?? "present",
      minutesLate: e?.minutesLate ?? null,
      note: e?.note ?? null,
      recorded: e !== undefined,
    };
  });

  // The day's other زنگ‌ها: the class's timetable row for this weekday, with «ثبت‌شده» marks.
  const weekday = weekdayOfIso(date);
  const daySlots: Array<{ period_no: number; subject_name: string }> =
    weekday === null
      ? []
      : (
          await tx.execute<{ period_no: number; subject_name: string }>(sql`
            select ts.period_no, subj.name as subject_name
            from academic.timetable_slot ts
            join tenancy.class_offering o on o.id = ts.class_offering_id
            join tenancy.subject subj on subj.id = o.subject_id
            where ts.class_group_id = ${cg.id}::uuid and ts.weekday = ${weekday}
            order by ts.period_no`)
        ).rows;
  const taken = new Set((await listTakenCells(tx, date, [cg.id])).map((c) => c.periodNo));
  const periodsOfDay = daySlots.map((r) => {
    const p = periods.find((x) => x.periodNo === Number(r.period_no));
    return { periodNo: Number(r.period_no), label: p?.label ?? String(r.period_no), subjectName: r.subject_name, taken: taken.has(Number(r.period_no)) };
  });

  let offering: SessionForTaking["offering"] = null;
  if (offeringId) {
    const res = await tx.execute<{ id: string; subject_name: string }>(sql`
      select o.id, subj.name as subject_name
      from tenancy.class_offering o join tenancy.subject subj on subj.id = o.subject_id
      where o.id = ${offeringId}::uuid limit 1`);
    const r = res.rows[0];
    offering = r ? { id: r.id, subjectName: r.subject_name } : null;
  }

  return {
    classGroup: cg,
    date,
    periodNo,
    period,
    offering,
    rows,
    saved: session ? { takenAt: session.takenAt, takenByName: session.takenByName, note: session.note } : null,
    canWrite,
    periodsOfDay,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// a student's own attendance
// ---------------------------------------------------------------------------------------------------------------

export interface StudentAttendanceSummary {
  studentProfileId: string;
  studentName: string;
  className: string | null;
  from: string;
  to: string;
  counts: AttendanceCounts;
  recent: StudentAttendanceRow[];
}

/**
 * Counts per status plus the most recent marks of ONE student in `[from, to]`. A student reads their OWN profile
 * (the row filter is the boundary, so any scope that carries `academic.attendance.read` passes); staff need the
 * permission at the student's class (admins, and the teachers of that class). Anything else is NOT_FOUND.
 */
export async function studentAttendanceSummary(
  tx: Tx,
  ctx: AttendanceCtx,
  input: { studentProfileId: string; from: string; to: string; limit?: number },
): Promise<StudentAttendanceSummary> {
  const from = requireDate(input.from, "from");
  const to = requireDate(input.to, "to");
  if (from > to) fail("from", ATTENDANCE_MESSAGES.badRange);
  const mine = await findStudentProfile(tx, ctx.personId);
  const cls = await findClassOfStudentProfile(tx, input.studentProfileId);
  if (mine?.id !== input.studentProfileId) {
    const ok =
      (cls !== null && (await allowed(tx, ctx, "academic.attendance.read", cls.classGroupId, null))) ||
      (cls !== null && (await teachesInClass(tx, ctx.personId, cls.classGroupId))) ||
      (await can(tx, ctx, "academic.attendance.read", { scopeType: "student", id: input.studentProfileId }));
    if (!ok) throw notFound();
  }
  const name = mine?.id === input.studentProfileId ? mine.fullName : await studentNameOf(tx, input.studentProfileId);
  if (name === null) throw notFound();
  const counts = emptyCounts();
  for (const r of await countStudentAttendance(tx, input.studentProfileId, from, to)) {
    if (r.status in counts) counts[r.status as AttendanceStatus] = r.n;
  }
  return {
    studentProfileId: input.studentProfileId,
    studentName: name,
    className: cls?.classGroupName ?? null,
    from,
    to,
    counts,
    recent: await listStudentAttendance(tx, input.studentProfileId, from, to, input.limit ?? 40),
  };
}

async function studentNameOf(tx: Tx, studentProfileId: string): Promise<string | null> {
  const res = await tx.execute<{ first_name: string; last_name: string }>(sql`
    select p.first_name, p.last_name
    from iam.student_profile sp join iam.person p on p.id = sp.person_id
    where sp.id = ${studentProfileId}::uuid limit 1`);
  const r = res.rows[0];
  return r ? `${r.first_name} ${r.last_name}` : null;
}

/** The month a student's page opens on: the last 30 days up to today (Tehran). */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const to = tehranToday(now);
  return { from: addDaysIso(to, -29), to };
}

// ---------------------------------------------------------------------------------------------------------------
// the class report
// ---------------------------------------------------------------------------------------------------------------

export interface ClassReportStudent {
  studentProfileId: string;
  fullName: string;
  counts: AttendanceCounts;
  total: number;
  absencePercent: number;
}

export interface ClassReportDay {
  date: string;
  periodNo: number | null;
  counts: AttendanceCounts;
  total: number;
}

export interface ClassAttendanceReport {
  classGroup: ClassGroupRef;
  from: string;
  to: string;
  students: ClassReportStudent[];
  days: ClassReportDay[];
  totals: AttendanceCounts;
  /** Roll calls recorded in the range (day rows). */
  sessions: number;
}

/**
 * Per-student totals and per-day rows of one class in `[from, to]`. Read scope: `academic.attendance.read` at the
 * class (admins) or teaching an open offering of it (a teacher sees their class's numbers). The percentage math
 * is `src/lib/attendance.ts` (unit-tested); the database only counts.
 */
export async function classAttendanceReport(tx: Tx, ctx: AttendanceCtx, input: { classGroupId: string; from: string; to: string }): Promise<ClassAttendanceReport> {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg) throw notFound();
  const from = requireDate(input.from, "from");
  const to = requireDate(input.to, "to");
  if (from > to) fail("from", ATTENDANCE_MESSAGES.badRange);
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (span > MAX_RANGE_DAYS) fail("from", ATTENDANCE_MESSAGES.badRange);
  const ok = (await allowed(tx, ctx, "academic.attendance.read", cg.id, null)) || (await teachesInClass(tx, ctx.personId, cg.id));
  if (!ok) throw notFound();

  const byStudent = await countClassAttendanceByStudent(tx, cg.id, from, to);
  const students = new Map<string, ClassReportStudent>();
  const totals = emptyCounts();
  for (const r of byStudent) {
    const row = students.get(r.studentProfileId) ?? { studentProfileId: r.studentProfileId, fullName: r.fullName, counts: emptyCounts(), total: 0, absencePercent: 0 };
    if (r.status in row.counts) {
      row.counts[r.status as AttendanceStatus] += r.n;
      totals[r.status as AttendanceStatus] += r.n;
    }
    students.set(r.studentProfileId, row);
  }
  const byDate = await countClassAttendanceByDate(tx, cg.id, from, to);
  const days = new Map<string, ClassReportDay>();
  for (const r of byDate) {
    const key = `${r.date}:${r.periodNo ?? "-"}`;
    const row = days.get(key) ?? { date: r.date, periodNo: r.periodNo, counts: emptyCounts(), total: 0 };
    if (r.status in row.counts) row.counts[r.status as AttendanceStatus] += r.n;
    days.set(key, row);
  }
  const studentRows = [...students.values()].map((s) => ({ ...s, total: totalOf(s.counts), absencePercent: absencePercent(s.counts) }));
  const dayRows = [...days.values()].map((d) => ({ ...d, total: totalOf(d.counts) }));
  return { classGroup: cg, from, to, students: studentRows, days: dayRows, totals, sessions: dayRows.length };
}

// ---------------------------------------------------------------------------------------------------------------
// «امروز ثبت نشده» (admins) and the teacher's day
// ---------------------------------------------------------------------------------------------------------------

export interface TodayGaps {
  date: string;
  weekday: number;
  cells: UntakenCell[];
}

/** Today's timetable cells of the caller's schools with no roll call yet — `schoolIds` null = the whole tenant. */
export async function attendanceGaps(tx: Tx, schoolIds: readonly string[] | null, now = new Date()): Promise<TodayGaps> {
  const date = tehranToday(now);
  const weekday = weekdayOfIso(date) ?? 0;
  return { date, weekday, cells: await listUntakenCells(tx, date, weekday, schoolIds) };
}

export interface TeacherDayCell {
  classGroupId: string;
  classGroupName: string;
  periodNo: number;
  label: string;
  startsAt: string;
  endsAt: string;
  offeringId: string;
  subjectName: string;
  taken: boolean;
  absent: number;
}

/** The teacher's own زنگ‌های today, each marked «ثبت‌شده» or not — the list «/attendance» opens on. */
export async function teacherDay(tx: Tx, ctx: AttendanceCtx, now = new Date()): Promise<{ date: string; weekday: number; cells: TeacherDayCell[] }> {
  const date = tehranToday(now);
  const weekday = weekdayOfIso(date) ?? 0;
  const slots = (await listTaughtSlots(tx, ctx.personId)).filter((s) => s.weekday === weekday);
  if (slots.length === 0) return { date, weekday, cells: [] };
  const classGroupIds = [...new Set(slots.map((s) => s.classGroupId))];
  const schoolRes = await tx.execute<{ class_group_id: string; school_id: string }>(sql`
    select cg.id as class_group_id, b.school_id
    from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id
    where cg.id = any(${sql.param(classGroupIds, undefined)}::uuid[])`);
  const schoolOf = new Map(schoolRes.rows.map((r) => [r.class_group_id, r.school_id]));
  const periodsBySchool = await listPeriodsOfSchools(tx, [...new Set([...schoolOf.values()])]);
  const takenCells = await listTakenCells(tx, date, classGroupIds);
  const takenBy = new Map(takenCells.map((c) => [`${c.classGroupId}:${c.periodNo ?? "-"}`, c]));
  const cells: TeacherDayCell[] = slots.flatMap((s) => {
    const periods = periodsBySchool.get(schoolOf.get(s.classGroupId) ?? "") ?? [];
    const p = periods.find((x) => x.periodNo === s.periodNo);
    if (!p) return [];
    const cell = takenBy.get(`${s.classGroupId}:${s.periodNo}`);
    return [
      {
        classGroupId: s.classGroupId,
        classGroupName: s.classGroupName,
        periodNo: s.periodNo,
        label: p.label,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        offeringId: s.offeringId,
        subjectName: s.subjectName,
        taken: cell !== undefined,
        absent: cell?.absent ?? 0,
      },
    ];
  });
  cells.sort((a, b) => a.periodNo - b.periodNo || a.classGroupName.localeCompare(b.classGroupName, "fa"));
  return { date, weekday, cells };
}

export type { AttendanceSessionRow };
