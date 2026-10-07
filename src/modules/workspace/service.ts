// workspace/service — business rules of the کارتابل. Every function is `(tx, ctx, input)` and runs inside the
// caller's tenant transaction (defineAction). `organization_id` and the acting person come from `ctx`, never
// from input. Each mutation writes its audit row and its notifications in the SAME transaction.
//
// Visibility rule (phase 1): an item is visible to its creator, to anyone with an inbox_entry for it (assignee,
// watcher) and to holders of a BROAD `workspace.work_item.read` (organization/school/branch scoped roles — admins,
// principals, vice principals — see all items of the organization; per-school partitioning is a later block) —
// except a personal `todo` (single self-assignee), which only its owner sees. Everyone else gets NOT_FOUND, never
// FORBIDDEN, so the existence of an item is not leaked.
import { and, asc, eq, exists, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { chunk } from "@/lib/collections";
import { forbidden, invalidReference, notFound, validation } from "@/lib/errors";
import { formatJalaliDateTime, formatNumberFa } from "@/lib/format";
import { can, canAtAnyScope, canBroadly, type CanContext } from "@/modules/iam/can";
import { type WorkItemVoice, type WorkItemWords, createVoice, workItemStatusLabel, workItemVoice, workItemWords } from "@/lib/work-item-words";
import { person, staffProfile } from "@/modules/iam/schema";
import { getPermissionScope } from "@/modules/iam/service";
import { notifyMany } from "@/modules/notif/service";
import type { Recipients } from "./dto";
import { managesItem } from "./manage-policy";
import { creationNotifiable, notifiable } from "./notify-policy";
import {
  type AssigneeRow,
  type CommentRow,
  type MyInboxState,
  type PersonReach,
  type Priority,
  type StatusRow,
  type TransitionRow,
  type WatcherRow,
  type WorkItemCore,
  findMyAssigneeRow,
  findMyInboxEntry,
  findPersonName,
  findTypeWithInitialStatus,
  findWorkItemCore,
  filterActivePersonIds,
  isStaff,
  listAssignees,
  listComments,
  listOfferingRoster,
  listStatusesOfType,
  listTransitions,
  listWatchers,
} from "./repo";
import { inboxEntry, workItem, workItemAssignee, workItemComment, workItemStatus, workItemTransition, workItemWatcher } from "./schema";

/** What the service needs from the request context (src/lib/ctx `Ctx` satisfies it; tests build one). */
export type WorkspaceCtx = AuditCtx & CanContext & { personId: string };

export const INSERT_CHUNK = 500;

/**
 * The nouns of the ACTOR — the person whose click produced this string. A teacher's «تکلیف» and an admin's «تسک»
 * (src/lib/work-item-words). Errors go back to the actor, so the actor's word is the right one; a stored
 * notification row is read by many people, and there it is the CREATOR's word — the item's own word — that is
 * written once (an admin who sends to students is the one mismatch, and «تسک» is then what its author called it).
 */
function nouns(ctx: WorkspaceCtx): WorkItemWords {
  return workItemWords(workItemVoice(ctx.assignments));
}

// ---------------------------------------------------------------------------------------------------------------
// visibility
// ---------------------------------------------------------------------------------------------------------------

/**
 * The item when the caller may see it; throws NOT_FOUND (never FORBIDDEN) otherwise. A personal item — one whose
 * ONLY assignee is its creator, whatever its type («کار شخصی», or a `task` someone gave themselves) — is visible
 * to that person alone: the broad `workspace.work_item.read` of managers does not reach it, so nobody else can
 * open or reopen it (QA round 1 m5; widened from `todo` only in round 2).
 */
export async function canViewWorkItem(tx: Tx, ctx: WorkspaceCtx, workItemId: string): Promise<WorkItemCore> {
  const item = await findWorkItemCore(tx, workItemId);
  if (!item) throw notFound();
  if (item.createdByPersonId === ctx.personId) return item;
  if (await findMyInboxEntry(tx, ctx.personId, workItemId)) return item;
  if (canBroadly(ctx.assignments, "workspace.work_item.read") && !(await isSelfAssigned(tx, item))) return item;
  throw notFound();
}

/**
 * The item's row lock, then the item as committed NOW (NOT_FOUND if it is gone). Every write that decides from the
 * item's status or its assignees takes it first — an edit, a status change (an assignee's «انجام شد», «اتمام», «حذف»,
 * «بازیابی») and a removed person's withdrawal — so on one item they run one after another and each reads what the
 * one before committed: an edit never lands on an item closed meanwhile, two last «انجام شد» close it, a withdrawal
 * racing the last «انجام شد» closes it. Its own statement (not `FOR … OF` on `findWorkItemCore`): after a wait
 * PostgreSQL would re-check that read's status join against the OLD status row and drop the item. FOR NO KEY UPDATE —
 * exactly what the UPDATE of the item takes anyway — so comments, inbox rows and transitions that only reference the
 * item (their foreign-key checks take KEY SHARE) are not held up. Callers take `lockItemPeople` first. Lock order:
 * iam/removal «Concurrency».
 */
async function lockWorkItem(tx: Tx, workItemId: string): Promise<WorkItemCore> {
  await tx.select({ id: workItem.id }).from(workItem).where(eq(workItem.id, workItemId)).for("no key update");
  const item = await findWorkItemCore(tx, workItemId);
  if (!item) throw notFound();
  return item;
}

/**
 * FOR KEY SHARE, in ascending id order, on the person rows a write on this item will reference — the actor (the
 * transition's `by_person_id`) and every assignee (a notification's recipient; the person status a reopening reads) —
 * BEFORE `lockWorkItem`. Those inserts' foreign-key checks take exactly this lock: taken there, after the item's lock,
 * they would invert the lock order and deadlock with a removal, which holds its person FOR UPDATE and then locks that
 * person's open items. Here a removal in flight is waited for first, and one that starts later waits for this
 * transaction. Assignee rows are never added to an existing item, so the set read here covers every later recipient.
 */
async function lockItemPeople(tx: Tx, ctx: WorkspaceCtx, workItemId: string): Promise<void> {
  const assignees = tx.select({ id: workItemAssignee.personId }).from(workItemAssignee).where(eq(workItemAssignee.workItemId, workItemId));
  await tx
    .select({ id: person.id })
    .from(person)
    .where(or(eq(person.id, ctx.personId), inArray(person.id, assignees)))
    .orderBy(asc(person.id))
    .for("key share");
}

/** Exactly one assignee row, and that assignee is the creator — any type. One indexed query, only on the broad-reader branch. */
async function isSelfAssigned(tx: Tx, item: WorkItemCore): Promise<boolean> {
  const assignees = await tx
    .select({ personId: workItemAssignee.personId })
    .from(workItemAssignee)
    .where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.role, "assignee")))
    .limit(2);
  return assignees.length === 1 && assignees[0].personId === item.createdByPersonId;
}

