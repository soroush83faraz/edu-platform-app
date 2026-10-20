// academic/session-report — «دفتر کلاسی — گزارش جلسه»: the end-of-session report a دبیر writes for ONE session (the
// roll call's cell: class × date × زنگ, with the درس the timetable puts there), and the list of past reports on the
// subject page. Same shape as attendance: `(tx, ctx, input)` inside the caller's tenant transaction, explicit column
// selects, `audit()` in every mutation, the scope decided INSIDE the transaction — out of scope is NOT_FOUND, never
// FORBIDDEN (docs/admin.md «قانون دامنه»).
//
// WHO WRITES: exactly who may take the roll call of that cell — `academic.session_report.write` at the class (the
// school's admins) or at the درس of that زنگ (its teacher). The same `allowed()` and `resolveOffering()` as attendance.
// WHO READS: whoever opens the subject page (`openOffering`: the offering's teacher, a student of its class, a holder
// of `academic.timetable.read` there). The private «یادداشت دبیر» is selected from the database ONLY for a holder of the
// write permission at that class / درس; everyone else's query returns a SQL `null` in its place, so the text never
// reaches the service's memory, let alone a page. The audit rows carry ids and text lengths, never the text.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { isFutureIso, isValidIsoDate } from "@/lib/attendance";
import { AppError, notFound, validation } from "@/lib/errors";
import {
  SESSION_REPORT_LIMITS,
  SESSION_REPORT_MESSAGES,
  cleanReportLine,
  cleanReportNote,
  reportAuditShape,
  shapeSessionReport,
  type SessionReportPublic,
  type SessionReportStaff,
} from "@/lib/session-report";
import { canBroadly } from "@/modules/iam/can";
import { canViewWorkItem } from "@/modules/workspace/service";
import { workItem } from "@/modules/workspace/schema";
import { ATTENDANCE_MESSAGES, allowed, resolveOffering, type AttendanceCtx } from "./attendance";
import { listPeriodsOfSchools } from "./repo";
import { sessionReport } from "./schema";
import { findClassGroupFacts, openOffering } from "./service";

export type SessionReportCtx = AttendanceCtx;

const WRITE = "academic.session_report.write" as const;
/** The longest list the subject page asks for (one school year of a 4-lesson-a-week subject is ~150). */
const LIST_LIMIT = 60;
/** The تکلیف choices of the form. */
const CHOICES_LIMIT = 40;

function fail(field: string, message: string): never {
  throw validation({ fieldErrors: { [field]: [message] } }, message);
}

// ---------------------------------------------------------------------------------------------------------------
// the تکلیف of a session
// ---------------------------------------------------------------------------------------------------------------

export interface WorkItemChoice {
  id: string;
  title: string;
}

/**
 * The تکلیف rows a writer may link: items of THIS درس, not archived, not confidential, that the caller gave
 * (`created_by_person_id`) or — for a broad holder of `workspace.work_item.update` (the school's admins) — any of them.
 * One rule for the form's select and for the check on save, so a forged id is refused exactly like an unlisted one.
 */
function choiceFilter(ctx: SessionReportCtx, offeringId: string) {
  const mine = canBroadly(ctx.assignments, "workspace.work_item.update") ? sql`true` : eq(workItem.createdByPersonId, ctx.personId);
  return and(eq(workItem.classOfferingId, offeringId), eq(workItem.isConfidential, false), sql`${workItem.archivedAt} is null`, mine);
}

async function listWorkItemChoices(tx: Tx, ctx: SessionReportCtx, offeringId: string): Promise<WorkItemChoice[]> {
  return tx
    .select({ id: workItem.id, title: workItem.title })
    .from(workItem)
    .where(choiceFilter(ctx, offeringId))
    .orderBy(desc(workItem.createdAt))
    .limit(CHOICES_LIMIT);
}

async function assertChoosable(tx: Tx, ctx: SessionReportCtx, offeringId: string, workItemId: string): Promise<void> {
  const [row] = await tx
    .select({ id: workItem.id })
    .from(workItem)
    .where(and(eq(workItem.id, workItemId), choiceFilter(ctx, offeringId)))
    .limit(1);
  if (!row) fail("workItemId", SESSION_REPORT_MESSAGES.workItemInvalid);
}

