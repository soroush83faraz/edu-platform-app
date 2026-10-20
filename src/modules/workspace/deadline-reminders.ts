// workspace/deadline-reminders — «یادآوری مهلت تکالیف» (flag `deadline_reminders`, school-overridable; owner 2026-10-20,
// docs/decisions.md «یادآوری مهلت و مرکز درخواست‌ها»). Run by the job layer only (src/lib/jobs/handlers.ts), inside
// `withTenant` of one organization with the system actor — no person, so every row is read through plain tenant RLS.
//
//   • `scanDeadlines` (job `workspace.scan_deadlines`, every 15 minutes): the organization's OPEN `task` / `todo` items
//     with a deadline between a day ago and the longest lead ahead — never a confidential one (a counselor's report
//     request, a referral, a guardian's message: those are «مرکز درخواست‌ها»' business, ./requests.ts) — and, per
//     item whose school has the flag on (the درس's school; the organization's value for an item without a درس), one
//     `workspace.remind_deadline` job at the reminder's moment (./reminder-policy) and, for an item given to someone
//     else, one `workspace.notify_overdue` job at the deadline. The jobs' dedupe keys carry the deadline: a scan
//     enqueues each once, and a MOVED deadline is a new deadline with its own reminder (the old job finds the
//     deadline changed and does nothing).
//   • `remindDeadline`: re-reads the item (still open, same deadline, not passed, flag still on, not in the quiet
//     hours — else it re-queues itself to the window's end) and tells every assignee who has not finished and is
//     still an active person: «یادآوری: مهلت «…» تا …» — the item's title, which they already see. Once per
//     assignee and deadline (the notification's dedupe key).
//   • `notifyOverdue`: once the deadline has passed with assignees unfinished, the giver hears the COUNT, once:
//     «۳ نفر هنوز «…» را تمام نکرده‌اند» — never a personal item (its only assignee is its author), never a guardian's
//     message (whose creator is no participant).
// Notifications only — no business row changes, so no audit row (as every bell).
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { formatDeadlineAtFa, formatNumberFa } from "@/lib/format";
import { configSnapshot, flagEnabled, settingOf } from "@/modules/config/service";
import { FEATURE_FLAGS } from "@/modules/config/flags";
import { SETTINGS, settingSchema } from "@/modules/config/settings";
import { notifyMany } from "@/modules/notif/service";
import { deliveryTime } from "@/modules/notif/quiet-hours";
import { enqueueJob } from "@/modules/ops/enqueue";
import { OVERDUE_GRACE_MS, SCAN_AHEAD_MS, dueForScan, overdueNoticeAt, reminderAt } from "./reminder-policy";

const HOUR = 3_600_000;
/** Items one scan reads at most (soonest deadline first; the next scan continues). */
const SCAN_LIMIT = 2000;
/** The types a deadline reminder is for: a تکلیف / تسک given, and a personal note («خودم»). */
const REMINDED_TYPES = ["task", "todo"] as const;

export interface ReminderCtx {
  orgId: string;
}

export interface ScanReport {
  items: number;
  reminders: number;
  overdue: number;
}

/** Does any level of the organization turn the reminders on (else the scan reads nothing)? */
async function anyEnabled(tx: Tx): Promise<boolean> {
  if (FEATURE_FLAGS.deadline_reminders.default) return true;
  return (await configSnapshot(tx)).flags.some((r) => r.key === "deadline_reminders" && r.enabled);
}

/** The longest lead any level sets (the scan's horizon). */
async function maxLeadHours(tx: Tx): Promise<number> {
  const schema = settingSchema("reminders.deadline_lead_hours");
  let max: number = SETTINGS["reminders.deadline_lead_hours"].default;
  for (const r of (await configSnapshot(tx)).settings) {
    if (r.key !== "reminders.deadline_lead_hours") continue;
    const v = schema.safeParse(r.value);
    if (v.success && typeof v.data === "number") max = Math.max(max, v.data);
  }
  return max;
}

const dueKey = (dueAt: Date) => dueAt.toISOString();