// ---------------------------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------------------------

export interface CreateWorkItemInput {
  typeCode: "task" | "todo";
  title: string;
  description?: string | null;
  priority: Priority;
  dueAt?: Date | null;
  recipients: Recipients;
  /** Client-generated UUID v7 of one «کار جدید» form; a resubmit within `IDEMPOTENCY_WINDOW_MS` returns the first item. */
  idempotencyKey?: string | null;
}

export interface CreateWorkItemResult {
  id: string;
  assigneeCount: number;
  notified: number;
  /** True when an earlier submit with the same idempotency key was returned instead of a new item. */
  duplicate?: boolean;
}

export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Who the caller may name as `persons` recipients — and find in the «اشخاص» picker (`searchPersonsQuery`), so the
 * picker offers exactly what the submit accepts. FORBIDDEN without a BROAD `workspace.work_item.create` (a teacher
 * sends to her classes, a student only to «خودم»). Otherwise the people inside that permission's scope
 * (`getPermissionScope` → `personInScopeSql`, the admin people lists' rule): the organization admin reaches everyone
 * of the organization; a school manager (principal or vice principal) only the people ANCHORED in their own schools —
 * never another school's people and never an organization-scoped person such as the organization admin — plus
 * themselves.
 */
export async function personReach(tx: Tx, ctx: WorkspaceCtx): Promise<PersonReach> {
  if (!canBroadly(ctx.assignments, "workspace.work_item.create")) throw forbidden();
  return { scope: await getPermissionScope(tx, ctx, "workspace.work_item.create"), selfId: ctx.personId };
}

async function resolveRecipients(tx: Tx, ctx: WorkspaceCtx, recipients: Recipients): Promise<string[]> {
  switch (recipients.kind) {
    case "self":
      return [ctx.personId];
    case "class_offering": {
      // Scoped check: the teacher of THIS offering, or a broad (school/organization) assignment.
      if (!(await can(tx, ctx, "workspace.work_item.assign_class", { scopeType: "class_offering", id: recipients.id }))) throw forbidden();
      // Locked (KEY SHARE): a student removed at this moment is waited for and drops out (repo `RecipientReadOptions`).
      const roster = await listOfferingRoster(tx, recipients.id, { lock: true });
      const excluded = new Set(recipients.excludePersonIds);
      const ids = roster.map((r) => r.personId).filter((id) => !excluded.has(id));
      if (ids.length === 0) throw validation({ fieldErrors: { recipients: ["این کلاس گیرندهٴ فعالی ندارد."] } });
      return ids;
    }
    case "persons": {
      // Free-form recipients are a staff-wide privilege (admins/principals) inside their own reach; teachers send
      // to their classes. An id outside the reach gets the very answer an unknown, inactive or other-tenant id gets
      // (no oracle for «exists in another school»), and it is refused before the item or any row is written.
      const reach = await personReach(tx, ctx);
      const wanted = [...new Set(recipients.ids)];
      // Locked like the roster: a person removed at this moment is waited for and then refused like any inactive id.
      const ids = await filterActivePersonIds(tx, wanted, reach, { lock: true });
      if (ids.length !== wanted.length) throw invalidReference("یکی از گیرندگان یافت نشد.");
      return ids;
    }
  }
}

/**
 * Creates the item, N assignee rows, N unread inbox entries, the creator's watcher + read inbox entry
 * («کارهایی که دادم»), the first transition and N `work_item.assigned` notifications (deduped per person) —
 * none for a personal item or a student's (`creationNotifiable`, ./notify-policy).
 */
export async function createWorkItem(tx: Tx, ctx: WorkspaceCtx, input: CreateWorkItemInput): Promise<CreateWorkItemResult> {
  if (input.idempotencyKey) {
    // A double tap / retried request: the same person sent this form already — hand back the item it created.
    const [existing] = await tx
      .select({ id: workItem.id, n: sql<number>`(select count(*)::int from ${workItemAssignee} a where a.work_item_id = ${workItem.id} and a.role = 'assignee')` })
      .from(workItem)
      .where(and(eq(workItem.createdByPersonId, ctx.personId), eq(workItem.idempotencyKey, input.idempotencyKey), gt(workItem.createdAt, new Date(Date.now() - IDEMPOTENCY_WINDOW_MS))))
      .limit(1);
    if (existing) return { id: existing.id, assigneeCount: existing.n, notified: 0, duplicate: true };
  }
  const type = await findTypeWithInitialStatus(tx, input.typeCode);
  if (!type) throw invalidReference(`نوع ${nouns(ctx).singular} یافت نشد.`);
  const recipientIds = [...new Set(await resolveRecipients(tx, ctx, input.recipients))];
  const creatorName = (await findPersonName(tx, ctx.personId)) ?? "";

  const [wi] = await tx
    .insert(workItem)
    .values({
      organizationId: ctx.orgId,
      typeId: type.typeId,
      statusId: type.initialStatusId,
      title: input.title,
      description: input.description?.trim() ? input.description.trim() : null,
      priority: input.priority,
      dueAt: input.dueAt ?? null,
      createdByPersonId: ctx.personId,
      visibility: "assignees",
      idempotencyKey: input.idempotencyKey ?? null,
      // A class task belongs to its درس: the subject page lists it (`listInbox({ offeringId })`).
      classOfferingId: input.recipients.kind === "class_offering" ? input.recipients.id : null,
    })
    .returning({ id: workItem.id });

  for (const part of chunk(recipientIds, INSERT_CHUNK)) {
    await tx.insert(workItemAssignee).values(
      part.map((personId) => ({ workItemId: wi.id, personId, organizationId: ctx.orgId, role: "assignee" as const, state: "pending" as const })),
    );
  }
  const others = recipientIds.filter((id) => id !== ctx.personId);
  for (const part of chunk(others, INSERT_CHUNK)) {
    await tx.insert(inboxEntry).values(
      part.map((personId) => ({ organizationId: ctx.orgId, personId, workItemId: wi.id, relation: "assignee" as const, state: "unread" as const })),
    );
  }
  // The creator watches the item and sees it as read (it shows under «کارهایی که دادم»); for a self item she is
  // the assignee, so the single inbox row keeps relation = assignee.
  await tx.insert(workItemWatcher).values({ workItemId: wi.id, personId: ctx.personId, organizationId: ctx.orgId, reason: "creator" });
  await tx.insert(inboxEntry).values({
    organizationId: ctx.orgId,
    personId: ctx.personId,
    workItemId: wi.id,
    relation: recipientIds.includes(ctx.personId) ? "assignee" : "creator",
    state: "read",
    firstSeenAt: sql`now()`,
  });
  await tx.insert(workItemTransition).values({ organizationId: ctx.orgId, workItemId: wi.id, fromStatusId: null, toStatusId: type.initialStatusId, byPersonId: ctx.personId });

  const notified = await notifyMany(tx, ctx, creationNotifiable(ctx.assignments, input.recipients.kind, others), {
    typeCode: "work_item.assigned",
    title: `${nouns(ctx).new}: ${input.title}`,
    body: creatorName,
    sourceKind: "work_item",
    sourceId: wi.id,
    deepLink: `/inbox/${wi.id}`,
    dedupeKey: (personId) => `wi:${wi.id}:assigned:${personId}`,
  });

  await audit(
    ctx,
    "workspace.work_item.created",
    { schema: "workspace", table: "work_item", id: wi.id },
    null,
    { typeCode: input.typeCode, title: input.title, priority: input.priority, dueAt: input.dueAt ?? null, recipients: input.recipients.kind, assigneeCount: recipientIds.length },
    tx,
  );
  return { id: wi.id, assigneeCount: recipientIds.length, notified };
}

// ---------------------------------------------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------------------------------------------

export interface AddCommentInput {
  workItemId: string;
  body: string;
  visibility?: "all" | "staff_only";
}

/**
 * Who a comment reaches (phase-1 rule, docs/workspace.md «نظرها»):
 * - an ASSIGNEE's comment on an item with MORE THAN ONE assignee («انجام دادم» on a class task) goes to the creator
 *   and the watchers only — never to the other assignees (a 25-student class does not get 24 notifications and 24
 *   unread flips per student comment, and one student's words are not shown to the whole class);
 * - a creator's / staff comment reaches everyone attached (creator, assignees, watchers);
 * - `staff_only` narrows either set to people with a staff profile.
 * The author is never a recipient.
 */
async function commentRecipients(tx: Tx, item: WorkItemCore, authorId: string, opts: { staffOnly: boolean; assigneeOnMulti: boolean; assignees: AssigneeRow[] }): Promise<string[]> {
  // Sequential on purpose: one pg client per transaction, and pg@9 drops overlapping queries.
  const watchers = await listWatchers(tx, item.id);
  const ids = new Set<string>([item.createdByPersonId, ...watchers.map((w) => w.personId)]);
  if (!opts.assigneeOnMulti) for (const a of opts.assignees) ids.add(a.personId);
  ids.delete(authorId);
  if (ids.size === 0) return [];
  if (!opts.staffOnly) return [...ids];
  const staff = await tx.select({ personId: staffProfile.personId }).from(staffProfile).where(inArray(staffProfile.personId, [...ids]));
  return staff.map((s) => s.personId);
}

export async function addComment(tx: Tx, ctx: WorkspaceCtx, input: AddCommentInput): Promise<{ id: string; visibility: "all" | "staff_only" }> {
  const item = await canViewWorkItem(tx, ctx, input.workItemId);
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.comment")) throw forbidden();
  const body = input.body.trim();
  if (body.length === 0) throw validation({ fieldErrors: { body: ["متن نظر را وارد کنید."] } });
  const staff = await isStaff(tx, ctx.personId);
  const assignees = await listAssignees(tx, item.id);
  // An assignee (who is not the creator) writing on a multi-assignee item: the comment is for the creator and the
  // staff — stored `staff_only` so the read model hides it from classmates (the author still sees their own).
  const assigneeOnMulti = assignees.length > 1 && item.createdByPersonId !== ctx.personId && assignees.some((a) => a.personId === ctx.personId);
  // An explicit staff_only is only meaningful for staff; anyone else's request is ignored (they post to everyone).
  const visibility = assigneeOnMulti || (input.visibility === "staff_only" && staff) ? "staff_only" : "all";

  const [c] = await tx
    .insert(workItemComment)
    .values({ organizationId: ctx.orgId, workItemId: item.id, authorPersonId: ctx.personId, body, visibility })
    .returning({ id: workItemComment.id });

  // A student's comment is silent for everyone (./notify-policy). No UI adds comments any more (owner, round 7:
  // «no comments and no conversation for now»); the service stays for the channel that will replace them.
  const recipients = notifiable(ctx.assignments, await commentRecipients(tx, item, ctx.personId, { staffOnly: visibility === "staff_only" && !assigneeOnMulti, assigneeOnMulti, assignees }));
  if (recipients.length > 0) {
    const authorName = (await findPersonName(tx, ctx.personId)) ?? "";
    const excerpt = body.length > 80 ? `${body.slice(0, 80)}…` : body;
    await notifyMany(tx, ctx, recipients, {
      typeCode: "work_item.comment",
      title: `نظر جدید: ${item.title}`,
      body: `${authorName}: ${excerpt}`,
      sourceKind: "work_item",
      sourceId: item.id,
      deepLink: `/inbox/${item.id}`,
    });
    await tx
      .update(inboxEntry)
      .set({ state: "unread" })
      .where(and(eq(inboxEntry.workItemId, item.id), inArray(inboxEntry.personId, recipients), eq(inboxEntry.state, "read")));
  }

  await audit(ctx, "workspace.work_item_comment.created", { schema: "workspace", table: "work_item_comment", id: c.id }, null, { workItemId: item.id, visibility, length: body.length }, tx);
  return { id: c.id, visibility };
}

// ---------------------------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------------------------

export interface ChangeStatusInput {
  workItemId: string;
  toStatusCode: string;
  note?: string | null;
}

export interface ChangeStatusResult {
  statusCode: string;
  /** Item status changed (as opposed to only the caller's own assignee state). */
  itemChanged: boolean;
  assigneesDone: number;
  assigneesTotal: number;
}

async function setItemStatus(tx: Tx, ctx: WorkspaceCtx, item: WorkItemCore, to: StatusRow, note: string | null): Promise<void> {
  const completedAt = to.category === "done" ? sql`now()` : null;
  await tx.update(workItem).set({ statusId: to.id, completedAt }).where(eq(workItem.id, item.id));
  await tx.insert(workItemTransition).values({ organizationId: ctx.orgId, workItemId: item.id, fromStatusId: item.statusId, toStatusId: to.id, byPersonId: ctx.personId, note });
}

/**
 * Assignees: open → in_progress (own state `accepted`), → done (own state `done`; the item flips to done only
 * when EVERY assignee is done). Managers (`managesItem`, ./manage-policy — the creator, or a broad `update` holder
 * who is NOT one of the assignees): any status; done marks all assignees done, open («بازیابی») resets them to
 * pending, cancelled is the UI's «حذف» (soft: nothing is deleted, «بازیابی» brings it back). An assignee who did not
 * create the item takes the assignee path whatever their hats — a principal given a تسک by the organization admin
 * marks their own row only. An assignee's own completion notifies no one (owner, round 7); the giver reads the n/m
 * on the item.
 */
export async function changeStatus(tx: Tx, ctx: WorkspaceCtx, input: ChangeStatusInput): Promise<ChangeStatusResult> {
  await canViewWorkItem(tx, ctx, input.workItemId);
  // Everything below reads the item under its row lock (`lockWorkItem`), its people locked before it.
  await lockItemPeople(tx, ctx, input.workItemId);
  const item = await lockWorkItem(tx, input.workItemId);
  if (item.archivedAt) throw validation(undefined, `این ${nouns(ctx).singular} بایگانی شده است.`);
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.update")) throw forbidden();
  const statuses = await listStatusesOfType(tx, item.typeId);
  const target = statuses.find((s) => s.code === input.toStatusCode);
  if (!target) throw validation(undefined, `این وضعیت برای این نوع ${nouns(ctx).singular} وجود ندارد.`);
  const note = input.note?.trim() ? input.note.trim() : null;

  const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
  const manager = managesItem(ctx, item, mine !== null);
  const before = { statusCode: item.statusCode, myState: mine?.state ?? null };
  let itemChanged = false;
  let recipients: string[] = [];
  let withdrawnAssignees: WithdrawnFromItem[] = [];

  if (manager) {
    if (target.id === item.statusId) throw validation(undefined, "وضعیت تغییری نکرده است.");
    // Open again, or started over: a removed person does not come back with it (`withdrawArchivedAssignees`).
    if (target.category === "todo" || target.category === "doing") withdrawnAssignees = await withdrawArchivedAssignees(tx, item, { includeDone: target.category === "todo" });
    await setItemStatus(tx, ctx, item, target, note);
    if (target.category === "done") {
      await tx
        .update(workItemAssignee)
        .set({ state: "done", respondedAt: sql`coalesce(${workItemAssignee.respondedAt}, now())` })
        .where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.role, "assignee")));
    } else if (target.category === "todo") {
      await tx.update(workItemAssignee).set({ state: "pending", respondedAt: null }).where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.role, "assignee")));
    }
    itemChanged = true;
    // A student is a «manager» only of their own تسک, whose sole assignee is themselves — silent either way.
    recipients = notifiable(ctx.assignments, (await listAssignees(tx, item.id)).map((a) => a.personId).filter((id) => id !== ctx.personId));
  } else {
    if (!mine) throw forbidden();
    if (item.statusCategory === "cancelled" || item.statusCategory === "done") throw validation(undefined, `این ${nouns(ctx).singular} بسته شده است.`);
    if (target.category === "doing") {
      if (mine.state !== "pending") throw validation(undefined, `این ${nouns(ctx).singular} را قبلاً شروع کرده‌اید.`);
      await tx
        .update(workItemAssignee)
        .set({ state: "accepted" })
        .where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.personId, ctx.personId), eq(workItemAssignee.role, "assignee")));
      if (item.statusCategory === "todo") {
        await setItemStatus(tx, ctx, item, target, note);
        itemChanged = true;
      }
    } else if (target.category === "done") {
      if (mine.state === "done") throw validation(undefined, `این ${nouns(ctx).singular} را قبلاً انجام‌شده علامت زده‌اید.`);
      await tx
        .update(workItemAssignee)
        .set({ state: "done", respondedAt: sql`now()` })
        .where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.personId, ctx.personId), eq(workItemAssignee.role, "assignee")));
      const remaining = await tx
        .select({ personId: workItemAssignee.personId })
        .from(workItemAssignee)
        .where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.role, "assignee"), sql`${workItemAssignee.state} <> 'done'`));
      if (remaining.length === 0) {
        await setItemStatus(tx, ctx, item, target, note);
        itemChanged = true;
      }
      // An assignee's «انجام شد» is silent for everyone (owner, round 7): the giver reads the n/m on the item.
    } else {
      throw forbidden(`فقط دهندهٴ ${nouns(ctx).singular} می‌تواند آن را بازیابی یا حذف کند.`);
    }
  }

  const assignees = await listAssignees(tx, item.id);
  const done = assignees.filter((a) => a.state === "done").length;
  const myStateAfter = assignees.find((a) => a.personId === ctx.personId)?.state ?? null;
  if (recipients.length > 0) {
    const actorName = (await findPersonName(tx, ctx.personId)) ?? "";
    const progress = assignees.length > 1 ? ` (${formatNumberFa(done)}/${formatNumberFa(assignees.length)})` : "";
    await notifyMany(tx, ctx, recipients, {
      typeCode: "work_item.status_changed",
      title: manager ? `وضعیت «${item.title}»: ${workItemStatusLabel(target.name)}` : `${actorName} «${item.title}» را ${workItemStatusLabel(target.name)} کرد${progress}`,
      body: note,
      sourceKind: "work_item",
      sourceId: item.id,
      deepLink: `/inbox/${item.id}`,
    });
    await tx
      .update(inboxEntry)
      .set({ state: "unread" })
      .where(and(eq(inboxEntry.workItemId, item.id), inArray(inboxEntry.personId, recipients), eq(inboxEntry.state, "read")));
  }

  await audit(
    ctx,
    "workspace.work_item.status_changed",
    { schema: "workspace", table: "work_item", id: item.id },
    before,
    // The removed people a reopening took out are history: a restore by hand re-inserts these rows.
    { statusCode: itemChanged ? target.code : item.statusCode, myState: myStateAfter, note, ...(withdrawnAssignees.length > 0 ? { withdrawnAssignees } : {}) },
    tx,
  );
  return { statusCode: itemChanged ? target.code : item.statusCode, itemChanged, assigneesDone: done, assigneesTotal: assignees.length };
}

