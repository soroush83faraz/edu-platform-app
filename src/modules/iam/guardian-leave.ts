// iam/guardian-leave — «درخواست مرخصی / غیبت موجه» of a guardian for ONE of their children (owner, 2026-10-20;
// docs/attendance.md «مرخصی و خروج مجاز»; docs/decisions.md). The second write of the «ولی» role after «پیام به مدرسه».
//
// The rules, all decided here inside the caller's transaction (never from input):
//   • the child must be one of the caller's LIVE children and the caller must hold `academic.leave.request` at that
//     child's student scope (`requireChild` — both halves; NOT_FOUND otherwise: another guardian's child, a student's own
//     session, a manager, a removed student);
//   • the dates: a range of at most 14 days that does not start before today (Tehran), or one day with a partial day
//     (from زنگ N to M, both in the school's bell schedule) — `validateLeaveRange` (src/lib/leave.ts, unit-tested), the
//     CHECKs of migration 0029 say it once more;
//   • no two live (pending / approved) requests of one child overlap (a partial day sits beside another partial day of
//     the same date), at most `LEAVE_MAX_PENDING` wait for the school at once — decided under the child's profile row
//     taken FOR NO KEY UPDATE, so two guardians of one child asking at the same time serialise on it;
//   • the school is the child's NOW (the live school enrollment, counseling `findStudentAnchor`) — the scope its
//     managers decide at; none → a Persian VALIDATION error;
//   • a guardian cancels only THEIR OWN request, and only while it is pending (`UPDATE … WHERE status = 'pending'`: a
//     decision that lands first wins, the cancel then answers «دیگر در انتظار بررسی نیست»).
// Visibility: every live guardian of the child reads all the child's requests and the authorized early exits (time,
// reason category, who picked up — never a manager's note); a teacher never reads a reason (the roster shows a
// «مرخصی» tag, academic/leave-coverage). Privacy of the trail: the audit rows carry ids, dates, the category and the
// note's LENGTH — never its text; the managers' bell names the child only (`leaveRequestedTitle`).
// The school's managers hear of a new request: the live holders of `academic.leave.decide` AT the child's school
// (`leaveDeciders` — its principal and vice principals; exactly who may decide it), never the guardian; a school without
// either is read from the queue only (and, with «مرکز درخواست‌ها» on, escalated to the organization admin).
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { notFound, validation } from "@/lib/errors";
import { addDaysIso, tehranToday } from "@/lib/attendance";
import {
  LEAVE_MAX_PENDING,
  LEAVE_MESSAGES as MSG,
  LEAVE_NOTE_MAX,
  cleanOptionalText,
  leaveRequestedTitle,
  leavesOverlap,
  normalizeClock,
  validateLeaveRange,
} from "@/lib/leave";
import { normalizeFa } from "@/lib/normalize";
import { allDeciders, leaveDeciders } from "@/modules/academic/leave-deciders";
import { earlyExit, leaveRequest } from "@/modules/academic/schema";
import { listPeriodsOfSchools, type PeriodRow } from "@/modules/academic/repo";
import type { RequestLeaveInput } from "@/modules/academic/leave-dto";
import { lockActivePersons, findStudentAnchor } from "@/modules/counseling/repo";
import { notifyMany } from "@/modules/notif/service";
import { closeLeaveRequestClock } from "@/modules/workspace/request-clock";
import { openRequestSla } from "@/modules/workspace/requests";
import { requireChild, type ChildContext, type GuardianViewCtx } from "./guardian-views";

export type GuardianLeaveCtx = GuardianViewCtx & AuditCtx;

/** The permission every guardian-leave read and write names (the derived «ولی» role only). */
export const GUARDIAN_LEAVE_PERMISSION = "academic.leave.request" as const;

const fail = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

export interface ChildLeaveRow {
  id: string;
  fromDate: string;
  toDate: string;
  fromPeriod: number | null;
  toPeriod: number | null;
  category: string;
  note: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  /** The caller wrote it (only they may cancel it). */
  mine: boolean;
}

export interface ChildExitRow {
  id: string;
  date: string;
  /** `HH:MM`, Tehran. */
  exitTime: string;
  category: string;
  pickedUpBy: string | null;
}

export interface ChildLeavePage extends ChildContext {
  requests: ChildLeaveRow[];
  /** Authorized early exits of the last 30 days, newest first. */
  exits: ChildExitRow[];
  /** The child's school NOW (null: no live school enrollment — nothing can be requested). */
  schoolId: string | null;
  /** The school's bell schedule (the partial-day pickers); empty when the school has none or the child belongs to none. */
  periods: PeriodRow[];
  today: string;
}

