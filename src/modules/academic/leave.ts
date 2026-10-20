// academic/leave — the SCHOOL's side of «مرخصی و خروج مجاز» (owner, 2026-10-20; docs/attendance.md): the queue of a
// guardian's leave requests a principal / vice principal / organization admin decides, and the authorized early exit
// they record. (The guardian's side — asking, cancelling, reading — is src/modules/iam/guardian-leave.ts; what a
// roll call does with an approved leave or an exit is ./leave-coverage.) Same shape as the rest of the module:
// `(tx, ctx, input)` inside the caller's tenant transaction, explicit column selects, `audit()` in every mutation, every
// scope decision INSIDE the transaction — out of scope is NOT_FOUND, never FORBIDDEN (docs/admin.md «قانون دامنه»).
//
// Scope: both permissions (`academic.leave.decide`, `academic.early_exit.write`) are held by the school managers only
// (`ALL_ROLE_PERMS`, scripts/catalog.ts) and checked AT THE CHILD'S SCHOOL (`can(…, { scopeType: "school" })`): a manager
// of another school, a teacher and a guardian all read NOT_FOUND. The lists narrow by `getPermissionScope`.
// Privacy: audit rows carry ids, dates, categories and the LENGTH of a note — never its text; the guardians' bell
// names the child and the kind of event only (src/modules/iam/guardian-notify.ts).
// What an approval does NOT do: it does not rewrite a roll call already saved — a student the teacher has already marked
// keeps that mark; the next roll call opened for the covered date / زنگ pre-marks the unrecorded ones «موجه»
// (leave-coverage), and a guardian never hears of an absence an approved leave covers. The same holds for an early exit.
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { tehranToday } from "@/lib/attendance";
import { notFound, validation } from "@/lib/errors";
import {
  EARLY_EXIT_NOTE_MAX,
  EARLY_EXIT_PICKUP_MAX,
  LEAVE_DECISION_NOTE_MAX,
  LEAVE_MESSAGES as MSG,
  cleanOptionalText,
  isEarlyExitCategory,
  normalizeClock,
  tehranClock,
} from "@/lib/leave";
import { normalizeFa, toAsciiDigits } from "@/lib/normalize";
import { findStudentAnchor } from "@/modules/counseling/repo";
import { can } from "@/modules/iam/can";
import { notifyGuardiansOfEarlyExit, notifyGuardiansOfLeaveDecision } from "@/modules/iam/guardian-notify";
import { assertSchoolInScope, getPermissionScope, type AdminScope } from "@/modules/iam/service";
import type { AttendanceCtx } from "./attendance";
import type { DecideLeaveInput, RecordEarlyExitInput } from "./leave-dto";
import { earlyExit, leaveRequest } from "./schema";

export type LeaveCtx = AttendanceCtx;

const fail = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

// ---------------------------------------------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------------------------------------------

export interface LeaveQueueRow {
  id: string;
  schoolId: string;
  schoolName: string;
  studentProfileId: string;
  studentName: string;
  className: string | null;
  requestedByName: string;
  fromDate: string;
  toDate: string;
  fromPeriod: number | null;
  toPeriod: number | null;
  category: string;
  note: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  createdAt: Date;
}

export interface LeaveQueue {
  /** The school the page is narrowed to (`?school=`), when there is one. */
  school: { id: string; name: string } | null;
  /** Waiting for a decision, oldest request first. */
  pending: LeaveQueueRow[];
  /** Decided or cancelled in the last 60 days, newest first. */
  recent: LeaveQueueRow[];
}

/** The schools a query is narrowed to: `schoolId` (validated against the scope) → just it; else the scope; null = everything. */
function schoolFilter(scope: AdminScope, schoolId: string | undefined): string[] | null {
  if (schoolId) {
    assertSchoolInScope(scope, schoolId);
    return [schoolId];
  }
  return scope.kind === "organization" ? null : scope.schoolIds;
}

const inSchools = (alias: string, schoolIds: string[] | null) => (schoolIds === null ? sql`` : sql`and ${sql.raw(alias)}.school_id = any(${sql.param(schoolIds, undefined)}::uuid[])`);

type QueueDbRow = {
  id: string;
  school_id: string;
  school_name: string;
  student_profile_id: string;
  first_name: string;
  last_name: string;
  class_name: string | null;
  req_first: string;
  req_last: string;
  from_date: string;
  to_date: string;
  from_period: number | null;
  to_period: number | null;
  category: string;
  note: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  dec_first: string | null;
  dec_last: string | null;
  created_at: string;
};