// ---------------------------------------------------------------------------------------------------------------
// the cell
// ---------------------------------------------------------------------------------------------------------------

interface ReportRow {
  id: string;
  classOfferingId: string;
  topic: string;
  pageRef: string | null;
  workItemId: string | null;
  privateNote: string | null;
  nextPlan: string | null;
  status: string;
}

/** The (active or archived) report of a cell, with the private note — callers have already passed the write gate. */
async function findReportOfCell(tx: Tx, classGroupId: string, date: string, periodNo: number): Promise<ReportRow | null> {
  const [row] = await tx
    .select({
      id: sessionReport.id,
      classOfferingId: sessionReport.classOfferingId,
      topic: sessionReport.topic,
      pageRef: sessionReport.pageRef,
      workItemId: sessionReport.workItemId,
      privateNote: sessionReport.privateNote,
      nextPlan: sessionReport.nextPlan,
      status: sessionReport.status,
    })
    .from(sessionReport)
    .where(and(eq(sessionReport.classGroupId, classGroupId), eq(sessionReport.date, date), eq(sessionReport.periodNo, periodNo)))
    .limit(1);
  return row ?? null;
}

function requireDate(date: string): string {
  if (!isValidIsoDate(date)) fail("date", SESSION_REPORT_MESSAGES.badDate);
  return date;
}

/** Facts every cell operation starts from: the class, the date (never the future), the زنگ, the درس of that زنگ. */
async function openCell(tx: Tx, ctx: SessionReportCtx, input: { classGroupId: string; date: string; periodNo: number; classOfferingId?: string | null }, now: Date) {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg) throw notFound();
  const date = requireDate(input.date);
  if (isFutureIso(date, now)) fail("date", SESSION_REPORT_MESSAGES.futureDate);
  const periods = (await listPeriodsOfSchools(tx, [cg.schoolId])).get(cg.schoolId) ?? [];
  if (!periods.some((p) => p.periodNo === input.periodNo)) fail("periodNo", ATTENDANCE_MESSAGES.periodUnknown);
  const offeringId = await resolveOffering(tx, cg, date, input.periodNo, input.classOfferingId ?? null);
  // No درس at that زنگ and none named: nobody's offering scope can hold — admins get a precise message, others NOT_FOUND.
  if (offeringId === null) {
    if (!(await allowed(tx, ctx, WRITE, cg.id, null))) throw notFound();
    fail("periodNo", SESSION_REPORT_MESSAGES.noLesson);
  }
  if (!(await allowed(tx, ctx, WRITE, cg.id, offeringId))) throw notFound();
  return { cg, date, offeringId };
}

export interface SaveSessionReportInput {
  classGroupId: string;
  /** ISO `YYYY-MM-DD`, Tehran calendar; never in the future. */
  date: string;
  periodNo: number;
  /** The درس; when omitted it is resolved from the class's weekly timetable at that زنگ. */
  classOfferingId?: string | null;
  topic: string;
  pageRef?: string | null;
  workItemId?: string | null;
  privateNote?: string | null;
  nextPlan?: string | null;
}

export interface SaveSessionReportResult {
  reportId: string;
  created: boolean;
}

/**
 * Upserts the report of ONE session (natural key `(class_group, date, period_no)` — writing again UPDATES the row, also
 * one that was cleared). Validates like the roll call (date never in the future, the زنگ exists, the درس belongs to the
 * class), then the texts (cleaned, bounded) and the linked تکلیف (of this درس, the caller's own — or any, for the school's
 * admins). The author is always the session's person; the audit row keeps ids and text lengths only.
 */
