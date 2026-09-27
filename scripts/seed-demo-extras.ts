// Demo extras on top of the pilot dataset (scripts/seed-pilot.ts): realistic default content in «پنل من» and the bell
// for EVERY role of the three pilot organizations — not only the class homework the pilot seed gives students.
//
//   pnpm seed:demo-extras                          (refuses with NODE_ENV=production unless SEED_ALLOW=1; needs the pilot)
//   pnpm seed:demo-extras --prune-legacy-status    (also deletes pre-round-7 assignee status notifications, see below)
//
// Per organization (allameh / farzanegan / helli — never any other organization), the plan in
// scripts/demo-extras-plan.ts: the organization admin's «تسک» to the principal and the vice principal, the principal's
// and the vice principal's «تسک» to دبیران, personal notes of the three managers, a few students' own «تسک», and a mix
// of «تکلیف» of the first دبیر (partly done by the class, one closed with «اتمام», one extended) — deadlines spread
// round NOW in Asia/Tehran (overdue, today, this week, later, none).
//
// Everything goes THROUGH the real services (`createWorkItem`, `changeStatus`, `extendDueAt`, `markInboxRead`, the
// notification repo's `markRead`) with each acting person's REAL ctx (`listValidAssignments`), so audit rows, inbox
// entries and notifications are the ones the app itself writes — including the current notification policy (an
// assignee's «انجام شد» notifies nobody). Only the notifications of an item an assignee finished or opened
// (`doneBy` / `readBy`) are marked read; the rest stay unread so the bell shows a count.
//
// Idempotent: every planned item carries a deterministic `work_item.idempotency_key` (`demoItemKey`) and is looked up
// by (creator, key) before it is created; a done mark / «اتمام» is skipped when already there, a «تمدید» when the
// item's audit trail already holds one. A second run writes nothing (tests/int/seed-demo-extras.test.ts).
//
// It also renames old «کار جدید: …» notification titles of the pilot organizations to the creator's current word
// («تکلیف جدید: …» / «تسک جدید: …»). With `--prune-legacy-status` (opt-in, destructive) it deletes the pilot
// organizations' status notifications that an ASSIGNEE's «انجام شد» wrote before round 7 («… «…» را انجام‌شده کرد
// (n/m)») — the current policy never writes them, and a pilot seeded under the old code shows each دبیر ~20 of them.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray, isNull, like, notLike, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { workItemVoice, workItemWords } from "../src/lib/work-item-words";
import { listValidAssignments } from "../src/modules/iam/repo";
import { markRead } from "../src/modules/notif/repo";
import { findWorkItemCore } from "../src/modules/workspace/repo";
import { changeStatus, createWorkItem, extendDueAt, markInboxRead, type CreateWorkItemInput } from "../src/modules/workspace/service";
import {
  DEMO_ITEMS,
  LEGACY_NEW_PREFIX,
  type DemoItemSpec,
  type PersonRef,
  demoDueAt,
  demoItemKey,
  externalRefOf,
  pickDoers,
  planPersons,
  renameLegacyTitle,
  titleOf,
} from "./demo-extras-plan";
import { type ActorCtx, type Db, type Tx, PILOT_ORGS, type PilotOrgSpec, actorCtx, loadDotEnv, withOrg } from "./seed-pilot";

const { organization, person, staffProfile, teacherAssignment, classOffering, classGroup, subject, workItem, workItemAssignee, notification, auditLog } = schema;

const SOURCE = { requestId: "seed-demo-extras", userAgent: "scripts/seed-demo-extras.ts" };

/** What one role of an organization now sees (the numbers the CLI prints and the coordinator reports). */
export interface RoleView {
  role: string;
  /** Open items given TO this person by someone else (not done by them yet). */
  assignedOpen: number;
  /** Open items this person gave to others. */
  givenOpen: number;
  /** Open personal notes / a student's own «تسک». */
  personalOpen: number;
  /** Visible notifications (comment notifications are stored but hidden) and how many are unread. */
  notifications: number;
  unread: number;
}

export interface DemoExtrasOrgResult {
  slug: string;
  name: string;
  created: number;
  doneMarks: number;
  closed: number;
  extended: number;
  readMarks: number;
  renamedTitles: number;
  /** Legacy assignee status notifications deleted (`--prune-legacy-status` only). */
  prunedStatus: number;
  roles: RoleView[];
}