const toRow = (r: QueueDbRow): LeaveQueueRow => ({
  id: r.id,
  schoolId: r.school_id,
  schoolName: r.school_name,
  studentProfileId: r.student_profile_id,
  studentName: `${r.first_name} ${r.last_name}`,
  className: r.class_name,
  requestedByName: `${r.req_first} ${r.req_last}`,
  fromDate: r.from_date,
  toDate: r.to_date,
  fromPeriod: r.from_period === null ? null : Number(r.from_period),
  toPeriod: r.to_period === null ? null : Number(r.to_period),
  category: r.category,
  note: r.note,
  status: r.status,
  decisionNote: r.decision_note,
  decidedAt: r.decided_at ? new Date(r.decided_at) : null,
  decidedByName: r.dec_first ? `${r.dec_first} ${r.dec_last}` : null,
  createdAt: new Date(r.created_at),
});

const QUEUE_COLUMNS = sql`
  select lr.id, lr.school_id, sch.name as school_name, lr.student_profile_id, sp.first_name, sp.last_name, cls.name as class_name,
    rq.first_name as req_first, rq.last_name as req_last,
    lr.from_date::text as from_date, lr.to_date::text as to_date, lr.from_period, lr.to_period,
    lr.category, lr.note, lr.status, lr.decision_note, lr.decided_at, dp.first_name as dec_first, dp.last_name as dec_last, lr.created_at
  from academic.leave_request lr
  join tenancy.school sch on sch.id = lr.school_id
  join iam.student_profile st on st.id = lr.student_profile_id
  join iam.person sp on sp.id = st.person_id
  join iam.person rq on rq.id = lr.requested_by_person_id
  left join iam.person dp on dp.id = lr.decided_by_person_id
  left join lateral (
    select cg.name
    from academic.class_enrollment ce join tenancy.class_group cg on cg.id = ce.class_group_id
    where ce.student_profile_id = lr.student_profile_id and ce.status = 'active'
    order by ce.starts_on desc limit 1
  ) cls on true`;

/**
 * The school's queue «درخواست‌های مرخصی»: the pending requests (oldest first) and the last 60 days' decided ones, of the
 * schools the caller holds `academic.leave.decide` at (the organization admin: every school); `schoolId` narrows to one
 * (NOT_FOUND outside the scope). FORBIDDEN for a caller who holds the permission nowhere.
 */
export async function listLeaveQueue(tx: Tx, ctx: LeaveCtx, input: { schoolId?: string }, now = new Date()): Promise<LeaveQueue> {
  const scope = await getPermissionScope(tx, ctx, "academic.leave.decide");
  const schools = schoolFilter(scope, input.schoolId);
  let school: LeaveQueue["school"] = null;
  if (input.schoolId) {
    const res = await tx.execute<{ id: string; name: string }>(sql`select id, name from tenancy.school where id = ${input.schoolId}::uuid`);
    if (!res.rows[0]) throw notFound();
    school = { id: res.rows[0].id, name: res.rows[0].name };
  }
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const pending = await tx.execute<QueueDbRow>(sql`${QUEUE_COLUMNS} where lr.status = 'pending' ${inSchools("lr", schools)} order by lr.created_at, lr.id limit 200`);
  const recent = await tx.execute<QueueDbRow>(
    sql`${QUEUE_COLUMNS} where lr.status <> 'pending' and lr.updated_at >= ${since}::timestamptz ${inSchools("lr", schools)} order by lr.updated_at desc, lr.id limit 100`,
  );
  return { school, pending: pending.rows.map(toRow), recent: recent.rows.map(toRow) };
}