// ---------------------------------------------------------------------------------------------------------------
// a removed person («حذف دانش‌آموز» / «حذف از کارکنان», iam/removal)
// ---------------------------------------------------------------------------------------------------------------

export interface WithdrawnAssignment {
  workItemId: string;
  /** The state the row had (never `done`) — what a restore by hand re-inserts. */
  state: string;
}

export interface WithdrawRemovedAssigneeResult {
  withdrawn: WithdrawnAssignment[];
  /** Items whose every REMAINING assignee had already finished: flipped to done, as the last «انجام شد» would. */
  completedWorkItemIds: string[];
}

/** The transition note of an item closed because its last unfinished assignee was removed (shown on the item). */
export const WITHDRAWN_COMPLETION_NOTE = "با حذف گیرنده‌ای که انجام نداده بود، همهٴ گیرندگان انجام داده‌اند.";

/**
 * Owner, 2026-10-07: a removed person drops out of the counts of OPEN items; on finished or cancelled ones they stay
 * as history. Inside the removal's transaction: every assignee row of `personId` that is not `done`, on an item that
 * is still open (category todo/doing, not archived) and that somebody ELSE gave, is deleted — so the giver's n/m,
 * the «all done → item done» rule, the notification recipients and the roster on the item all agree without a filter
 * in any reader. The person's own items (a personal note, a تسک they gave themselves) are left alone: deleting
 * their only assignee would make a private item visible to managers (`isSelfAssigned`). The deleted rows are the
 * history the caller writes to its audit row; the person's inbox entries for those items are archived. An item
 * whose remaining assignees have ALL finished flips to the type's done status (transition + audit row, silent like
 * an assignee's own last «انجام شد»); an item with no assignee left stays as it is, for its giver to close.
 * Idempotent: a second call finds no row.
 *
 * Concurrency: the candidate items are locked FOR NO KEY UPDATE like `lockWorkItem` does for one, in ascending id
 * order (two removals sharing items never wait on each other in a circle), and read AGAIN under the locks — an item
 * closed meanwhile, or the person's own «انجام شد» committed meanwhile, keeps them; another assignee's «انجام شد»
 * racing this waits or is waited for, so whichever runs second sees the other and closes the item. Before the items,
 * the actor's person row FOR KEY SHARE (the flip's transition references it), as `lockItemPeople` does. The caller
 * holds the removed person's row first (iam/removal «Concurrency») — what a status change or edit of any item of
 * theirs waits for (`lockItemPeople`), a «بازیابی» of one they are history on included (`withdrawArchivedAssignees`).
 */