// ---------------------------------------------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------------------------------------------

async function resolvePersons(tx: Tx, spec: PilotOrgSpec, refs: readonly PersonRef[]): Promise<Map<PersonRef, string>> {
  const byRef = new Map(refs.map((r) => [externalRefOf(spec.key, r), r]));
  const rows = await tx.select({ id: person.id, externalRef: person.externalRef }).from(person).where(inArray(person.externalRef, [...byRef.keys()]));
  const out = new Map<PersonRef, string>();
  for (const r of rows) if (r.externalRef) out.set(byRef.get(r.externalRef)!, r.id);
  const missing = refs.filter((r) => !out.has(r));
  if (missing.length > 0) throw new Error(`demo extras ${spec.slug}: pilot persons missing (${missing.join(", ")}) — run \`pnpm seed:pilot\` first`);
  return out;
}

interface TeachingOffering {
  id: string;
  subject: string;
  cls: string;
}

/** A teacher's current main offerings in a stable order (class name, subject code). */
async function teachingOfferings(tx: Tx, personId: string): Promise<TeachingOffering[]> {
  return tx
    .select({ id: classOffering.id, subject: subject.name, cls: classGroup.name })
    .from(teacherAssignment)
    .innerJoin(staffProfile, eq(staffProfile.id, teacherAssignment.staffProfileId))
    .innerJoin(classOffering, eq(classOffering.id, teacherAssignment.classOfferingId))
    .innerJoin(subject, eq(subject.id, classOffering.subjectId))
    .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
    .where(and(eq(staffProfile.personId, personId), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo), eq(classOffering.status, "active")))
    .orderBy(asc(classGroup.name), asc(subject.code));
}

/** The school's science درس for the students' «مرور فصل ۳ …»: فیزیک in دوم متوسطه, علوم تجربی in اول. */
async function scienceName(tx: Tx): Promise<string> {
  const rows = await tx.select({ code: subject.code, name: subject.name }).from(subject).where(inArray(subject.code, ["PHYS", "SCI"]));
  return rows.find((r) => r.code === "PHYS")?.name ?? rows.find((r) => r.code === "SCI")?.name ?? "علوم";
}

async function findDemoItem(tx: Tx, creatorPersonId: string, key: string): Promise<string | null> {
  const [row] = await tx.select({ id: workItem.id }).from(workItem).where(and(eq(workItem.createdByPersonId, creatorPersonId), eq(workItem.idempotencyKey, key))).limit(1);
  return row?.id ?? null;
}

async function assigneeState(tx: Tx, workItemId: string, personId: string): Promise<string | null> {
  const [row] = await tx
    .select({ state: workItemAssignee.state })
    .from(workItemAssignee)
    .where(and(eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.personId, personId), eq(workItemAssignee.role, "assignee")))
    .limit(1);
  return row?.state ?? null;
}

async function hasAudit(tx: Tx, workItemId: string, action: string): Promise<boolean> {
  const [row] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.entityId, workItemId), eq(auditLog.action, action))).limit(1);
  return Boolean(row);
}

const isClosed = (category: string) => category === "done" || category === "cancelled";

/**
 * The person has seen the item: their «تکلیف/تسک جدید» notification of it is read (notif repo `markRead`, the bell's
 * own path). Only the `assigned` notification — later ones («اتمام», «تمدید») arrive after they looked, and stay
 * unread. Returns how many were marked.
 */
async function readAssignedNotification(tx: Tx, personId: string, workItemId: string): Promise<number> {
  const rows = await tx
    .select({ id: notification.id })
    .from(notification)
    .where(and(eq(notification.recipientPersonId, personId), eq(notification.sourceId, workItemId), eq(notification.typeCode, "work_item.assigned"), isNull(notification.readAt)));
  for (const r of rows) await markRead(tx, personId, r.id);
  return rows.length;
}

// ---------------------------------------------------------------------------------------------------------------
// legacy wording
// ---------------------------------------------------------------------------------------------------------------