/** How many requests wait for the caller's schools — Home's tile badge. 0 for a caller who holds the permission nowhere. */
export async function pendingLeaveCount(tx: Tx, ctx: LeaveCtx): Promise<number> {
  const holds = ctx.assignments.some((a) => a.permissions.includes("academic.leave.decide"));
  if (!holds) return 0;
  const scope = await getPermissionScope(tx, ctx, "academic.leave.decide");
  const schools = schoolFilter(scope, undefined);
  const res = await tx.execute<{ n: number }>(sql`select count(*)::int as n from academic.leave_request lr where lr.status = 'pending' ${inSchools("lr", schools)}`);
  return Number(res.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// deciding
// ---------------------------------------------------------------------------------------------------------------

export interface DecideLeaveResult {
  id: string;
  status: "approved" | "rejected";
  /** Live guardians told (the actor excepted). */
  notified: number;
}

/**
 * Approves or rejects a PENDING request of the caller's school (`academic.leave.decide` at the request's school —
 * NOT_FOUND otherwise, a request of another school or tenant included). The decision is one conditional UPDATE
 * (`WHERE status = 'pending'`): a guardian's cancel or another manager's decision that lands first wins, this one then
 * answers «دیگر در انتظار بررسی نیست». The guardians of the child are told in the same transaction.
 */
export async function decideLeave(tx: Tx, ctx: LeaveCtx, input: DecideLeaveInput, now = new Date()): Promise<DecideLeaveResult> {
  const [row] = await tx
    .select({ id: leaveRequest.id, schoolId: leaveRequest.schoolId, studentProfileId: leaveRequest.studentProfileId, status: leaveRequest.status })
    .from(leaveRequest)
    .where(eq(leaveRequest.id, input.id))
    .limit(1);
  if (!row) throw notFound();
  if (!(await can(tx, ctx, "academic.leave.decide", { scopeType: "school", id: row.schoolId }))) throw notFound();
  const note = cleanOptionalText(input.note ? normalizeFa(input.note) : null, LEAVE_DECISION_NOTE_MAX);
  const done = await tx
    .update(leaveRequest)
    .set({ status: input.decision, decidedByPersonId: ctx.personId, decidedAt: now, decisionNote: note })
    .where(and(eq(leaveRequest.id, row.id), eq(leaveRequest.status, "pending")))
    .returning({ id: leaveRequest.id });
  if (done.length === 0) throw fail("id", MSG.notPending);
  await audit(
    ctx,
    input.decision === "approved" ? "academic.leave_request.approved" : "academic.leave_request.rejected",
    { schema: "academic", table: "leave_request", id: row.id },
    { status: "pending" },
    { status: input.decision, studentProfileId: row.studentProfileId, schoolId: row.schoolId, noteLength: note === null ? 0 : note.length },
    tx,
  );
  const notified = await notifyGuardiansOfLeaveDecision(tx, ctx, { leaveRequestId: row.id, studentProfileId: row.studentProfileId, approved: input.decision === "approved" });
  return { id: row.id, status: input.decision, notified };
}

// ---------------------------------------------------------------------------------------------------------------
// «خروج مجاز»
// ---------------------------------------------------------------------------------------------------------------

export interface EarlyExitRow {
  id: string;
  schoolId: string;
  schoolName: string;
  studentProfileId: string;
  studentName: string;
  className: string | null;
  date: string;
  /** `HH:MM`, Tehran. */
  exitTime: string;
  category: string;
  note: string | null;
  pickedUpBy: string | null;
  recordedByName: string;
}

/** Today's active authorized exits of the caller's schools (`schoolId` narrows to one; NOT_FOUND outside the scope). */
export async function listTodaysEarlyExits(tx: Tx, ctx: LeaveCtx, input: { schoolId?: string }, now = new Date()): Promise<EarlyExitRow[]> {
  const scope = await getPermissionScope(tx, ctx, "academic.early_exit.write");
  const schools = schoolFilter(scope, input.schoolId);
  const res = await tx.execute<{
    id: string;
    school_id: string;
    school_name: string;
    student_profile_id: string;
    first_name: string;
    last_name: string;
    class_name: string | null;
    date: string;
    exit_time: string;
    category: string;
    note: string | null;
    picked_up_by: string | null;
    rec_first: string;
    rec_last: string;
  }>(sql`
    select ee.id, ee.school_id, sch.name as school_name, ee.student_profile_id, sp.first_name, sp.last_name, cls.name as class_name,
      ee.date::text as date, ee.exit_time::text as exit_time, ee.category, ee.note, ee.picked_up_by, rc.first_name as rec_first, rc.last_name as rec_last
    from academic.early_exit ee
    join tenancy.school sch on sch.id = ee.school_id
    join iam.student_profile st on st.id = ee.student_profile_id
    join iam.person sp on sp.id = st.person_id
    join iam.person rc on rc.id = ee.recorded_by_person_id
    left join lateral (
      select cg.name
      from academic.class_enrollment ce join tenancy.class_group cg on cg.id = ce.class_group_id
      where ce.student_profile_id = ee.student_profile_id and ce.status = 'active'
      order by ce.starts_on desc limit 1
    ) cls on true
    where ee.status = 'active' and ee.date = ${tehranToday(now)}::date ${inSchools("ee", schools)}
    order by ee.exit_time desc, ee.id`);
  return res.rows.map((r) => ({
    id: r.id,
    schoolId: r.school_id,
    schoolName: r.school_name,
    studentProfileId: r.student_profile_id,
    studentName: `${r.first_name} ${r.last_name}`,
    className: r.class_name,
    date: r.date,
    exitTime: normalizeClock(r.exit_time) ?? r.exit_time,
    category: r.category,
    note: r.note,
    pickedUpBy: r.picked_up_by,
    recordedByName: `${r.rec_first} ${r.rec_last}`,
  }));
}

export interface RecordEarlyExitResult {
  id: string;
  /** `HH:MM`, Tehran — the time stored (the default is now). */
  exitTime: string;
  notified: number;
}

/**
 * Records that a student of the caller's school leaves school at `time` TODAY (Tehran; default: now): reason category,
 * optional note and pickup name. `academic.early_exit.write` at the student's school — NOT_FOUND for a student of
 * another school / tenant, a withdrawn one included (the same anchor the counseling file uses). One active exit per
 * student per day. The later زنگ‌ها of the day open pre-marked «موجه» (leave-coverage); the guardians are told.
 */
export async function recordEarlyExit(tx: Tx, ctx: LeaveCtx, input: RecordEarlyExitInput, now = new Date()): Promise<RecordEarlyExitResult> {
  const anchor = await findStudentAnchor(tx, input.studentProfileId);
  if (!anchor) throw notFound();
  if (!(await can(tx, ctx, "academic.early_exit.write", { scopeType: "school", id: anchor.schoolId }))) throw notFound();
  if (!isEarlyExitCategory(input.category)) throw fail("category", "دلیل خروج نامعتبر است.");
  const exitTime = input.time && input.time.trim() !== "" ? normalizeClock(toAsciiDigits(input.time)) : tehranClock(now);
  if (exitTime === null) throw fail("time", MSG.badTime);
  const note = cleanOptionalText(input.note ? normalizeFa(input.note) : null, EARLY_EXIT_NOTE_MAX);
  const pickedUpBy = cleanOptionalText(input.pickedUpBy ? normalizeFa(input.pickedUpBy) : null, EARLY_EXIT_PICKUP_MAX);
  const date = tehranToday(now);

  const existing = await tx
    .select({ id: earlyExit.id })
    .from(earlyExit)
    .where(and(eq(earlyExit.studentProfileId, anchor.studentProfileId), eq(earlyExit.date, date), eq(earlyExit.status, "active")))
    .limit(1);
  if (existing.length > 0) throw fail("studentProfileId", MSG.exitExists);

  const [row] = await tx
    .insert(earlyExit)
    .values({
      organizationId: ctx.orgId,
      schoolId: anchor.schoolId,
      studentProfileId: anchor.studentProfileId,
      date,
      exitTime,
      category: input.category,
      note,
      pickedUpBy,
      recordedByPersonId: ctx.personId,
    })
    .returning({ id: earlyExit.id });
  await audit(
    ctx,
    "academic.early_exit.recorded",
    { schema: "academic", table: "early_exit", id: row.id },
    null,
    {
      studentProfileId: anchor.studentProfileId,
      schoolId: anchor.schoolId,
      date,
      exitTime,
      category: input.category,
      noteLength: note === null ? 0 : note.length,
      pickedUpByLength: pickedUpBy === null ? 0 : pickedUpBy.length,
    },
    tx,
  );
  const notified = await notifyGuardiansOfEarlyExit(tx, ctx, { earlyExitId: row.id, studentProfileId: anchor.studentProfileId });
  return { id: row.id, exitTime, notified };
}

/** Cancels a mistaken exit (`academic.early_exit.write` at its school; NOT_FOUND otherwise). Kept as a `cancelled` row. */
export async function cancelEarlyExit(tx: Tx, ctx: LeaveCtx, input: { id: string }, now = new Date()): Promise<{ id: string }> {
  const [row] = await tx
    .select({ id: earlyExit.id, schoolId: earlyExit.schoolId, studentProfileId: earlyExit.studentProfileId })
    .from(earlyExit)
    .where(eq(earlyExit.id, input.id))
    .limit(1);
  if (!row) throw notFound();
  if (!(await can(tx, ctx, "academic.early_exit.write", { scopeType: "school", id: row.schoolId }))) throw notFound();
  const done = await tx
    .update(earlyExit)
    .set({ status: "cancelled", cancelledByPersonId: ctx.personId, cancelledAt: now })
    .where(and(eq(earlyExit.id, row.id), eq(earlyExit.status, "active")))
    .returning({ id: earlyExit.id });
  if (done.length === 0) throw fail("id", MSG.exitNotActive);
  await audit(ctx, "academic.early_exit.cancelled", { schema: "academic", table: "early_exit", id: row.id }, { status: "active" }, { status: "cancelled", studentProfileId: row.studentProfileId, schoolId: row.schoolId }, tx);
  return { id: row.id };
}