export async function scanDeadlines(tx: Tx, ctx: ReminderCtx, now: Date = new Date()): Promise<ScanReport> {
  const report: ScanReport = { items: 0, reminders: 0, overdue: 0 };
  if (!(await anyEnabled(tx))) return report;
  const from = new Date(now.getTime() - OVERDUE_GRACE_MS);
  const to = new Date(now.getTime() + (await maxLeadHours(tx)) * HOUR + SCAN_AHEAD_MS);
  const res = await tx.execute<{ id: string; due_at: string; created_at: string; school_id: string | null; given: boolean }>(sql`
    select wi.id, wi.due_at, wi.created_at, b.school_id,
           exists (select 1 from workspace.work_item_assignee a
                   where a.work_item_id = wi.id and a.role = 'assignee' and a.person_id <> wi.created_by_person_id) as given
    from workspace.work_item wi
    join workspace.work_item_type t on t.id = wi.type_id
    join workspace.work_item_status s on s.id = wi.status_id
    left join tenancy.class_offering co on co.organization_id = wi.organization_id and co.id = wi.class_offering_id
    left join tenancy.class_group cg on cg.organization_id = co.organization_id and cg.id = co.class_group_id
    left join tenancy.branch b on b.id = cg.branch_id
    where wi.completed_at is null and wi.archived_at is null and not wi.is_confidential
      and t.code in (${sql.join(REMINDED_TYPES.map((c) => sql`${c}`), sql`, `)})
      and s.category in ('todo', 'doing')
      and wi.due_at > ${from.toISOString()}::timestamptz and wi.due_at <= ${to.toISOString()}::timestamptz
    order by wi.due_at, wi.id
    limit ${SCAN_LIMIT}`);
  for (const r of res.rows) {
    if (!(await flagEnabled(tx, "deadline_reminders", r.school_id))) continue;
    report.items++;
    const dueAt = new Date(r.due_at);
    const quiet = await settingOf(tx, "notif.quiet_hours", r.school_id);
    const remindAt = reminderAt({ dueAt, createdAt: new Date(r.created_at), leadHours: await settingOf(tx, "reminders.deadline_lead_hours", r.school_id), quiet, now });
    if (dueForScan(remindAt, now)) {
      const q = await enqueueJob(tx, ctx, "workspace.remind_deadline", { workItemId: r.id, dueAt: dueKey(dueAt) }, { runAt: remindAt, dedupeKey: `deadline:${r.id}:${dueKey(dueAt)}` });
      if (q.created) report.reminders++;
    }
    if (r.given) {
      const noticeAt = overdueNoticeAt(dueAt, quiet, now);
      if (dueForScan(noticeAt, now)) {
        const q = await enqueueJob(tx, ctx, "workspace.notify_overdue", { workItemId: r.id, dueAt: dueKey(dueAt) }, { runAt: noticeAt, dedupeKey: `overdue:${r.id}:${dueKey(dueAt)}` });
        if (q.created) report.overdue++;
      }
    }
  }
  return report;
}

interface LiveItem {
  title: string;
  dueAt: Date;
  creatorId: string;
  schoolId: string | null;
}

/** The item as it is now, when a deadline nudge still applies to it: open, not confidential, a reminded type, the same deadline. */
async function liveItem(tx: Tx, workItemId: string, dueAt: string): Promise<LiveItem | null> {
  const res = await tx.execute<{ title: string; due_at: string | null; created_by_person_id: string; school_id: string | null }>(sql`
    select wi.title, wi.due_at, wi.created_by_person_id, b.school_id
    from workspace.work_item wi
    join workspace.work_item_type t on t.id = wi.type_id
    join workspace.work_item_status s on s.id = wi.status_id
    left join tenancy.class_offering co on co.organization_id = wi.organization_id and co.id = wi.class_offering_id
    left join tenancy.class_group cg on cg.organization_id = co.organization_id and cg.id = co.class_group_id
    left join tenancy.branch b on b.id = cg.branch_id
    where wi.id = ${workItemId}::uuid
      and wi.completed_at is null and wi.archived_at is null and not wi.is_confidential
      and t.code in (${sql.join(REMINDED_TYPES.map((c) => sql`${c}`), sql`, `)})
      and s.category in ('todo', 'doing')`);
  const r = res.rows[0];
  if (!r?.due_at) return null;
  const current = new Date(r.due_at);
  if (current.getTime() !== new Date(dueAt).getTime()) return null;
  return { title: r.title, dueAt: current, creatorId: r.created_by_person_id, schoolId: r.school_id };
}

