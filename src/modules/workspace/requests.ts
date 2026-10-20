// workspace/requests — «مرکز درخواست‌ها» (flag `request_center`, organization-level; owner 2026-10-20, docs/decisions.md
// «یادآوری مهلت و مرکز درخواست‌ها»; the rules are ./request-sla.ts). `(tx, ctx, input)`.
//
//   • `openRequestSla` — in the transaction that SENDS a request (counseling `referToManagement`, iam
//     `sendGuardianMessage`): one `workspace.request_sla` row, its first period = the kind's response time at the
//     school. Always written, flag or not: turning the center on later finds every request sent since this release
//     with its true clock (one sent before it has none — docs/decisions.md).
//   • `checkRequestSlas` — the `workspace.check_request_slas` job (every 15 minutes, system actor, one organization;
//     nothing while the flag is off). Per open request whose period reached its 80 % mark: answered or closed meanwhile
//     → `closed_at`, the clock stops; inside the school's quiet hours → left for the first check after them; else
//     – at 80 %: the live addressees are reminded once per period («یادآوری: پاسخ به «…» تا …»); audited
//       `workspace.request.sla_warned`;
//     – at the end: ESCALATED — the next level of the chain (معاون → مدیر مدرسه → مدیر سازمان, above the highest level
//       a live addressee holds at the school) is ADDED: an assignee row, an unread inbox row and the bell
//       «ارجاع خودکار: «…»» — the earlier addressees keep theirs; a new period starts; audited
//       `workspace.request.escalated` (ids and levels only). Nobody left to add → a new period for the same
//       addressees (`workspace.request.sla_renewed`).
//     A confidential request reaches the person added in full: they become a participant, as the first addressees
//     were — that is what an escalation is. The bell carries the item's title only, never its text (a referral's
//     description, a guardian's words).
//   • `requestCenterView` — the managers' page (`iam.admin.access`, their schools): every OPEN request with its kind,
//     school, age, status (در مهلت / نزدیک مهلت / گذشته), escalations and current addressees. A confidential request's
//     TITLE shows only to a participant of it (an addressee — `canViewWorkItem`'s rule); anyone else reads
//     «درخواست محرمانه» and gets no link (docs/decisions.md: the kind, the age and who holds it are what a manager
//     needs to follow up; the title of a counselor's referral names a student and a subject).
//
// LOCKS (iam/removal «Concurrency»: person rows → work item rows): an escalation takes the candidates' person rows FOR
// KEY SHARE SKIP LOCKED (one being removed is passed over), then the work item FOR NO KEY UPDATE SKIP LOCKED (an answer
// in flight → this check leaves it to the next one), then re-reads the item and its addressees.
import { eq, sql } from "drizzle-orm";
import type { Ctx, Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { formatDeadlineAtFa } from "@/lib/format";
import { flagEnabled, settingOf } from "@/modules/config/service";
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

// ---------------------------------------------------------------------------------------------------------------
// opening a request's clock
// ---------------------------------------------------------------------------------------------------------------

export interface OpenRequestInput {
  kind: WorkItemRequestKind;
  workItemId: string;
  schoolId: string;
}

/** The clock of a request just sent, in the sending transaction. Idempotent per work item. */
export async function openRequestSla(tx: Tx, ctx: { orgId: string }, input: OpenRequestInput): Promise<void> {
  const hours = await settingOf(tx, REQUEST_KINDS[input.kind].settingKey, input.schoolId);
  await tx
    .insert(requestSla)
    .values({
      organizationId: ctx.orgId,
      schoolId: input.schoolId,
      kind: input.kind,
      workItemId: input.workItemId,
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
}

interface SlaRow {
  id: string;
  schoolId: string;
  kind: RequestKind;
  workItemId: string;
  periodStartedAt: Date;
  dueAt: Date;
  warnedAt: Date | null;
  escalationLevel: number;
}

interface ItemNow {
  open: boolean;
  title: string;
  creatorId: string;
}

async function itemNow(tx: Tx, workItemId: string): Promise<ItemNow | null> {
  const res = await tx.execute<{ open: boolean; title: string; created_by_person_id: string }>(sql`
    select (wi.archived_at is null and s.category in ('todo', 'doing')) as open, wi.title, wi.created_by_person_id
    from workspace.work_item wi join workspace.work_item_status s on s.id = wi.status_id
    where wi.id = ${workItemId}::uuid`);
  const r = res.rows[0];
  return r ? { open: r.open === true, title: r.title, creatorId: r.created_by_person_id } : null;
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

function rowOf(r: { id: string; school_id: string; kind: string; work_item_id: string; period_started_at: string; due_at: string; warned_at: string | null; escalation_level: number }): SlaRow | null {
  if (!isRequestKind(r.kind) || REQUEST_KINDS[r.kind].workItemType === null) return null;
  return {
    id: r.id,
    schoolId: r.school_id,
    kind: r.kind,
    workItemId: r.work_item_id,
    periodStartedAt: new Date(r.period_started_at),
    dueAt: new Date(r.due_at),
    warnedAt: r.warned_at ? new Date(r.warned_at) : null,
    escalationLevel: Number(r.escalation_level),
  };
}

export async function checkRequestSlas(tx: Tx, ctx: RequestCheckCtx, now: Date = new Date()): Promise<CheckReport> {
  const report: CheckReport = { warned: 0, escalated: 0, renewed: 0, closed: 0, skipped: 0 };
  if (!(await flagEnabled(tx, "request_center"))) return report;
  const at = now.toISOString();
  // The rows whose period reached its 80 % mark and that still have something to do (a reminder not sent in this
  // period, or the end of it) — locked, so an overlapping run of this job skips them.
  const res = await tx.execute<{ id: string; school_id: string; kind: string; work_item_id: string; period_started_at: string; due_at: string; warned_at: string | null; escalation_level: number }>(sql`
    select id, school_id, kind, work_item_id, period_started_at, due_at, warned_at, escalation_level
    from workspace.request_sla
    where closed_at is null and work_item_id is not null
      and period_started_at + (due_at - period_started_at) * 0.8 <= ${at}::timestamptz
      and (due_at <= ${at}::timestamptz or warned_at is null or warned_at < period_started_at)
    order by due_at, id
    limit ${CHECK_LIMIT}
    for update skip locked`);
  for (const raw of res.rows) {
    const row = rowOf(raw);
    if (!row) continue;
    const item = await itemNow(tx, row.workItemId);
    if (!item || !item.open) {
      await tx.update(requestSla).set({ closedAt: now }).where(eq(requestSla.id, row.id));
      report.closed++;
      continue;
    }
    if (inQuietHours(now, await settingOf(tx, "notif.quiet_hours", row.schoolId))) {
      report.skipped++;
      continue;
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
  return report;
}

/** Where a bell about this request takes its addressee: a counselor answers a guardian's message in «مشاوره». */
async function deepLinksOf(tx: Tx, row: SlaRow, creatorId: string, personIds: readonly string[]): Promise<{ counselors: string[]; others: string[] }> {
  if (row.kind !== "parent_message") return { counselors: [], others: [...personIds] };
  const counselors = new Set((await officeHolders(tx, row.schoolId, creatorId)).counselor);
  return { counselors: personIds.filter((id) => counselors.has(id)), others: personIds.filter((id) => !counselors.has(id)) };
}

async function warn(tx: Tx, ctx: RequestCheckCtx, row: SlaRow, item: ItemNow, now: Date): Promise<void> {
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

async function escalate(tx: Tx, ctx: RequestCheckCtx, row: SlaRow, item: ItemNow, now: Date): Promise<"escalated" | "renewed" | "skipped"> {
  // Plan without locks: who holds the item now, at which level, and who is above them.
  const before = await addresseesOf(tx, row.workItemId);
  const offices = await officeHolders(tx, row.schoolId, item.creatorId);
  const candidates = { vice_principal: offices.vice_principal, principal: offices.principal, org_admin: await organizationAdmins(tx, item.creatorId) };
  const planned = nextLevel(currentLevel(await levelsAt(tx, row.schoolId, before.live)), candidates, new Set([...before.all, item.creatorId]));

  // Locks: persons → work item; then decide again on what is committed now.
  const locked = planned ? await lockPersons(tx, planned.personIds) : new Set<string>();
  const [held] = await tx.select({ id: workItem.id }).from(workItem).where(eq(workItem.id, row.workItemId)).for("no key update", { skipLocked: true });
  if (!held) return "skipped";
  const again = await itemNow(tx, row.workItemId);
  if (!again?.open) return "skipped";
  const after = await addresseesOf(tx, row.workItemId);
  const current = new Set([...after.all, item.creatorId]);
  const added = planned ? planned.personIds.filter((id) => locked.has(id) && !current.has(id)).sort() : [];
  const hours = await settingOf(tx, REQUEST_KINDS[row.kind].settingKey, row.schoolId);
  const period = nextPeriod(now, hours);

  if (!planned || added.length === 0) {
    await tx.update(requestSla).set({ periodStartedAt: period.periodStartedAt, dueAt: period.dueAt, warnedAt: null }).where(eq(requestSla.id, row.id));
    await audit(
      ctx,
      "workspace.request.sla_renewed",
      { schema: "workspace", table: "request_sla", id: row.id },
      { dueAt: row.dueAt.toISOString(), escalationLevel: row.escalationLevel },
      { kind: row.kind, workItemId: row.workItemId, schoolId: row.schoolId, dueAt: period.dueAt.toISOString(), reason: "no_next_level" },
      tx,
    );
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
  const level = Math.min(row.escalationLevel + 1, 10);
  await tx
    .update(requestSla)
    .set({ escalationLevel: level, escalatedAt: now, periodStartedAt: period.periodStartedAt, dueAt: period.dueAt, warnedAt: null })
    .where(eq(requestSla.id, row.id));
  await audit(
    ctx,
    "workspace.request.escalated",
    { schema: "workspace", table: "request_sla", id: row.id },
    { escalationLevel: row.escalationLevel, dueAt: row.dueAt.toISOString(), assigneeIds: after.all },
    {
      kind: row.kind,
      workItemId: row.workItemId,
      schoolId: row.schoolId,
      escalationLevel: level,
      fromLevel: fromLevel >= 0 ? LEVELS[fromLevel] : null,
      toLevel: planned.level,
      addedPersonIds: added,
      dueAt: period.dueAt.toISOString(),
    },
    tx,
  );
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
  /** The item page, for a participant only. */
  href: string | null;
  openedAt: Date;
  dueAt: Date;
  status: SlaStatus;
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

/** The open requests of the caller's schools (`iam.admin.access` scope), filtered; NOT_FOUND for a school outside it. */
export async function requestCenterView(tx: Tx, ctx: Pick<Ctx, "orgId" | "personId" | "assignments">, input: RequestCenterInput, now: Date = new Date()): Promise<RequestCenterView> {
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

  const filters = [sql`rs.closed_at is null`, sql`wi.archived_at is null`, sql`s.category in ('todo', 'doing')`];
  if (reach) filters.push(sql`rs.school_id = any(${sqlList(reach)})`);
  if (input.schoolId) filters.push(sql`rs.school_id = ${input.schoolId}::uuid`);
  if (input.kind) filters.push(sql`rs.kind = ${input.kind}`);
  const res = await tx.execute<{
    id: string;
    kind: string;
    school_id: string;
    school_name: string;
    work_item_id: string;
    title: string;
    is_confidential: boolean;
    participant: boolean;
    opened_at: string;
    period_started_at: string;
    due_at: string;
    escalation_level: number;
    addressees: string[] | null;
  }>(sql`
    select rs.id, rs.kind, rs.school_id, sc.name as school_name, rs.work_item_id, wi.title, wi.is_confidential,
           (exists (select 1 from workspace.inbox_entry ie where ie.work_item_id = wi.id and ie.person_id = ${ctx.personId}::uuid)
            or (wi.created_by_person_id = ${ctx.personId}::uuid and t.code <> 'parent_message')) as participant,
           rs.opened_at, rs.period_started_at, rs.due_at, rs.escalation_level,
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
  const truncated = res.rows.length > VIEW_LIMIT;
  const all = res.rows.slice(0, VIEW_LIMIT).flatMap<RequestCenterRow>((r) => {
    if (!isRequestKind(r.kind)) return [];
    const clock = { periodStartedAt: new Date(r.period_started_at), dueAt: new Date(r.due_at) };
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
        openedAt: new Date(r.opened_at),
        dueAt: clock.dueAt,
        status: slaStatus(clock, now),
        escalations: Number(r.escalation_level),
        addressees: r.addressees ?? [],
      },
    ];
  });
  const rows = input.status ? all.filter((r) => r.status === input.status) : all;
  return { enabled, schools, rows, total: all.length, truncated };
}