/**
 * «درخواست‌های مرخصی» of one child: their requests (newest first) with status and decision, the authorized early exits
 * of the last 30 days and the school's زنگ‌ها for the form — `requireChild` first (NOT_FOUND).
 */
export async function childLeavePage(tx: Tx, ctx: GuardianLeaveCtx, requested: string | undefined, now = new Date()): Promise<ChildLeavePage> {
  const c = await requireChild(tx, ctx, requested, GUARDIAN_LEAVE_PERMISSION);
  const id = c.child.studentProfileId;
  const today = tehranToday(now);
  const anchor = await findStudentAnchor(tx, id);
  const periods = anchor ? ((await listPeriodsOfSchools(tx, [anchor.schoolId])).get(anchor.schoolId) ?? []) : [];
  const rows = await tx
    .select({
      id: leaveRequest.id,
      fromDate: leaveRequest.fromDate,
      toDate: leaveRequest.toDate,
      fromPeriod: leaveRequest.fromPeriod,
      toPeriod: leaveRequest.toPeriod,
      category: leaveRequest.category,
      note: leaveRequest.note,
      status: leaveRequest.status,
      decisionNote: leaveRequest.decisionNote,
      decidedAt: leaveRequest.decidedAt,
      createdAt: leaveRequest.createdAt,
      requestedBy: leaveRequest.requestedByPersonId,
    })
    .from(leaveRequest)
    .where(eq(leaveRequest.studentProfileId, id))
    .orderBy(desc(leaveRequest.createdAt), desc(leaveRequest.id))
    .limit(50);
  const exits = await tx
    .select({ id: earlyExit.id, date: earlyExit.date, exitTime: earlyExit.exitTime, category: earlyExit.category, pickedUpBy: earlyExit.pickedUpBy })
    .from(earlyExit)
    .where(and(eq(earlyExit.studentProfileId, id), eq(earlyExit.status, "active"), gte(earlyExit.date, addDaysIso(today, -30))))
    .orderBy(desc(earlyExit.date), desc(earlyExit.exitTime))
    .limit(30);
  return {
    ...c,
    today,
    schoolId: anchor?.schoolId ?? null,
    periods,
    requests: rows.map(({ requestedBy, ...r }) => ({ ...r, mine: requestedBy === ctx.personId })),
    exits: exits.map((e) => ({ ...e, exitTime: normalizeClock(e.exitTime) ?? e.exitTime })),
  };
}

export interface RequestLeaveResult {
  id: string;
  /** How many managers were told (principals / vice principals of the child's school). */
  notified: number;
}