export async function withdrawRemovedAssignee(tx: Tx, ctx: WorkspaceCtx, personId: string): Promise<WithdrawRemovedAssigneeResult> {
  const openItemsOfPerson = (onlyIds?: string[]) =>
    tx
      .select({ workItemId: workItemAssignee.workItemId })
      .from(workItemAssignee)
      .innerJoin(workItem, eq(workItem.id, workItemAssignee.workItemId))
      .innerJoin(workItemStatus, eq(workItemStatus.id, workItem.statusId))
      .where(
        and(
          eq(workItemAssignee.personId, personId),
          eq(workItemAssignee.role, "assignee"),
          ne(workItemAssignee.state, "done"),
          ne(workItem.createdByPersonId, personId),
          isNull(workItem.archivedAt),
          inArray(workItemStatus.category, ["todo", "doing"]),
          onlyIds ? inArray(workItemAssignee.workItemId, onlyIds) : undefined,
        ),
      );
  const candidates = [...new Set((await openItemsOfPerson()).map((r) => r.workItemId))].sort();
  if (candidates.length === 0) return { withdrawn: [], completedWorkItemIds: [] };
  await tx.select({ id: person.id }).from(person).where(eq(person.id, ctx.personId)).for("key share");
  for (const part of chunk(candidates, INSERT_CHUNK)) {
    await tx.select({ id: workItem.id }).from(workItem).where(inArray(workItem.id, part)).orderBy(asc(workItem.id)).for("no key update");
  }
  const stillOpen = new Set((await openItemsOfPerson(candidates)).map((r) => r.workItemId));

  // The rows actually taken out, with the state each had, are the history the caller audits.
  const withdrawn: WithdrawnAssignment[] = [];
  for (const part of chunk(candidates.filter((id) => stillOpen.has(id)), INSERT_CHUNK)) {
    const deleted = await tx
      .delete(workItemAssignee)
      .where(and(eq(workItemAssignee.personId, personId), eq(workItemAssignee.role, "assignee"), ne(workItemAssignee.state, "done"), inArray(workItemAssignee.workItemId, part)))
      .returning({ workItemId: workItemAssignee.workItemId, state: workItemAssignee.state });
    if (deleted.length === 0) continue;
    withdrawn.push(...deleted);
    await tx
      .update(inboxEntry)
      .set({ state: "archived" })
      .where(and(eq(inboxEntry.personId, personId), inArray(inboxEntry.workItemId, deleted.map((d) => d.workItemId)), ne(inboxEntry.state, "archived")));
  }
  const ids = withdrawn.map((w) => w.workItemId);

  const completedWorkItemIds: string[] = [];
  for (const part of chunk(ids, INSERT_CHUNK)) {
    const tallies = await tx
      .select({
        workItemId: workItemAssignee.workItemId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`(count(*) filter (where ${workItemAssignee.state} = 'done'))::int`,
      })
      .from(workItemAssignee)
      .where(and(inArray(workItemAssignee.workItemId, part), eq(workItemAssignee.role, "assignee")))
      .groupBy(workItemAssignee.workItemId);
    for (const t of tallies) {
      if (t.total === 0 || t.done < t.total) continue;
      const item = await findWorkItemCore(tx, t.workItemId);
      if (!item) continue;
      const target = (await listStatusesOfType(tx, item.typeId)).find((s) => s.category === "done");
      if (!target) continue;
      await setItemStatus(tx, ctx, item, target, WITHDRAWN_COMPLETION_NOTE);
      await audit(
        ctx,
        "workspace.work_item.status_changed",
        { schema: "workspace", table: "work_item", id: item.id },
        { statusCode: item.statusCode, myState: null },
        { statusCode: target.code, myState: null, note: WITHDRAWN_COMPLETION_NOTE, withdrawnPersonId: personId },
        tx,
      );
      completedWorkItemIds.push(item.id);
    }
  }
  return { withdrawn, completedWorkItemIds };
}

