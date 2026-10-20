// workspace/requests — «مرکز درخواست‌ها» (flag `request_center`, organization-level; owner 2026-10-20, docs/decisions.md
// «یادآوری مهلت و مرکز درخواست‌ها»; the rules are ./request-sla.ts). `(tx, ctx, input)`.
//
//   • `openRequestSla` — in the transaction that SENDS a request (counseling `referToManagement`, iam
//     `sendGuardianMessage`, iam `requestLeave`): one `workspace.request_sla` row, its first period = the kind's response
//     time at the school. Always written, flag or not: turning the center on later finds every request sent since this
//     release with its true clock (one sent before it has none — docs/decisions.md).
//   • The clock follows the request's status as it changes (./request-clock, in the same transaction): «در حال بررسی»
//     STOPS it (`paused_at`), «باز» runs it again (the paused time moves the deadline on), an answer closes it.
//   • `checkRequestSlas` — the `workspace.check_request_slas` job (every 15 minutes, system actor, one organization;
//     nothing while the flag is off). Per open, RUNNING request whose period reached its 80 % mark of ACTIVE time:
//     answered or closed meanwhile → `closed_at`, the clock stops; «در حال بررسی» without a stopped clock (moved there
//     before this release) → stopped now; inside the school's quiet hours → left for the first check after them; else
//     – at 80 %: the live addressees are reminded once per period («یادآوری: پاسخ به «…» تا …»); audited
//       `workspace.request.sla_warned`;
//     – at the end: ESCALATED — the next level of the chain (معاون → مدیر مدرسه → مدیر سازمان, above the highest level
//       a live addressee holds at the school, never above the kind's top: a guardian's message or leave request stops
//       at the principal — owner, 2026-10-20) is ADDED: for a work item an assignee row, an unread inbox row and the bell
//       «ارجاع خودکار: «…»» — the earlier addressees keep theirs; a new period starts; audited
//       `workspace.request.escalated` (ids and levels only). Nobody left to add → a new period for the same
//       addressees (`workspace.request.sla_renewed`).
//     A confidential request reaches the person added in full: they become a participant, as the first addressees
//     were — that is what an escalation is. The bell carries the item's title only, never its text (a referral's
//     description, a guardian's words).
//   • A LEAVE REQUEST (academic.leave_request; no work item) has its own addressee reader: the school's vice principals
//     (`leaveDeciders` — whoever holds `academic.leave.decide` AT the school; no vice principal → the principal); its one
//     escalation ADDS the principal (no assignee row: the addressees are read again at every check); past the principal,
//     a new period. Open = still `pending` (a decision or the guardian's withdrawal closes it, academic/leave). Its bells
//     name the child only («درخواست مرخصی: <نام>»), never the dates, the reason or a note, and open the school's queue.
//   • `requestCenterView` — the managers' page (`iam.admin.access`, their schools): every OPEN request with its kind,
//     school, age, status (در مهلت / نزدیک مهلت / گذشته, frozen while «در حال بررسی»), escalations and current
//     addressees. A confidential request's TITLE shows only to a participant of it (an addressee — `canViewWorkItem`'s
//     rule); a leave request's only to someone who may decide it there (`holdsAtSchool`); anyone else reads
//     «درخواست محرمانه» and gets no link (docs/decisions.md: the kind, the age and who holds it are what a manager needs
//     to follow up; the title of a counselor's referral names a student and a subject).
//
// LOCKS (iam/removal «Concurrency»: person rows → work item rows): an escalation takes the candidates' person rows FOR
// KEY SHARE SKIP LOCKED (one being removed is passed over), then the work item (a leave request: its row) FOR NO KEY
// UPDATE SKIP LOCKED (an answer in flight → this check leaves it to the next one), then re-reads the request and its
// addressees.
import { eq, sql } from "drizzle-orm";
import type { Ctx, Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { formatDeadlineAtFa } from "@/lib/format";
import { leaveRequestedTitle } from "@/lib/leave";
import { leaveDeciders, type LeaveDeciders } from "@/modules/academic/leave-deciders";
import { flagEnabled, settingOf } from "@/modules/config/service";
import { holdsAtSchool } from "@/modules/iam/can";
import { COUNSELOR_MESSAGES_HREF } from "@/modules/iam/guardian-message-policy";
import { officeHolders } from "@/modules/iam/guardian-message-routing";
import { getAdminScope } from "@/modules/iam/service";
import { notifyMany } from "@/modules/notif/service";
import { inQuietHours } from "@/modules/notif/quiet-hours";
import {
  CONFIDENTIAL_REQUEST_TITLE,
  LEVELS,
  type Level,
  REQUEST_KINDS,
  type RequestKind,
  type SlaStatus,
  type WorkItemRequestKind,
  currentLevel,
  isRequestKind,
  levelOf,
  nextLevel,
  nextPeriod,
  slaAction,
  slaStatus,
} from "./request-sla";
import { inboxEntry, requestSla, workItem, workItemAssignee } from "./schema";

const sqlList = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
/** A person id no row carries — `leaveDeciders` without anyone to leave out. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------------------------------------------
// opening a request's clock
// ---------------------------------------------------------------------------------------------------------------

export type OpenRequestInput =
  | { kind: WorkItemRequestKind; workItemId: string; schoolId: string }
  | { kind: "leave_request"; leaveRequestId: string; schoolId: string };

/** The clock of a request just sent, in the sending transaction. Idempotent per work item / leave request. */
export async function openRequestSla(tx: Tx, ctx: { orgId: string }, input: OpenRequestInput): Promise<void> {
  const hours = await settingOf(tx, REQUEST_KINDS[input.kind].settingKey, input.schoolId);
  await tx
    .insert(requestSla)
    .values({
      organizationId: ctx.orgId,
      schoolId: input.schoolId,
      kind: input.kind,
      workItemId: input.kind === "leave_request" ? null : input.workItemId,
      leaveRequestId: input.kind === "leave_request" ? input.leaveRequestId : null,
      openedAt: sql`now()`,
      periodStartedAt: sql`now()`,
      dueAt: sql`now() + make_interval(hours => ${hours}::int)`,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------------------------------------------
// the check (job)
// ---------------------------------------------------------------------------------------------------------------

/** Requests one check handles at most (the earliest deadline first; the next check continues). */
const CHECK_LIMIT = 100;

export type RequestCheckCtx = AuditCtx & { orgId: string };

export interface CheckReport {
  warned: number;
  escalated: number;
  renewed: number;
  closed: number;
  skipped: number;
  /** Found «در حال بررسی» with a running clock (moved there before the clock followed the status) and stopped now. */
  paused: number;
}

interface SlaRowBase {
  id: string;
  schoolId: string;
  periodStartedAt: Date;
  dueAt: Date;
  warnedAt: Date | null;
  escalationLevel: number;
  pausedSeconds: number;
}

type WorkItemSlaRow = SlaRowBase & { kind: WorkItemRequestKind; workItemId: string };
type LeaveSlaRow = SlaRowBase & { kind: "leave_request"; leaveRequestId: string };
type SlaRow = WorkItemSlaRow | LeaveSlaRow;

interface ItemNow {
  open: boolean;
  category: string;
  title: string;
  creatorId: string;
}

async function itemNow(tx: Tx, workItemId: string): Promise<ItemNow | null> {
  const res = await tx.execute<{ open: boolean; category: string; title: string; created_by_person_id: string }>(sql`
    select (wi.archived_at is null and s.category in ('todo', 'doing')) as open, s.category, wi.title, wi.created_by_person_id
    from workspace.work_item wi join workspace.work_item_status s on s.id = wi.status_id
    where wi.id = ${workItemId}::uuid`);
  const r = res.rows[0];
  return r ? { open: r.open === true, category: r.category, title: r.title, creatorId: r.created_by_person_id } : null;
}

/** Every `assignee` of the item, and whether each is still an active person. */
async function addresseesOf(tx: Tx, workItemId: string): Promise<{ all: string[]; live: string[] }> {
  const res = await tx.execute<{ person_id: string; active: boolean }>(sql`
    select a.person_id, (p.status = 'active') as active
    from workspace.work_item_assignee a join iam.person p on p.id = a.person_id
    where a.work_item_id = ${workItemId}::uuid and a.role = 'assignee'
    order by a.person_id`);
  return { all: res.rows.map((r) => r.person_id), live: res.rows.filter((r) => r.active).map((r) => r.person_id) };
}

/** The chain level of each person: the SYSTEM roles they hold, live, at the school (or, «مدیر سازمان», at the organization). */
async function levelsAt(tx: Tx, schoolId: string, personIds: readonly string[]): Promise<Level[]> {
  if (personIds.length === 0) return [];
  const res = await tx.execute<{ person_id: string; codes: string[] }>(sql`
    select ra.person_id, array_agg(distinct r.code) as codes
    from iam.role_assignment ra
    join iam.role r on r.id = ra.role_id and r.organization_id is null
    where ra.person_id = any(${sqlList(personIds)})
      and r.code in ('vice_principal', 'school_principal', 'org_admin')
      and ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and ((r.code = 'org_admin' and ra.scope_type = 'organization')
           or (ra.scope_type = 'school' and ra.school_id = ${schoolId}::uuid)
           or (ra.scope_type = 'branch' and exists (select 1 from tenancy.branch b where b.id = ra.branch_id and b.school_id = ${schoolId}::uuid)))
    group by ra.person_id`);
  const byPerson = new Map(res.rows.map((r) => [r.person_id, r.codes]));
  return personIds.map((id) => levelOf(byPerson.get(id) ?? []));
}

/** The live organization admins (the SYSTEM role «مدیر سازمان» at the organization), never `exceptPersonId`. */
async function organizationAdmins(tx: Tx, exceptPersonId: string): Promise<string[]> {
  const res = await tx.execute<{ person_id: string }>(sql`
    select distinct ra.person_id
    from iam.role_assignment ra
    join iam.role r on r.id = ra.role_id and r.organization_id is null and r.code = 'org_admin'
    join iam.person p on p.id = ra.person_id and p.status = 'active'
    where ra.scope_type = 'organization' and ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and ra.person_id <> ${exceptPersonId}::uuid
    order by ra.person_id`);
  return res.rows.map((r) => r.person_id);
}

/** Of `ids`, the ones whose person rows this transaction could take FOR KEY SHARE without waiting (active ones). */
async function lockPersons(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const res = await tx.execute<{ id: string }>(sql`
    select id from iam.person where id = any(${sqlList([...ids].sort())}) and status = 'active'
    order by id for key share skip locked`);
  return new Set(res.rows.map((r) => r.id));
}

type RawSlaRow = {
  id: string;
  school_id: string;
  kind: string;
  work_item_id: string | null;
  leave_request_id: string | null;
  period_started_at: string;
  due_at: string;
  warned_at: string | null;
  escalation_level: number;
  paused_seconds: number;
};

function rowOf(r: RawSlaRow): SlaRow | null {
  if (!isRequestKind(r.kind)) return null;
  const base: SlaRowBase = {
    id: r.id,
    schoolId: r.school_id,
    periodStartedAt: new Date(r.period_started_at),
    dueAt: new Date(r.due_at),
    warnedAt: r.warned_at ? new Date(r.warned_at) : null,
    escalationLevel: Number(r.escalation_level),
    pausedSeconds: Number(r.paused_seconds),
  };
  if (r.kind === "leave_request") return r.leave_request_id ? { ...base, kind: "leave_request", leaveRequestId: r.leave_request_id } : null;
  return r.work_item_id ? { ...base, kind: r.kind, workItemId: r.work_item_id } : null;
}

/**
 * A safety net for stopped clocks: one whose work item was answered, cancelled or archived without the status hook
 * closing it is closed now. (Every status change goes through ./service `setItemStatus`, which keeps the clock in
 * step; this only guards against a path that bypasses it.) Rows another transaction holds are left for the next check.
 */
async function closeStalePaused(tx: Tx, at: string): Promise<number> {
  const res = await tx.execute<{ id: string }>(sql`
    update workspace.request_sla rs set closed_at = ${at}::timestamptz, paused_at = null
    where rs.id in (
      select x.id
      from workspace.request_sla x
      join workspace.work_item wi on wi.id = x.work_item_id
      join workspace.work_item_status s on s.id = wi.status_id
      where x.closed_at is null and x.paused_at is not null
        and (wi.archived_at is not null or s.category in ('done', 'cancelled'))
      for update of x skip locked)
    returning rs.id`);
  return res.rows.length;
}

export async function checkRequestSlas(tx: Tx, ctx: RequestCheckCtx, now: Date = new Date()): Promise<CheckReport> {
  const report: CheckReport = { warned: 0, escalated: 0, renewed: 0, closed: 0, skipped: 0, paused: 0 };
  if (!(await flagEnabled(tx, "request_center"))) return report;
  const at = now.toISOString();
  report.closed += await closeStalePaused(tx, at);
  // The RUNNING rows whose period reached its 80 % mark of active time (`due_at` minus a fifth of the active length —
  // request-sla `warnAt`, WARN_FRACTION 0.8) and that still have something to do (a reminder not sent in this period, or
  // the end of it) — locked, so an overlapping run of this job skips them. A stopped clock («در حال بررسی») is not read.
  const res = await tx.execute<RawSlaRow>(sql`
    select id, school_id, kind, work_item_id, leave_request_id, period_started_at, due_at, warned_at, escalation_level, paused_seconds
    from workspace.request_sla
    where closed_at is null and paused_at is null
      and (work_item_id is not null or leave_request_id is not null)
      and due_at - (due_at - period_started_at - make_interval(secs => paused_seconds)) * 0.2 <= ${at}::timestamptz
      and (due_at <= ${at}::timestamptz or warned_at is null or warned_at < period_started_at)
    order by due_at, id
    limit ${CHECK_LIMIT}
    for update skip locked`);
  for (const raw of res.rows) {
    const row = rowOf(raw);
    if (!row) continue;
    if (row.kind === "leave_request") await checkLeave(tx, ctx, row, now, report);
    else await checkWorkItem(tx, ctx, row, now, report);
  }
  return report;
}

async function checkWorkItem(tx: Tx, ctx: RequestCheckCtx, row: WorkItemSlaRow, now: Date, report: CheckReport): Promise<void> {
  const item = await itemNow(tx, row.workItemId);
  if (!item || !item.open) {
    await tx.update(requestSla).set({ closedAt: now, pausedAt: null }).where(eq(requestSla.id, row.id));
    report.closed++;
    return;
  }
  if (item.category === "doing") {
    // «در حال بررسی» already: the clock stops from now (the status changed before the clock followed it).
    await tx.update(requestSla).set({ pausedAt: now }).where(eq(requestSla.id, row.id));
    report.paused++;
    return;
  }
  if (inQuietHours(now, await settingOf(tx, "notif.quiet_hours", row.schoolId))) {
    report.skipped++;
    return;
  }
  const action = slaAction(row, now);
  if (action === "warn") {
    await warn(tx, ctx, row, item, now);
    report.warned++;
  } else if (action === "escalate") {
    const out = await escalate(tx, ctx, row, item, now);
    report[out]++;
  }
}

/** Where a bell about this request takes its addressee: a counselor answers a guardian's message in «مشاوره». */
async function deepLinksOf(tx: Tx, row: WorkItemSlaRow, creatorId: string, personIds: readonly string[]): Promise<{ counselors: string[]; others: string[] }> {
  if (row.kind !== "parent_message") return { counselors: [], others: [...personIds] };
  const counselors = new Set((await officeHolders(tx, row.schoolId, creatorId)).counselor);
  return { counselors: personIds.filter((id) => counselors.has(id)), others: personIds.filter((id) => !counselors.has(id)) };
}

async function warn(tx: Tx, ctx: RequestCheckCtx, row: WorkItemSlaRow, item: ItemNow, now: Date): Promise<void> {
  const { live } = await addresseesOf(tx, row.workItemId);
  const links = await deepLinksOf(tx, row, item.creatorId, live);
  const base = {
    typeCode: "work_item.response_due" as const,
    title: `یادآوری: پاسخ به «${item.title}» تا ${formatDeadlineAtFa(row.dueAt, now)}`,
    sourceKind: "work_item",
    sourceId: row.workItemId,
    payload: { requestSlaId: row.id, dueAt: row.dueAt.toISOString() },
    dedupeKey: () => `wi:${row.workItemId}:response_due:${row.periodStartedAt.toISOString()}`,
  };
  let sent = await notifyMany(tx, ctx, links.others, { ...base, deepLink: `/inbox/${row.workItemId}` });
  sent += await notifyMany(tx, ctx, links.counselors, { ...base, deepLink: COUNSELOR_MESSAGES_HREF });
  await tx.update(requestSla).set({ warnedAt: now }).where(eq(requestSla.id, row.id));
  await audit(
    ctx,
    "workspace.request.sla_warned",
    { schema: "workspace", table: "request_sla", id: row.id },
    null,
    { kind: row.kind, workItemId: row.workItemId, schoolId: row.schoolId, escalationLevel: row.escalationLevel, dueAt: row.dueAt.toISOString(), recipients: sent },
    tx,
  );
}

async function escalate(tx: Tx, ctx: RequestCheckCtx, row: WorkItemSlaRow, item: ItemNow, now: Date): Promise<"escalated" | "renewed" | "skipped"> {
  const top = REQUEST_KINDS[row.kind].topLevel;
  // Plan without locks: who holds the item now, at which level, and who is above them (never above the kind's top: a
  // guardian's message stays in the school — owner, 2026-10-20).
  const before = await addresseesOf(tx, row.workItemId);
  const offices = await officeHolders(tx, row.schoolId, item.creatorId);
  const candidates = {
    vice_principal: offices.vice_principal,
    principal: offices.principal,
    org_admin: top === "org_admin" ? await organizationAdmins(tx, item.creatorId) : [],
  };
  const planned = nextLevel(currentLevel(await levelsAt(tx, row.schoolId, before.live)), candidates, new Set([...before.all, item.creatorId]), top);

  // Locks: persons → work item; then decide again on what is committed now.
  const locked = planned ? await lockPersons(tx, planned.personIds) : new Set<string>();
  const [held] = await tx.select({ id: workItem.id }).from(workItem).where(eq(workItem.id, row.workItemId)).for("no key update", { skipLocked: true });
  if (!held) return "skipped";
  const again = await itemNow(tx, row.workItemId);
  if (!again?.open || again.category !== "todo") return "skipped";
  const after = await addresseesOf(tx, row.workItemId);
  const current = new Set([...after.all, item.creatorId]);
  const added = planned ? planned.personIds.filter((id) => locked.has(id) && !current.has(id)).sort() : [];
  const hours = await settingOf(tx, REQUEST_KINDS[row.kind].settingKey, row.schoolId);
  const period = nextPeriod(now, hours);

  if (!planned || added.length === 0) {
    await renewPeriod(tx, ctx, row, period, { workItemId: row.workItemId });
    return "renewed";
  }

  await tx
    .insert(workItemAssignee)
    .values(added.map((personId) => ({ workItemId: row.workItemId, personId, organizationId: ctx.orgId, role: "assignee" as const, state: "pending" as const })))
    .onConflictDoNothing();
  await tx
    .insert(inboxEntry)
    .values(added.map((personId) => ({ organizationId: ctx.orgId, personId, workItemId: row.workItemId, relation: "assignee" as const, state: "unread" as const })))
    .onConflictDoUpdate({ target: [inboxEntry.personId, inboxEntry.workItemId], set: { relation: "assignee", state: "unread" } });
  await notifyMany(tx, ctx, added, {
    typeCode: "work_item.escalated",
    title: `ارجاع خودکار: «${item.title}»`,
    body: "مهلت پاسخ به این درخواست گذشت و به شما هم ارجاع شد.",
    sourceKind: "work_item",
    sourceId: row.workItemId,
    deepLink: `/inbox/${row.workItemId}`,
    payload: { requestSlaId: row.id, level: planned.level },
    dedupeKey: (personId) => `wi:${row.workItemId}:escalated:${personId}`,
  });
  const fromLevel = currentLevel(await levelsAt(tx, row.schoolId, after.live));
  await recordEscalation(tx, ctx, row, period, { workItemId: row.workItemId }, { fromLevel: fromLevel >= 0 ? LEVELS[fromLevel] : null, toLevel: planned.level, added, beforeAssignees: after.all });
  return "escalated";
}

type Period = ReturnType<typeof nextPeriod>;

/** Nobody (left) to add: a new period for the same addressees (they are reminded again at its 80 %). */
async function renewPeriod(tx: Tx, ctx: RequestCheckCtx, row: SlaRow, period: Period, subject: Record<string, string>): Promise<void> {
  await tx
    .update(requestSla)
    .set({ periodStartedAt: period.periodStartedAt, dueAt: period.dueAt, warnedAt: null, pausedSeconds: 0, pausedAt: null })
    .where(eq(requestSla.id, row.id));
  await audit(
    ctx,
    "workspace.request.sla_renewed",
    { schema: "workspace", table: "request_sla", id: row.id },
    { dueAt: row.dueAt.toISOString(), escalationLevel: row.escalationLevel, pausedSeconds: row.pausedSeconds },
    { kind: row.kind, ...subject, schoolId: row.schoolId, dueAt: period.dueAt.toISOString(), reason: "no_next_level" },
    tx,
  );
}

async function recordEscalation(
  tx: Tx,
  ctx: RequestCheckCtx,
  row: SlaRow,
  period: Period,
  subject: Record<string, string>,
  e: { fromLevel: Level | null; toLevel: Level; added: string[]; beforeAssignees?: string[] },
): Promise<void> {
  const level = Math.min(row.escalationLevel + 1, 10);
  await tx
    .update(requestSla)
    .set({ escalationLevel: level, escalatedAt: period.periodStartedAt, periodStartedAt: period.periodStartedAt, dueAt: period.dueAt, warnedAt: null, pausedSeconds: 0, pausedAt: null })
    .where(eq(requestSla.id, row.id));
  await audit(
    ctx,
    "workspace.request.escalated",
    { schema: "workspace", table: "request_sla", id: row.id },
    { escalationLevel: row.escalationLevel, dueAt: row.dueAt.toISOString(), pausedSeconds: row.pausedSeconds, ...(e.beforeAssignees ? { assigneeIds: e.beforeAssignees } : {}) },
    { kind: row.kind, ...subject, schoolId: row.schoolId, escalationLevel: level, fromLevel: e.fromLevel, toLevel: e.toLevel, addedPersonIds: e.added, dueAt: period.dueAt.toISOString() },
    tx,
  );
}

// --- a leave request ----------------------------------------------------------------------------------------------

interface LeaveNow {
  pending: boolean;
  requesterId: string;
  childName: string;
}

async function leaveNow(tx: Tx, leaveRequestId: string): Promise<LeaveNow | null> {
  const res = await tx.execute<{ status: string; requested_by_person_id: string; first_name: string; last_name: string }>(sql`
    select lr.status, lr.requested_by_person_id, sp.first_name, sp.last_name
    from academic.leave_request lr
    join iam.student_profile st on st.id = lr.student_profile_id
    join iam.person sp on sp.id = st.person_id
    where lr.id = ${leaveRequestId}::uuid`);
  const r = res.rows[0];
  return r ? { pending: r.status === "pending", requesterId: r.requested_by_person_id, childName: `${r.first_name} ${r.last_name}` } : null;
}

/**
 * A leave request's addressees at the school: its vice principals (no vice principal → its principal); once escalated,
 * vice principals AND principal. Read live from the school's offices at every check (no assignee rows).
 */
export function leaveAddressees(d: LeaveDeciders, escalated: boolean): { personIds: string[]; level: Exclude<Level, "staff"> | null } {
  if (escalated) {
    const all = [...new Set([...d.vice_principal, ...d.principal])].sort();
    return { personIds: all, level: d.principal.length > 0 ? "principal" : d.vice_principal.length > 0 ? "vice_principal" : null };
  }
  if (d.vice_principal.length > 0) return { personIds: [...d.vice_principal], level: "vice_principal" };
  return { personIds: [...d.principal], level: d.principal.length > 0 ? "principal" : null };
}

const leaveQueueHref = (schoolId: string) => `/admin/leave?school=${schoolId}`;

async function checkLeave(tx: Tx, ctx: RequestCheckCtx, row: LeaveSlaRow, now: Date, report: CheckReport): Promise<void> {
  const leave = await leaveNow(tx, row.leaveRequestId);
  if (!leave || !leave.pending) {
    await tx.update(requestSla).set({ closedAt: now, pausedAt: null }).where(eq(requestSla.id, row.id));
    report.closed++;
    return;
  }
  if (inQuietHours(now, await settingOf(tx, "notif.quiet_hours", row.schoolId))) {
    report.skipped++;
    return;
  }
  const action = slaAction(row, now);
  if (action === "warn") {
    await warnLeave(tx, ctx, row, leave, now);
    report.warned++;
  } else if (action === "escalate") {
    const out = await escalateLeave(tx, ctx, row, leave, now);
    report[out]++;
  }
}

async function warnLeave(tx: Tx, ctx: RequestCheckCtx, row: LeaveSlaRow, leave: LeaveNow, now: Date): Promise<void> {
  const { personIds } = leaveAddressees(await leaveDeciders(tx, row.schoolId, leave.requesterId), row.escalationLevel > 0);
  const sent = await notifyMany(tx, ctx, personIds, {
    typeCode: "work_item.response_due",
    title: `یادآوری: پاسخ به «${leaveRequestedTitle(leave.childName)}» تا ${formatDeadlineAtFa(row.dueAt, now)}`,
    sourceKind: "leave_request",
    sourceId: row.leaveRequestId,
    deepLink: leaveQueueHref(row.schoolId),
    payload: { requestSlaId: row.id, dueAt: row.dueAt.toISOString() },
    dedupeKey: () => `leave:${row.leaveRequestId}:response_due:${row.periodStartedAt.toISOString()}`,
  });
  await tx.update(requestSla).set({ warnedAt: now }).where(eq(requestSla.id, row.id));
  await audit(
    ctx,
    "workspace.request.sla_warned",
    { schema: "workspace", table: "request_sla", id: row.id },
    null,
    { kind: row.kind, leaveRequestId: row.leaveRequestId, schoolId: row.schoolId, escalationLevel: row.escalationLevel, dueAt: row.dueAt.toISOString(), recipients: sent },
    tx,
  );
}

async function escalateLeave(tx: Tx, ctx: RequestCheckCtx, row: LeaveSlaRow, leave: LeaveNow, now: Date): Promise<"escalated" | "renewed" | "skipped"> {
  // Plan: the one step of a leave request's chain — its vice principals → its principal (never further: owner, 2026-10-20).
  const deciders = await leaveDeciders(tx, row.schoolId, leave.requesterId);
  const before = leaveAddressees(deciders, row.escalationLevel > 0);
  const plannedAdd = row.escalationLevel === 0 && before.level === "vice_principal" ? deciders.principal.filter((id) => !before.personIds.includes(id)) : [];

  // Locks: persons → the leave request; then decide again on what is committed now.
  const locked = await lockPersons(tx, plannedAdd);
  const held = await tx.execute<{ id: string }>(sql`select id from academic.leave_request where id = ${row.leaveRequestId}::uuid for no key update skip locked`);
  if (held.rows.length === 0) return "skipped";
  const again = await leaveNow(tx, row.leaveRequestId);
  if (!again?.pending) return "skipped";
  const added = plannedAdd.filter((id) => locked.has(id)).sort();
  const hours = await settingOf(tx, REQUEST_KINDS.leave_request.settingKey, row.schoolId);
  const period = nextPeriod(now, hours);
  const subject = { leaveRequestId: row.leaveRequestId };

  if (added.length === 0) {
    await renewPeriod(tx, ctx, row, period, subject);
    return "renewed";
  }
  await notifyMany(tx, ctx, added, {
    typeCode: "work_item.escalated",
    title: `ارجاع خودکار: «${leaveRequestedTitle(again.childName)}»`,
    body: "مهلت پاسخ به این درخواست گذشت و به شما هم ارجاع شد.",
    sourceKind: "leave_request",
    sourceId: row.leaveRequestId,
    deepLink: leaveQueueHref(row.schoolId),
    payload: { requestSlaId: row.id, level: "principal" },
    dedupeKey: (personId) => `leave:${row.leaveRequestId}:escalated:${personId}`,
  });
  await recordEscalation(tx, ctx, row, period, subject, { fromLevel: "vice_principal", toLevel: "principal", added });
  return "escalated";
}

// ---------------------------------------------------------------------------------------------------------------
// the managers' page
// ---------------------------------------------------------------------------------------------------------------

export const SLA_FILTERS = ["on_time", "near", "overdue"] as const;

export interface RequestCenterInput {
  kind?: RequestKind | null;
  status?: SlaStatus | null;
  schoolId?: string | null;
}

export interface RequestCenterRow {
  id: string;
  kind: RequestKind;
  kindLabel: string;
  schoolId: string;
  schoolName: string;
  /** The item's title for a participant (or a request that is not confidential), «درخواست محرمانه» for anyone else. */
  title: string;
  /** The title is the placeholder. */
  titleHidden: boolean;
  /** The item page (a leave request: the school's queue), for a participant only. */
  href: string | null;
  openedAt: Date;
  dueAt: Date;
  status: SlaStatus;
  /** «در حال بررسی»: the clock is stopped (the status is as it stood then; the deadline moves on with the pause). */
  paused: boolean;
  escalations: number;
  addressees: string[];
}

export interface RequestCenterView {
  enabled: boolean;
  schools: Array<{ id: string; name: string }>;
  rows: RequestCenterRow[];
  /** Before the status filter — the header's count. */
  total: number;
  truncated: boolean;
}

const VIEW_LIMIT = 300;

type ViewCtx = Pick<Ctx, "orgId" | "personId" | "assignments">;

/** The open requests of the caller's schools (`iam.admin.access` scope), filtered; NOT_FOUND for a school outside it. */
export async function requestCenterView(tx: Tx, ctx: ViewCtx, input: RequestCenterInput, now: Date = new Date()): Promise<RequestCenterView> {
  const scope = await getAdminScope(tx, ctx);
  const enabled = await flagEnabled(tx, "request_center");
  const schoolsRes = await tx.execute<{ id: string; name: string }>(
    scope.kind === "organization"
      ? sql`select id, name from tenancy.school order by name, id`
      : sql`select id, name from tenancy.school where id = any(${sqlList(scope.schoolIds)}) order by name, id`,
  );
  const schools = schoolsRes.rows;
  const empty: RequestCenterView = { enabled, schools, rows: [], total: 0, truncated: false };
  if (!enabled) return empty;
  const reach = scope.kind === "organization" ? null : scope.schoolIds;
  if (input.schoolId && reach && !reach.includes(input.schoolId)) return empty;

  const itemRows = input.kind === "leave_request" ? { rows: [], more: false } : await workItemCenterRows(tx, ctx, input, reach, now);
  const leaveRows = input.kind && input.kind !== "leave_request" ? { rows: [], more: false } : await leaveCenterRows(tx, ctx, input, reach, now);
  const merged = [...itemRows.rows, ...leaveRows.rows].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const truncated = itemRows.more || leaveRows.more || merged.length > VIEW_LIMIT;
  const all = merged.slice(0, VIEW_LIMIT);
  const rows = input.status ? all.filter((r) => r.status === input.status) : all;
  return { enabled, schools, rows, total: all.length, truncated };
}

type ClockCols = { opened_at: string; period_started_at: string; due_at: string; escalation_level: number; paused_seconds: number; paused_at: string | null };

function clockOf(r: ClockCols, now: Date): { status: SlaStatus; paused: boolean; dueAt: Date; openedAt: Date } {
  const clock = { periodStartedAt: new Date(r.period_started_at), dueAt: new Date(r.due_at), pausedSeconds: Number(r.paused_seconds), pausedAt: r.paused_at ? new Date(r.paused_at) : null };
  return { status: slaStatus(clock, now), paused: clock.pausedAt !== null, dueAt: clock.dueAt, openedAt: new Date(r.opened_at) };
}

async function workItemCenterRows(tx: Tx, ctx: ViewCtx, input: RequestCenterInput, reach: string[] | null, now: Date): Promise<{ rows: RequestCenterRow[]; more: boolean }> {
  const filters = [sql`rs.closed_at is null`, sql`rs.work_item_id is not null`, sql`wi.archived_at is null`, sql`s.category in ('todo', 'doing')`];
  if (reach) filters.push(sql`rs.school_id = any(${sqlList(reach)})`);
  if (input.schoolId) filters.push(sql`rs.school_id = ${input.schoolId}::uuid`);
  if (input.kind) filters.push(sql`rs.kind = ${input.kind}`);
  const res = await tx.execute<
    ClockCols & {
      id: string;
      kind: string;
      school_id: string;
      school_name: string;
      work_item_id: string;
      title: string;
      is_confidential: boolean;
      participant: boolean;
      addressees: string[] | null;
    }
  >(sql`
    select rs.id, rs.kind, rs.school_id, sc.name as school_name, rs.work_item_id, wi.title, wi.is_confidential,
           (exists (select 1 from workspace.inbox_entry ie where ie.work_item_id = wi.id and ie.person_id = ${ctx.personId}::uuid)
            or (wi.created_by_person_id = ${ctx.personId}::uuid and t.code <> 'parent_message')) as participant,
           rs.opened_at, rs.period_started_at, rs.due_at, rs.escalation_level, rs.paused_seconds, rs.paused_at,
           array(select p.first_name || ' ' || p.last_name
                 from workspace.work_item_assignee a join iam.person p on p.id = a.person_id
                 where a.work_item_id = wi.id and a.role = 'assignee' and p.status = 'active'
                 order by p.last_name, p.first_name, p.id) as addressees
    from workspace.request_sla rs
    join workspace.work_item wi on wi.organization_id = rs.organization_id and wi.id = rs.work_item_id
    join workspace.work_item_status s on s.id = wi.status_id
    join workspace.work_item_type t on t.id = wi.type_id
    join tenancy.school sc on sc.organization_id = rs.organization_id and sc.id = rs.school_id
    where ${sql.join(filters, sql` and `)}
    order by rs.due_at, rs.id
    limit ${VIEW_LIMIT + 1}`);
  const rows = res.rows.slice(0, VIEW_LIMIT).flatMap<RequestCenterRow>((r) => {
    if (!isRequestKind(r.kind)) return [];
    const seesTitle = r.participant === true || !r.is_confidential;
    return [
      {
        id: r.id,
        kind: r.kind,
        kindLabel: REQUEST_KINDS[r.kind].labelFa,
        schoolId: r.school_id,
        schoolName: r.school_name,
        title: seesTitle ? r.title : CONFIDENTIAL_REQUEST_TITLE,
        titleHidden: !seesTitle,
        href: r.participant === true ? `/inbox/${r.work_item_id}` : null,
        ...clockOf(r, now),
        escalations: Number(r.escalation_level),
        addressees: r.addressees ?? [],
      },
    ];
  });
  return { rows, more: res.rows.length > VIEW_LIMIT };
}

async function leaveCenterRows(tx: Tx, ctx: ViewCtx, input: RequestCenterInput, reach: string[] | null, now: Date): Promise<{ rows: RequestCenterRow[]; more: boolean }> {
  const filters = [sql`rs.closed_at is null`, sql`rs.kind = 'leave_request'`, sql`lr.status = 'pending'`];
  if (reach) filters.push(sql`rs.school_id = any(${sqlList(reach)})`);
  if (input.schoolId) filters.push(sql`rs.school_id = ${input.schoolId}::uuid`);
  const res = await tx.execute<ClockCols & { id: string; school_id: string; school_name: string; requested_by_person_id: string; first_name: string; last_name: string }>(sql`
    select rs.id, rs.school_id, sc.name as school_name, lr.requested_by_person_id, sp.first_name, sp.last_name,
           rs.opened_at, rs.period_started_at, rs.due_at, rs.escalation_level, rs.paused_seconds, rs.paused_at
    from workspace.request_sla rs
    join academic.leave_request lr on lr.organization_id = rs.organization_id and lr.id = rs.leave_request_id
    join iam.student_profile st on st.id = lr.student_profile_id
    join iam.person sp on sp.id = st.person_id
    join tenancy.school sc on sc.organization_id = rs.organization_id and sc.id = rs.school_id
    where ${sql.join(filters, sql` and `)}
    order by rs.due_at, rs.id
    limit ${VIEW_LIMIT + 1}`);
  const page = res.rows.slice(0, VIEW_LIMIT);
  // The addressees by school (read once per school), then their names.
  const bySchool = new Map<string, LeaveDeciders>();
  for (const schoolId of new Set(page.map((r) => r.school_id))) bySchool.set(schoolId, await leaveDeciders(tx, schoolId, NOBODY));
  const ids = [...new Set([...bySchool.values()].flatMap((d) => [...d.principal, ...d.vice_principal]))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const nr = await tx.execute<{ id: string; name: string }>(sql`select id, first_name || ' ' || last_name as name from iam.person where id = any(${sqlList(ids)})`);
    for (const n of nr.rows) names.set(n.id, n.name);
  }
  const rows = page.map<RequestCenterRow>((r) => {
    const d = bySchool.get(r.school_id) ?? { principal: [], vice_principal: [] };
    const addressees = leaveAddressees(d, Number(r.escalation_level) > 0)
      .personIds.filter((id) => id !== r.requested_by_person_id)
      .map((id) => names.get(id) ?? "")
      .filter((n) => n !== "")
      .sort((a, b) => a.localeCompare(b, "fa"));
    // The queue decides AT the school: whoever may decide it reads the child's name and opens the queue.
    const seesTitle = holdsAtSchool(ctx.assignments, "academic.leave.decide", r.school_id);
    return {
      id: r.id,
      kind: "leave_request",
      kindLabel: REQUEST_KINDS.leave_request.labelFa,
      schoolId: r.school_id,
      schoolName: r.school_name,
      title: seesTitle ? leaveRequestedTitle(`${r.first_name} ${r.last_name}`) : CONFIDENTIAL_REQUEST_TITLE,
      titleHidden: !seesTitle,
      href: seesTitle ? leaveQueueHref(r.school_id) : null,
      ...clockOf(r, now),
      escalations: Number(r.escalation_level),
      addressees,
    };
  });
  return { rows, more: res.rows.length > VIEW_LIMIT };
}