/** «کار جدید: …» → the creator's word today (`workItemVoice` of their current assignments). Returns rows renamed. */
export async function renameLegacyNotificationTitles(tx: Tx): Promise<number> {
  const rows = await tx
    .selectDistinct({ sourceId: notification.sourceId, title: notification.title, creator: workItem.createdByPersonId })
    .from(notification)
    .innerJoin(workItem, eq(workItem.id, notification.sourceId))
    .where(and(eq(notification.typeCode, "work_item.assigned"), like(notification.title, `${LEGACY_NEW_PREFIX}%`)));
  const wordOf = new Map<string, string>();
  let renamed = 0;
  for (const r of rows) {
    let word = wordOf.get(r.creator);
    if (!word) {
      word = workItemWords(workItemVoice(await listValidAssignments(tx, r.creator))).new;
      wordOf.set(r.creator, word);
    }
    const next = renameLegacyTitle(r.title, word);
    if (!next || !r.sourceId) continue;
    const res = await tx
      .update(notification)
      .set({ title: next })
      .where(and(eq(notification.sourceId, r.sourceId), eq(notification.typeCode, "work_item.assigned"), eq(notification.title, r.title)))
      .returning({ id: notification.id });
    renamed += res.length;
  }
  return renamed;
}

/**
 * Deletes the status notifications an assignee's «انجام شد» wrote under the old policy. The current service writes a
 * status notification only for the GIVER's change, titled «وضعیت «…»: …» (workspace/service `changeStatus`); every
 * other `work_item.status_changed` title is the assignee form «<name> «…» را … کرد (n/m)».
 */
export async function pruneLegacyStatusNotifications(tx: Tx): Promise<number> {
  const rows = await tx
    .delete(notification)
    .where(and(eq(notification.typeCode, "work_item.status_changed"), notLike(notification.title, "وضعیت «%")))
    .returning({ id: notification.id });
  return rows.length;
}

// ---------------------------------------------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------------------------------------------

interface OrgRun {
  tx: Tx;
  orgId: string;
  spec: PilotOrgSpec;
  persons: Map<PersonRef, string>;
  ctxCache: Map<string, ActorCtx>;
  science: string;
  now: Date;
  stats: Omit<DemoExtrasOrgResult, "slug" | "name" | "roles" | "renamedTitles" | "prunedStatus">;
}

const ctxOf = (run: OrgRun, personId: string) => actorCtx(run.tx, run.orgId, personId, run.ctxCache, SOURCE);

async function seedItem(run: OrgRun, item: DemoItemSpec): Promise<void> {
  const { tx } = run;
  const actorId = run.persons.get(item.actor)!;
  const actor = await ctxOf(run, actorId);
  const key = demoItemKey(run.spec.key, item.slug);

  let recipients: CreateWorkItemInput["recipients"];
  let vars = { subject: "", cls: "", science: run.science };
  if (item.recipients.kind === "self") recipients = { kind: "self" };
  else if (item.recipients.kind === "persons") recipients = { kind: "persons", ids: item.recipients.who.map((r) => run.persons.get(r)!) };
  else {
    const offerings = await teachingOfferings(tx, actorId);
    if (offerings.length === 0) throw new Error(`demo extras ${run.spec.slug}: ${item.actor} teaches no class`);
    const o = offerings[item.recipients.offeringIndex % offerings.length];
    vars = { ...vars, subject: o.subject, cls: o.cls };
    recipients = { kind: "class_offering", id: o.id, excludePersonIds: [] };
  }

  let workItemId = await findDemoItem(tx, actorId, key);
  const createdNow = !workItemId;
  if (!workItemId) {
    const res = await createWorkItem(tx, actor, {
      typeCode: item.typeCode,
      title: titleOf(item, vars),
      description: item.description,
      priority: item.priority,
      dueAt: demoDueAt(item.due, run.now),
      recipients,
      idempotencyKey: key,
    });
    workItemId = res.id;
    run.stats.created++;
  }

  // «انجام شد» of the assignees who did it (named people, or a share of the class) — silent by policy.
  let doers = (item.doneBy ?? []).map((r) => run.persons.get(r)!);
  if (item.doneShare) {
    const roster = await tx
      .select({ personId: workItemAssignee.personId })
      .from(workItemAssignee)
      .where(and(eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.role, "assignee")));
    doers = pickDoers(
      roster.map((r) => r.personId),
      item.doneShare,
    );
  }
  for (const doerId of doers) {
    const core = await findWorkItemCore(tx, workItemId);
    if (!core || isClosed(core.statusCategory)) break;
    if ((await assigneeState(tx, workItemId, doerId)) === "done") continue;
    const dctx = await ctxOf(run, doerId);
    await changeStatus(tx, dctx, { workItemId, toStatusCode: "done" });
    run.stats.doneMarks++;
    if (doerId !== actorId) {
      run.stats.readMarks += await readAssignedNotification(tx, doerId, workItemId);
      await markInboxRead(tx, dctx, { workItemId });
    }
  }

  // Assignees who opened it (read) without finishing it — only when the item is new, so a re-run never re-reads.
  if (createdNow) {
    for (const ref of item.readBy ?? []) {
      const readerId = run.persons.get(ref)!;
      run.stats.readMarks += await readAssignedNotification(tx, readerId, workItemId);
      await markInboxRead(tx, await ctxOf(run, readerId), { workItemId });
    }
  }

  // The giver's «اتمام» (tells every other assignee).
  if (item.closeByGiver) {
    const core = await findWorkItemCore(tx, workItemId);
    if (core && !isClosed(core.statusCategory)) {
      await changeStatus(tx, actor, { workItemId, toStatusCode: "done" });
      run.stats.closed++;
    }
  }

  // The giver's «تمدید» (tells every assignee) — once per item, whatever the date of the run.
  if (item.extendTo && !(await hasAudit(tx, workItemId, "workspace.work_item.due_extended"))) {
    const core = await findWorkItemCore(tx, workItemId);
    if (core && !isClosed(core.statusCategory)) {
      await extendDueAt(tx, actor, { workItemId, dueAt: demoDueAt(item.extendTo, run.now)! });
      run.stats.extended++;
    }
  }
}