export async function saveSessionReport(tx: Tx, ctx: SessionReportCtx, input: SaveSessionReportInput, now = new Date()): Promise<SaveSessionReportResult> {
  const { cg, date, offeringId } = await openCell(tx, ctx, input, now);

  const topic = cleanReportLine(input.topic);
  if (topic === null) fail("topic", SESSION_REPORT_MESSAGES.topicRequired);
  if (topic.length > SESSION_REPORT_LIMITS.topic) fail("topic", SESSION_REPORT_MESSAGES.topicTooLong);
  const pageRef = cleanReportLine(input.pageRef);
  if (pageRef !== null && pageRef.length > SESSION_REPORT_LIMITS.pageRef) fail("pageRef", SESSION_REPORT_MESSAGES.pageRefTooLong);
  const privateNote = cleanReportNote(input.privateNote);
  if (privateNote !== null && privateNote.length > SESSION_REPORT_LIMITS.privateNote) fail("privateNote", SESSION_REPORT_MESSAGES.privateNoteTooLong);
  const nextPlan = cleanReportLine(input.nextPlan);
  if (nextPlan !== null && nextPlan.length > SESSION_REPORT_LIMITS.nextPlan) fail("nextPlan", SESSION_REPORT_MESSAGES.nextPlanTooLong);
  const workItemId = input.workItemId ?? null;
  if (workItemId !== null) await assertChoosable(tx, ctx, offeringId, workItemId);

  const before = await findReportOfCell(tx, cg.id, date, input.periodNo);
  // A cell whose درس changed since the report was written (the timetable moved): the caller must also hold the write
  // permission at the report's own درس, or one teacher could overwrite another's report by timetable luck.
  if (before && before.classOfferingId !== offeringId && !(await allowed(tx, ctx, WRITE, cg.id, before.classOfferingId))) throw notFound();

  const values = { classOfferingId: offeringId, topic, pageRef, workItemId, privateNote, nextPlan, authorPersonId: ctx.personId, status: "active", archivedAt: null };
  const cell = { classGroupId: cg.id, date, periodNo: input.periodNo };
  let reportId: string;
  if (before) {
    await tx.update(sessionReport).set(values).where(eq(sessionReport.id, before.id));
    reportId = before.id;
  } else {
    const [row] = await tx
      .insert(sessionReport)
      .values({ organizationId: ctx.orgId, classGroupId: cg.id, date, periodNo: input.periodNo, ...values })
      .returning({ id: sessionReport.id });
    reportId = row.id;
  }

  await audit(
    ctx,
    before ? "academic.session_report.updated" : "academic.session_report.created",
    { schema: "academic", table: "session_report", id: reportId },
    before ? { ...reportAuditShape({ ...cell, ...before }), status: before.status } : null,
    { ...reportAuditShape({ ...cell, classOfferingId: offeringId, workItemId, topic, pageRef, privateNote, nextPlan }), status: "active" },
    tx,
  );
  return { reportId, created: before === null };
}

/** «پاک‌کردن گزارش»: the report of a cell is withdrawn (status `archived`), never deleted; re-saving brings it back. */
export async function clearSessionReport(tx: Tx, ctx: SessionReportCtx, input: { classGroupId: string; date: string; periodNo: number }, now = new Date()): Promise<{ reportId: string }> {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg) throw notFound();
  const date = requireDate(input.date);
  const existing = await findReportOfCell(tx, cg.id, date, input.periodNo);
  // The gate is the REPORT's own درس (the timetable may have moved on): admins at the class, its teacher at the درس.
  if (!existing || !(await allowed(tx, ctx, WRITE, cg.id, existing.classOfferingId))) throw notFound();
  if (existing.status === "archived") fail("periodNo", SESSION_REPORT_MESSAGES.nothingToClear);
  await tx.update(sessionReport).set({ status: "archived", archivedAt: now }).where(eq(sessionReport.id, existing.id));
  await audit(
    ctx,
    "academic.session_report.cleared",
    { schema: "academic", table: "session_report", id: existing.id },
    { ...reportAuditShape({ classGroupId: cg.id, date, periodNo: input.periodNo, ...existing }), status: "active" },
    { status: "archived" },
    tx,
  );
  return { reportId: existing.id };
}

export interface SessionReportCell {
  /** The درس of that زنگ (what the report is about). */
  offeringId: string;
  /** The saved, active report with the private note — null when none. */
  report: SessionReportStaff | null;
  /** The caller's تکلیف choices for the form. */
  workItems: WorkItemChoice[];
}

/**
 * The «گزارش جلسه» card of the roll-call page: null unless the caller may WRITE the report of this cell (a date in the
 * future, a زنگ without a درس, or a class that is not theirs → no card). Never throws for a missing report.
 */