export interface WithdrawnFromItem {
  personId: string;
  /** The state the row had before the transition — what a restore by hand re-inserts. */
  state: string;
}

/**
 * A manager's transition that leaves the item OPEN (owner: a removed person never counts on an open item) takes out
 * the assignees whose person was removed (archived), the way `withdrawRemovedAssignee` does — the row deleted, their
 * inbox entry archived — instead of starting them over or counting them. On «بازیابی» (→ todo, which resets everyone
 * to pending) all of them go; on another reopening (→ in progress) only those who had not finished, as on any open
 * item. Never on an item they gave themselves (the same exception). Returns the rows taken out for the transition's
 * audit row.
 *
 * Their status is read with no lock of its own — the caller holds the item's lock, and a person locked after a work
 * item would invert the lock order (iam/removal «Concurrency»). It needs none: the caller took every assignee's person
 * row FOR KEY SHARE before the item (`lockItemPeople`), which a removal's FOR UPDATE conflicts with. So a removal in
 * flight was waited for and committed — this read sees `archived` — or it waits for this transaction and then finds
 * the item open and withdraws them itself (`withdrawRemovedAssignee`).
 */
async function withdrawArchivedAssignees(tx: Tx, item: WorkItemCore, opts: { includeDone: boolean }): Promise<WithdrawnFromItem[]> {
  const deleted = await tx
    .delete(workItemAssignee)
    .where(
      and(
        eq(workItemAssignee.workItemId, item.id),
        eq(workItemAssignee.role, "assignee"),
        ne(workItemAssignee.personId, item.createdByPersonId),
        opts.includeDone ? undefined : ne(workItemAssignee.state, "done"),
        exists(tx.select({ id: person.id }).from(person).where(and(eq(person.id, workItemAssignee.personId), eq(person.status, "archived")))),
      ),
    )
    .returning({ personId: workItemAssignee.personId, state: workItemAssignee.state });
  if (deleted.length > 0) {
    await tx
      .update(inboxEntry)
      .set({ state: "archived" })
      .where(and(eq(inboxEntry.workItemId, item.id), inArray(inboxEntry.personId, deleted.map((d) => d.personId)), ne(inboxEntry.state, "archived")));
  }
  return deleted;
}