/** Open work a person holds, gave and wrote for themselves, and their visible / unread notifications. */
async function roleView(tx: Tx, role: string, personId: string): Promise<RoleView> {
  const res = await tx.execute<{ assigned_open: number; given_open: number; personal_open: number; notifications: number; unread: number }>(sql`
    select
      (select count(*)::int from workspace.work_item_assignee a
         join workspace.work_item w on w.id = a.work_item_id
         join workspace.work_item_status s on s.id = w.status_id
        where a.person_id = ${personId} and a.role = 'assignee' and a.state <> 'done'
          and w.created_by_person_id <> ${personId} and s.category in ('todo', 'doing') and w.archived_at is null) as assigned_open,
      (select count(*)::int from workspace.work_item w
         join workspace.work_item_type t on t.id = w.type_id
         join workspace.work_item_status s on s.id = w.status_id
        where w.created_by_person_id = ${personId} and t.code = 'task' and s.category in ('todo', 'doing') and w.archived_at is null) as given_open,
      (select count(*)::int from workspace.work_item w
         join workspace.work_item_type t on t.id = w.type_id
         join workspace.work_item_status s on s.id = w.status_id
        where w.created_by_person_id = ${personId} and t.code = 'todo' and s.category in ('todo', 'doing') and w.archived_at is null) as personal_open,
      (select count(*)::int from notif.notification n where n.recipient_person_id = ${personId} and n.type_code <> 'work_item.comment') as notifications,
      (select count(*)::int from notif.notification n where n.recipient_person_id = ${personId} and n.type_code <> 'work_item.comment' and n.read_at is null) as unread
  `);
  const r = res.rows[0];
  return { role, assignedOpen: r.assigned_open, givenOpen: r.given_open, personalOpen: r.personal_open, notifications: r.notifications, unread: r.unread };
}

async function seedOrg(db: Db, spec: PilotOrgSpec, now: Date, pruneLegacyStatus: boolean): Promise<DemoExtrasOrgResult | null> {
  const [org] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, spec.slug)).limit(1);
  if (!org) return null;
  return withOrg(db, org.id, async (tx) => {
    const renamedTitles = await renameLegacyNotificationTitles(tx);
    const prunedStatus = pruneLegacyStatus ? await pruneLegacyStatusNotifications(tx) : 0;
    const run: OrgRun = {
      tx,
      orgId: org.id,
      spec,
      persons: await resolvePersons(tx, spec, planPersons()),
      ctxCache: new Map(),
      science: await scienceName(tx),
      now,
      stats: { created: 0, doneMarks: 0, closed: 0, extended: 0, readMarks: 0 },
    };
    for (const item of DEMO_ITEMS) await seedItem(run, item);
    const views: Array<[string, PersonRef]> = [
      ["org admin", "admin"],
      ["principal", "principal"],
      ["vice", "vice"],
      ["teacher-1", "teacher-1"],
      ["teacher-2", "teacher-2"],
      ["student-0", "student-0"],
    ];
    const roles: RoleView[] = [];
    for (const [role, ref] of views) roles.push(await roleView(tx, role, run.persons.get(ref)!));
    return { slug: spec.slug, name: spec.name, ...run.stats, renamedTitles, prunedStatus, roles };
  });
}