export async function getSessionReportCell(tx: Tx, ctx: SessionReportCtx, input: { classGroupId: string; date: string; periodNo: number }, now = new Date()): Promise<SessionReportCell | null> {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg || !isValidIsoDate(input.date) || isFutureIso(input.date, now)) return null;
  const offeringId = await resolveOffering(tx, cg, input.date, input.periodNo, null);
  if (offeringId === null || !(await allowed(tx, ctx, WRITE, cg.id, offeringId))) return null;
  const row = await findReportOfCell(tx, cg.id, input.date, input.periodNo);
  const report: SessionReportStaff | null =
    row && row.status === "active"
      ? { id: row.id, date: input.date, periodNo: input.periodNo, topic: row.topic, pageRef: row.pageRef, nextPlan: row.nextPlan, privateNote: row.privateNote, workItem: null }
      : null;
  const workItems = await listWorkItemChoices(tx, ctx, offeringId);
  if (report && row?.workItemId) report.workItem = workItems.find((w) => w.id === row.workItemId) ?? { id: row.workItemId, title: "" };
  return { offeringId, report, workItems };
}

// ---------------------------------------------------------------------------------------------------------------
// the subject page
// ---------------------------------------------------------------------------------------------------------------

export interface OfferingSessionReport {
  report: SessionReportPublic | SessionReportStaff;
  /** The زنگ's name in the school's زنگ‌بندی («زنگ دوم»), null if the bell was removed since. */
  periodLabel: string | null;
}

export interface OfferingSessionReports {
  reports: OfferingSessionReport[];
  /** Whether the private «یادداشت دبیر» was included (the caller holds the write permission here). */
  includesPrivate: boolean;
}

/**
 * «دفتر کلاسی» of the subject page: the active reports of one درس, newest first. The gate is the subject page's own
 * (`openOffering`: its teacher, a student of its class, a holder of `academic.timetable.read` there; else NOT_FOUND).
 * The private note is selected only for a holder of the write permission at the class / درس; a linked تکلیف is shown
 * only when THIS viewer may open it (`canViewWorkItem`) — a title never reaches someone the تکلیف was not given to.
 */
export async function listOfferingSessionReports(tx: Tx, ctx: SessionReportCtx, offeringId: string): Promise<OfferingSessionReports> {
  const { offering } = await openOffering(tx, ctx, offeringId);
  const includesPrivate = await allowed(tx, ctx, WRITE, offering.classGroupId, offering.id);
  const rows = await tx
    .select({
      id: sessionReport.id,
      date: sql<string>`${sessionReport.date}::text`,
      periodNo: sessionReport.periodNo,
      topic: sessionReport.topic,
      pageRef: sessionReport.pageRef,
      nextPlan: sessionReport.nextPlan,
      workItemId: sessionReport.workItemId,
      // For a reader without the permission the column is never read from the table.
      privateNote: includesPrivate ? sessionReport.privateNote : sql<string | null>`null::text`,
    })
    .from(sessionReport)
    .where(and(eq(sessionReport.classOfferingId, offering.id), eq(sessionReport.status, "active")))
    .orderBy(desc(sessionReport.date), desc(sessionReport.periodNo))
    .limit(LIST_LIMIT);

  const periods = (await listPeriodsOfSchools(tx, [offering.schoolId])).get(offering.schoolId) ?? [];
  const titles = new Map<string, string | null>();
  for (const id of new Set(rows.flatMap((r) => (r.workItemId ? [r.workItemId] : [])))) {
    try {
      titles.set(id, (await canViewWorkItem(tx, ctx, id)).title);
    } catch (err) {
      if (!(AppError.is(err) && err.code === "NOT_FOUND")) throw err;
      titles.set(id, null);
    }
  }
  const reports = rows.map((r) => {
    const title = r.workItemId ? titles.get(r.workItemId) : null;
    const staff: SessionReportStaff = {
      id: r.id,
      date: r.date,
      periodNo: Number(r.periodNo),
      topic: r.topic,
      pageRef: r.pageRef,
      nextPlan: r.nextPlan,
      workItem: r.workItemId && title ? { id: r.workItemId, title } : null,
      privateNote: r.privateNote,
    };
    return { report: shapeSessionReport(staff, includesPrivate), periodLabel: periods.find((p) => p.periodNo === Number(r.periodNo))?.label ?? null };
  });
  return { reports, includesPrivate };
}