// ---------------------------------------------------------------------------------------------------------------
// edit («ویرایش»)
// ---------------------------------------------------------------------------------------------------------------

/** A PATCH: `undefined` keeps the field; `description: null` / `dueAt: null` clear it. */
export interface UpdateWorkItemInput {
  workItemId: string;
  title?: string;
  description?: string | null;
  priority?: Priority;
  dueAt?: Date | null;
}

type EditableField = "title" | "description" | "priority" | "dueAt";

export interface UpdateWorkItemResult {
  /** The fields that actually changed — empty for a save that changed nothing (no write, no audit, no notification). */
  changed: EditableField[];
  notified: number;
}

/** The Persian names of the content fields, for the notification body («عنوان و اولویت تغییر کرد»). */
const FIELD_FA: Record<Exclude<EditableField, "dueAt">, string> = { title: "عنوان", description: "توضیح", priority: "اولویت" };

function listFa(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join("، ")} و ${parts[parts.length - 1]}`;
}

/**
 * «ویرایش»: a manager of the item (`managesItem` — the creator, or a broad `update` holder who is not one of its
 * assignees; an assignee never edits what they were given) changes its title, description, priority and deadline.
 * The item must be open and not archived. A CHANGED deadline must lie in the future — earlier or later than the old
 * one, both fine — or be removed (an item may be created without one); an untouched one is never re-checked, so an
 * overdue item can still have its typo fixed. Nothing changed → nothing written. Otherwise one audit row
 * `workspace.work_item.updated` with the before/after of the changed fields only, and every assignee is told in ONE
 * notification: a moved deadline is `work_item.due_extended` (deduped per new due value, as «تمدید» always was —
 * «… تمدید شد» when it moved later, «… تغییر کرد» / «… برداشته شد» otherwise, the content changes named in its
 * body), a content-only edit is `work_item.updated`. Their inbox rows flip back to unread either way.
 */
export async function updateWorkItem(tx: Tx, ctx: WorkspaceCtx, input: UpdateWorkItemInput): Promise<UpdateWorkItemResult> {
  await canViewWorkItem(tx, ctx, input.workItemId);
  // Under the item's row lock (`lockWorkItem`, its people locked before it): an «اتمام» / «حذف» committed meanwhile is
  // seen below and refused, and the audit `before` is the item as it is now.
  await lockItemPeople(tx, ctx, input.workItemId);
  const item = await lockWorkItem(tx, input.workItemId);
  const noun = nouns(ctx).singular;
  if (item.archivedAt) throw validation(undefined, `این ${noun} بایگانی شده است.`);
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.update")) throw forbidden();
  const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
  if (!managesItem(ctx, item, mine !== null)) throw forbidden(`فقط دهندهٴ ${noun} می‌تواند آن را ویرایش کند.`);
  if (item.statusCategory === "done" || item.statusCategory === "cancelled") throw validation(undefined, `این ${noun} بسته شده است؛ برای ویرایش اول بازیابی کنید.`);

  const title = input.title?.trim();
  if (title !== undefined && title === "") throw validation({ fieldErrors: { title: ["عنوان را وارد کنید."] } });
  const description = input.description === undefined ? undefined : input.description?.trim() || null;

  const before: Partial<Record<EditableField, unknown>> = {};
  const after: Partial<Record<EditableField, unknown>> = {};
  const set: Partial<{ title: string; description: string | null; priority: Priority; dueAt: Date | null }> = {};
  if (title !== undefined && title !== item.title) {
    before.title = item.title;
    set.title = after.title = title;
  }
  if (description !== undefined && description !== item.description) {
    before.description = item.description;
    set.description = after.description = description;
  }
  if (input.priority !== undefined && input.priority !== item.priority) {
    before.priority = item.priority;
    set.priority = after.priority = input.priority;
  }
  const dueAt = input.dueAt;
  if (dueAt !== undefined && (dueAt?.getTime() ?? null) !== (item.dueAt?.getTime() ?? null)) {
    if (dueAt && dueAt.getTime() <= Date.now()) throw validation({ fieldErrors: { dueDate: ["مهلت جدید باید بعد از اکنون باشد."] } });
    before.dueAt = item.dueAt;
    set.dueAt = after.dueAt = dueAt;
  }
  const changed = Object.keys(after) as EditableField[];
  if (changed.length === 0) return { changed, notified: 0 };

  await tx.update(workItem).set(set).where(eq(workItem.id, item.id));

  const recipients = notifiable(ctx.assignments, (await listAssignees(tx, item.id)).map((a) => a.personId).filter((id) => id !== ctx.personId));
  let notified = 0;
  if (recipients.length > 0) {
    const shown = set.title ?? item.title;
    const content = changed.filter((f): f is Exclude<EditableField, "dueAt"> => f !== "dueAt").map((f) => FIELD_FA[f]);
    const common = { sourceKind: "work_item", sourceId: item.id, deepLink: `/inbox/${item.id}` } as const;
    if (set.dueAt !== undefined) {
      const newDue = set.dueAt;
      const heading =
        newDue === null
          ? `مهلت ${noun} «${shown}» برداشته شد`
          : item.dueAt && newDue > item.dueAt
            ? `مهلت ${noun} «${shown}» تا ${formatJalaliDateTime(newDue)} تمدید شد`
            : `مهلت ${noun} «${shown}» به ${formatJalaliDateTime(newDue)} تغییر کرد`;
      notified = await notifyMany(tx, ctx, recipients, {
        ...common,
        typeCode: "work_item.due_extended",
        title: heading,
        body: content.length > 0 ? `${listFa(content)} هم تغییر کرد.` : null,
        dedupeKey: (personId) => `wi:${item.id}:due:${newDue?.toISOString() ?? "none"}:${personId}`,
      });
    } else {
      notified = await notifyMany(tx, ctx, recipients, { ...common, typeCode: "work_item.updated", title: `${noun} «${shown}» ویرایش شد`, body: `${listFa(content)} تغییر کرد.` });
    }
    await tx
      .update(inboxEntry)
      .set({ state: "unread" })
      .where(and(eq(inboxEntry.workItemId, item.id), inArray(inboxEntry.personId, recipients), eq(inboxEntry.state, "read")));
  }

  await audit(ctx, "workspace.work_item.updated", { schema: "workspace", table: "work_item", id: item.id }, before, after, tx);
  return { changed, notified };
}

// ---------------------------------------------------------------------------------------------------------------
// personal inbox state
// ---------------------------------------------------------------------------------------------------------------

/** Read marker; no audit row (fires on every view — a personal, non-business state). */
export async function markInboxRead(tx: Tx, ctx: WorkspaceCtx, input: { workItemId: string }): Promise<{ changed: boolean }> {
  const rows = await tx
    .update(inboxEntry)
    .set({ state: "read", firstSeenAt: sql`coalesce(${inboxEntry.firstSeenAt}, now())` })
    .where(and(eq(inboxEntry.personId, ctx.personId), eq(inboxEntry.workItemId, input.workItemId), eq(inboxEntry.state, "unread")))
    .returning({ id: inboxEntry.id });
  return { changed: rows.length > 0 };
}

/** Pins MY inbox row. NO UI calls this (owner, round 5 — the «بیشتر» menu is gone); kept whole, see docs/workspace.md. */
export async function setPinned(tx: Tx, ctx: WorkspaceCtx, input: { workItemId: string; pinned: boolean }): Promise<{ pinned: boolean }> {
  const [row] = await tx
    .update(inboxEntry)
    .set({ isPinned: input.pinned })
    .where(and(eq(inboxEntry.personId, ctx.personId), eq(inboxEntry.workItemId, input.workItemId)))
    .returning({ id: inboxEntry.id });
  if (!row) throw notFound();
  await audit(ctx, "workspace.inbox_entry.pinned", { schema: "workspace", table: "inbox_entry", id: row.id }, { pinned: !input.pinned }, { pinned: input.pinned }, tx);
  return { pinned: input.pinned };
}

/**
 * Hides the item from MY list only (state = archived); the item itself and everyone else's view are untouched.
 * NO UI calls this either (owner, round 5): «حذف» is the creator's answer, not a personal archive.
 */
export async function archiveInbox(tx: Tx, ctx: WorkspaceCtx, input: { workItemId: string }): Promise<{ archived: true }> {
  const [row] = await tx
    .update(inboxEntry)
    .set({ state: "archived" })
    .where(and(eq(inboxEntry.personId, ctx.personId), eq(inboxEntry.workItemId, input.workItemId), sql`${inboxEntry.state} <> 'archived'`))
    .returning({ id: inboxEntry.id, state: inboxEntry.state });
  if (!row) throw notFound();
  await audit(ctx, "workspace.inbox_entry.archived", { schema: "workspace", table: "inbox_entry", id: row.id }, null, { state: "archived" }, tx);
  return { archived: true };
}

// ---------------------------------------------------------------------------------------------------------------
// detail read model
// ---------------------------------------------------------------------------------------------------------------

export interface WorkItemDetail {
  item: WorkItemCore;
  creatorName: string;
  assignees: AssigneeRow[];
  watchers: WatcherRow[];
  comments: CommentRow[];
  transitions: TransitionRow[];
  statuses: StatusRow[];
  myInbox: MyInboxState | null;
  myAssigneeState: AssigneeRow["state"] | null;
  viewer: {
    isCreator: boolean;
    isManager: boolean;
    isStaff: boolean;
    canComment: boolean;
    canUpdate: boolean;
    /** «تکلیف» or «تسک» — the noun this reader sees for the item (src/lib/work-item-words). */
    voice: WorkItemVoice;
    /** The reader's word for a کار of their OWN: `personal` for a student, whose todo is a «تسک». */
    createVoice: WorkItemVoice;
  };
}

export async function getWorkItemDetail(tx: Tx, ctx: WorkspaceCtx, workItemId: string): Promise<WorkItemDetail> {
  const item = await canViewWorkItem(tx, ctx, workItemId);
  const staff = await isStaff(tx, ctx.personId);
  // Sequential on purpose: one pg client per transaction (overlapping queries are deprecated in pg).
  const creatorName = await findPersonName(tx, item.createdByPersonId);
  const assignees = await listAssignees(tx, item.id);
  const watchers = await listWatchers(tx, item.id);
  // Staff see every comment; an assignee sees `all` comments plus their own (their «انجام دادم» on a class task is
  // stored staff_only — see addComment).
  const comments = await listComments(tx, item.id, { personId: ctx.personId, isStaff: staff });
  const transitions = await listTransitions(tx, item.id);
  const statuses = await listStatusesOfType(tx, item.typeId);
  const myInbox = await findMyInboxEntry(tx, ctx.personId, item.id);
  const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
  const isCreator = item.createdByPersonId === ctx.personId;
  return {
    item,
    creatorName: creatorName ?? "",
    assignees,
    watchers,
    comments,
    transitions,
    statuses,
    myInbox,
    myAssigneeState: mine?.state ?? null,
    viewer: {
      isCreator,
      // The one rule `changeStatus` / `updateWorkItem` enforce (./manage-policy): a broad holder who is an ASSIGNEE of
      // someone else's item reads it as an assignee — «انجام شد» only, no «اتمام» / «ویرایش» / «حذف» / «بازیابی».
      isManager: managesItem(ctx, item, mine !== null),
      isStaff: staff,
      canComment: canAtAnyScope(ctx.assignments, "workspace.work_item.comment"),
      canUpdate: canAtAnyScope(ctx.assignments, "workspace.work_item.update"),
      voice: workItemVoice(ctx.assignments),
      createVoice: createVoice(ctx.assignments),
    },
  };
}