/** Not now (the quiet hours): re-queued to the window's end. True when the caller may deliver now. */
async function deliverNow(tx: Tx, ctx: ReminderCtx, item: LiveItem, deadline: Date | null, retry: { kind: "workspace.remind_deadline" | "workspace.notify_overdue"; workItemId: string; prefix: string }, now: Date): Promise<boolean> {
  const at = deliveryTime(now, deadline, await settingOf(tx, "notif.quiet_hours", item.schoolId), now);
  if (at === null) return false;
  if (at.getTime() <= now.getTime() + 60_000) return true;
  await enqueueJob(tx, ctx, retry.kind, { workItemId: retry.workItemId, dueAt: dueKey(item.dueAt) }, { runAt: at, dedupeKey: `${retry.prefix}:${retry.workItemId}:${dueKey(item.dueAt)}:${at.toISOString()}` });
  return false;
}

/** The assignees' reminder. Returns how many were notified. */
export async function remindDeadline(tx: Tx, ctx: ReminderCtx, input: { workItemId: string; dueAt: string }, now: Date = new Date()): Promise<number> {
  const item = await liveItem(tx, input.workItemId, input.dueAt);
  if (!item || item.dueAt.getTime() <= now.getTime()) return 0;
  if (!(await flagEnabled(tx, "deadline_reminders", item.schoolId))) return 0;
  if (!(await deliverNow(tx, ctx, item, item.dueAt, { kind: "workspace.remind_deadline", workItemId: input.workItemId, prefix: "deadline" }, now))) return 0;
  const res = await tx.execute<{ person_id: string }>(sql`
    select a.person_id from workspace.work_item_assignee a
    join iam.person p on p.id = a.person_id and p.status = 'active'
    where a.work_item_id = ${input.workItemId}::uuid and a.role = 'assignee' and a.state <> 'done'
    order by a.person_id`);
  return notifyMany(
    tx,
    ctx,
    res.rows.map((r) => r.person_id),
    {
      typeCode: "work_item.due_soon",
      title: `یادآوری: مهلت «${item.title}» تا ${formatDeadlineAtFa(item.dueAt, now)}`,
      sourceKind: "work_item",
      sourceId: input.workItemId,
      deepLink: `/inbox/${input.workItemId}`,
      payload: { dueAt: dueKey(item.dueAt) },
      dedupeKey: () => `wi:${input.workItemId}:due_soon:${dueKey(item.dueAt)}`,
    },
  );
}

/** The giver's notice that the deadline passed with assignees unfinished. Returns the count told (0 = nothing sent). */
export async function notifyOverdue(tx: Tx, ctx: ReminderCtx, input: { workItemId: string; dueAt: string }, now: Date = new Date()): Promise<number> {
  const item = await liveItem(tx, input.workItemId, input.dueAt);
  if (!item || item.dueAt.getTime() > now.getTime()) return 0;
  if (!(await flagEnabled(tx, "deadline_reminders", item.schoolId))) return 0;
  const res = await tx.execute<{ unfinished: number; creator_active: boolean }>(sql`
    select
      (select count(*)::int from workspace.work_item_assignee a
       join iam.person p on p.id = a.person_id and p.status = 'active'
       where a.work_item_id = ${input.workItemId}::uuid and a.role = 'assignee' and a.state <> 'done'
         and a.person_id <> ${item.creatorId}::uuid) as unfinished,
      exists (select 1 from iam.person p where p.id = ${item.creatorId}::uuid and p.status = 'active') as creator_active`);
  const n = Number(res.rows[0]?.unfinished ?? 0);
  if (n === 0 || res.rows[0]?.creator_active !== true) return 0;
  if (!(await deliverNow(tx, ctx, item, null, { kind: "workspace.notify_overdue", workItemId: input.workItemId, prefix: "overdue" }, now))) return 0;
  const sent = await notifyMany(tx, ctx, [item.creatorId], {
    typeCode: "work_item.overdue",
    title: `${formatNumberFa(n)} نفر هنوز «${item.title}» را تمام نکرده‌اند`,
    sourceKind: "work_item",
    sourceId: input.workItemId,
    deepLink: `/inbox/${input.workItemId}`,
    payload: { dueAt: dueKey(item.dueAt), unfinished: n },
    dedupeKey: () => `wi:${input.workItemId}:overdue:${dueKey(item.dueAt)}`,
  });
  return sent > 0 ? n : 0;
}