export interface DemoExtrasResult {
  orgs: DemoExtrasOrgResult[];
  /** Pilot slugs with no organization in this database (nothing was written for them). */
  skipped: string[];
}

/** Runs the plan over the three pilot organizations (one transaction each); other organizations are never read. */
export async function seedDemoExtras(db: Db, opts: { now?: Date; pruneLegacyStatus?: boolean } = {}): Promise<DemoExtrasResult> {
  const now = opts.now ?? new Date();
  const orgs: DemoExtrasOrgResult[] = [];
  const skipped: string[] = [];
  for (const spec of PILOT_ORGS) {
    const res = await seedOrg(db, spec, now, opts.pruneLegacyStatus ?? false);
    if (res) orgs.push(res);
    else skipped.push(spec.slug);
  }
  return { orgs, skipped };
}

/** Counts over the pilot organizations that a second run must leave unchanged (the int test compares two runs). */
export async function demoExtrasCounts(db: Db): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  const orgs = await db.select({ id: organization.id }).from(organization).where(inArray(organization.slug, PILOT_ORGS.map((o) => o.slug)));
  for (const { id } of orgs) {
    await withOrg(db, id, async (tx) => {
      const queries: Record<string, string> = {
        workItems: "select count(*)::int as n from workspace.work_item",
        assigneesDone: "select count(*)::int as n from workspace.work_item_assignee where state = 'done'",
        transitions: "select count(*)::int as n from workspace.work_item_transition",
        inboxUnread: "select count(*)::int as n from workspace.inbox_entry where state = 'unread'",
        notifications: "select count(*)::int as n from notif.notification",
        notificationsUnread: "select count(*)::int as n from notif.notification where read_at is null",
        auditRows: "select count(*)::int as n from audit.audit_log",
      };
      for (const [k, q] of Object.entries(queries)) {
        const res = await tx.execute<{ n: number }>(sql.raw(q));
        totals[k] = (totals[k] ?? 0) + res.rows[0].n;
      }
    });
  }
  return totals;
}

// ---------------------------------------------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------------------------------------------

function printResult(result: DemoExtrasResult): void {
  for (const o of result.orgs) {
    console.log(`\n[seed:demo-extras] ${o.name} (${o.slug}) — created ${o.created} items, ${o.doneMarks} «انجام شد», ${o.closed} «اتمام», ${o.extended} «تمدید», ${o.readMarks} notifications read, ${o.renamedTitles} legacy titles renamed${o.prunedStatus ? `, ${o.prunedStatus} legacy status notifications deleted` : ""}`);
    console.log("  role        assigned-open  given-open  personal-open  notifications  unread");
    for (const r of o.roles) {
      console.log(`  ${r.role.padEnd(11)} ${String(r.assignedOpen).padStart(13)}  ${String(r.givenOpen).padStart(10)}  ${String(r.personalOpen).padStart(13)}  ${String(r.notifications).padStart(13)}  ${String(r.unread).padStart(6)}`);
    }
  }
  if (result.skipped.length > 0) console.log(`\n[seed:demo-extras] not in this database (skipped): ${result.skipped.join(", ")} — run \`pnpm seed:pilot\` first`);
}

async function main(): Promise<void> {
  loadDotEnv();
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") {
    console.error("[seed:demo-extras] refusing to run with NODE_ENV=production without SEED_ALLOW=1");
    process.exit(3);
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is not set (see .env.example)");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle({ client: pool, schema });
    printResult(await seedDemoExtras(db, { pruneLegacyStatus: process.argv.includes("--prune-legacy-status") }));
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error("[seed:demo-extras] FAILED:", err instanceof Error ? (err.stack ?? err.message) : err);
      process.exit(1);
    });
}