/** Files one request (module header for every rule). Returns its id. */
export async function requestLeave(tx: Tx, ctx: GuardianLeaveCtx, input: RequestLeaveInput, now = new Date()): Promise<RequestLeaveResult> {
  const { child } = await requireChild(tx, ctx, input.child, GUARDIAN_LEAVE_PERMISSION);
  // `requireChild` without a matching id would pick the first child — a request always names one, and only that one.
  if (child.studentProfileId !== input.child) throw notFound();

  const fromPeriod = input.fromPeriod ?? null;
  const toPeriod = input.toPeriod ?? null;
  const bad = validateLeaveRange({ fromDate: input.fromDate, toDate: input.toDate, fromPeriod, toPeriod }, now);
  if (bad) throw fail(bad.field, bad.message);
  const note = cleanOptionalText(input.note ? normalizeFa(input.note) : null, LEAVE_NOTE_MAX);

  const anchor = await findStudentAnchor(tx, child.studentProfileId);
  if (!anchor) throw fail("child", MSG.noSchool);
  if (fromPeriod !== null && toPeriod !== null) {
    const periods = (await listPeriodsOfSchools(tx, [anchor.schoolId])).get(anchor.schoolId) ?? [];
    if (!periods.some((p) => p.periodNo === fromPeriod)) throw fail("fromPeriod", MSG.periodUnknown);
    if (!periods.some((p) => p.periodNo === toPeriod)) throw fail("toPeriod", MSG.periodUnknown);
  }

  // The live link and the child's profile row, locked: an unlink in flight is waited for and then seen (NOT_FOUND), and two
  // guardians of one child asking at once read each other's request below.
  const link = await tx.execute<{ id: string }>(sql`
    select gl.id from iam.guardian_link gl
    where gl.guardian_person_id = ${ctx.personId}::uuid and gl.student_profile_id = ${child.studentProfileId}::uuid and gl.status = 'active'
    for no key update`);
  if (link.rows.length === 0) throw notFound();
  await tx.execute(sql`select sp.id from iam.student_profile sp where sp.id = ${child.studentProfileId}::uuid for no key update`);

  const live = await tx
    .select({ fromDate: leaveRequest.fromDate, toDate: leaveRequest.toDate, fromPeriod: leaveRequest.fromPeriod, toPeriod: leaveRequest.toPeriod, status: leaveRequest.status })
    .from(leaveRequest)
    .where(
      and(
        eq(leaveRequest.studentProfileId, child.studentProfileId),
        inArray(leaveRequest.status, ["pending", "approved"]),
        lte(leaveRequest.fromDate, input.toDate),
        gte(leaveRequest.toDate, input.fromDate),
      ),
    );
  const span = { fromDate: input.fromDate, toDate: input.toDate, fromPeriod, toPeriod };
  if (live.some((l) => leavesOverlap(l, span))) throw fail("fromDate", MSG.overlap);
  const pending = await tx
    .select({ id: leaveRequest.id })
    .from(leaveRequest)
    .where(and(eq(leaveRequest.studentProfileId, child.studentProfileId), eq(leaveRequest.status, "pending")));
  if (pending.length >= LEAVE_MAX_PENDING) throw fail("fromDate", MSG.tooManyPending);

  const [row] = await tx
    .insert(leaveRequest)
    .values({
      organizationId: ctx.orgId,
      schoolId: anchor.schoolId,
      studentProfileId: child.studentProfileId,
      requestedByPersonId: ctx.personId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      fromPeriod,
      toPeriod,
      category: input.category,
      note,
    })
    .returning({ id: leaveRequest.id });
  await audit(
    ctx,
    "academic.leave_request.requested",
    { schema: "academic", table: "leave_request", id: row.id },
    null,
    {
      studentProfileId: child.studentProfileId,
      schoolId: anchor.schoolId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      fromPeriod,
      toPeriod,
      category: input.category,
      noteLength: note === null ? 0 : note.length,
    },
    tx,
  );
  // «مرکز درخواست‌ها»: the request's response clock starts now (the school's `requests.sla_hours.leave_request`), whether
  // or not the center is on — as for every request (src/modules/workspace/requests.ts).
  await openRequestSla(tx, ctx, { kind: "leave_request", leaveRequestId: row.id, schoolId: anchor.schoolId });

  // The school's managers hear of it — those who may decide it there: the child's name and the kind of event, nothing else.
  const managers = await lockActivePersons(tx, allDeciders(await leaveDeciders(tx, anchor.schoolId, ctx.personId)));
  const notified =
    managers.length === 0
      ? 0
      : await notifyMany(tx, ctx, managers, {
          typeCode: "academic.leave_requested",
          title: leaveRequestedTitle(`${anchor.firstName} ${anchor.lastName}`),
          body: null,
          payload: { studentProfileId: child.studentProfileId, schoolId: anchor.schoolId },
          sourceKind: "leave_request",
          sourceId: row.id,
          deepLink: `/admin/leave?school=${anchor.schoolId}`,
          dedupeKey: (personId) => `leave:requested:${row.id}:${personId}`,
        });
  return { id: row.id, notified };
}

/** Cancels the caller's OWN pending request. NOT_FOUND for anyone else's, another child's or a stale link. */
export async function cancelLeave(tx: Tx, ctx: GuardianLeaveCtx, input: { id: string }): Promise<{ id: string }> {
  const [row] = await tx
    .select({ id: leaveRequest.id, studentProfileId: leaveRequest.studentProfileId, requestedBy: leaveRequest.requestedByPersonId })
    .from(leaveRequest)
    .where(eq(leaveRequest.id, input.id))
    .limit(1);
  if (!row || row.requestedBy !== ctx.personId) throw notFound();
  // The child must still be one of the caller's live children (an ended link ends the right to touch its requests).
  const { child } = await requireChild(tx, ctx, row.studentProfileId, GUARDIAN_LEAVE_PERMISSION);
  if (child.studentProfileId !== row.studentProfileId) throw notFound();
  const done = await tx
    .update(leaveRequest)
    .set({ status: "cancelled" })
    .where(and(eq(leaveRequest.id, row.id), eq(leaveRequest.status, "pending")))
    .returning({ id: leaveRequest.id });
  if (done.length === 0) throw fail("id", MSG.notPending);
  await closeLeaveRequestClock(tx, row.id);
  await audit(ctx, "academic.leave_request.cancelled", { schema: "academic", table: "leave_request", id: row.id }, { status: "pending" }, { status: "cancelled", studentProfileId: row.studentProfileId }, tx);
  return { id: row.id };
}
