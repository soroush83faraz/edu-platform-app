// workspace/service — business rules of the کارتابل. Every function is `(tx, ctx, input)` and runs inside the
// caller's tenant transaction (defineAction). `organization_id` and the acting person come from `ctx`, never
// from input. Each mutation writes its audit row and its notifications in the SAME transaction.
//
// Visibility rule (phase 1): an item is visible to its creator, to anyone with an inbox_entry for it (assignee,
// watcher) and to holders of a BROAD `workspace.work_item.read` (organization/school/branch scoped roles — admins,
// principals, vice principals — see all items of the organization; per-school partitioning is a later block) —
// except a personal `todo` (single self-assignee), which only its owner sees. Everyone else gets NOT_FOUND, never
// FORBIDDEN, so the existence of an item is not leaked.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { chunk } from "@/lib/collections";
import { forbidden, invalidReference, notFound, validation } from "@/lib/errors";
import { formatNumberFa } from "@/lib/format";
import { can, canAtAnyScope, canBroadly, type CanContext } from "@/modules/iam/can";
import { staffProfile } from "@/modules/iam/schema";
import { notifyMany } from "@/modules/notif/service";
import type { Recipients } from "./dto";
import {
  type AssigneeRow,
  type CommentRow,
  type MyInboxState,
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
import { inboxEntry, workItem, workItemAssignee, workItemComment, workItemTransition, workItemWatcher } from "./schema";

/** What the service needs from the request context (src/lib/ctx `Ctx` satisfies it; tests build one). */
export type WorkspaceCtx = AuditCtx & CanContext & { personId: string };

export const INSERT_CHUNK = 500;

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

async function resolveRecipients(tx: Tx, ctx: WorkspaceCtx, recipients: Recipients): Promise<string[]> {
  switch (recipients.kind) {
    case "self":
      return [ctx.personId];
    case "class_offering": {
      // Scoped check: the teacher of THIS offering, or a broad (school/organization) assignment.
      if (!(await can(tx, ctx, "workspace.work_item.assign_class", { scopeType: "class_offering", id: recipients.id }))) throw forbidden();
      const roster = await listOfferingRoster(tx, recipients.id);
      const excluded = new Set(recipients.excludePersonIds);
      const ids = roster.map((r) => r.personId).filter((id) => !excluded.has(id));
      if (ids.length === 0) throw validation({ fieldErrors: { recipients: ["این کلاس گیرندهٴ فعالی ندارد."] } });
      return ids;
    }
    case "persons": {
      // Free-form recipients are a staff-wide privilege (admins/principals); teachers send to their classes.
      if (!canBroadly(ctx.assignments, "workspace.work_item.create")) throw forbidden();
      const ids = await filterActivePersonIds(tx, recipients.ids);
      if (ids.length !== new Set(recipients.ids).size) throw invalidReference("یکی از گیرندگان یافت نشد.");
      return ids;
    }
  }
}

/**
 * Creates the item, N assignee rows, N unread inbox entries, the creator's watcher + read inbox entry
 * («کارهایی که دادم»), the first transition and N `work_item.assigned` notifications (deduped per person).
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
  if (!type) throw invalidReference("نوع کار یافت نشد.");
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

  const notified = await notifyMany(tx, ctx, others, {
    typeCode: "work_item.assigned",
    title: `کار جدید: ${input.title}`,
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

  const recipients = await commentRecipients(tx, item, ctx.personId, { staffOnly: visibility === "staff_only" && !assigneeOnMulti, assigneeOnMulti, assignees });
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
 * when EVERY assignee is done). Creator / broad `update` holders: any status; done marks all assignees done,
 * open (reopen) resets them to pending. The creator is notified on each assignee completion.
 */
export async function changeStatus(tx: Tx, ctx: WorkspaceCtx, input: ChangeStatusInput): Promise<ChangeStatusResult> {
  const item = await canViewWorkItem(tx, ctx, input.workItemId);
  if (item.archivedAt) throw validation(undefined, "این کار بایگانی شده است.");
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.update")) throw forbidden();
  const statuses = await listStatusesOfType(tx, item.typeId);
  const target = statuses.find((s) => s.code === input.toStatusCode);
  if (!target) throw validation(undefined, "این وضعیت برای این نوع کار وجود ندارد.");
  const note = input.note?.trim() ? input.note.trim() : null;

  const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
  const manager = item.createdByPersonId === ctx.personId || canBroadly(ctx.assignments, "workspace.work_item.update");
  const before = { statusCode: item.statusCode, myState: mine?.state ?? null };
  let itemChanged = false;
  let recipients: string[] = [];

  if (manager) {
    if (target.id === item.statusId) throw validation(undefined, "وضعیت تغییری نکرده است.");
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
    recipients = (await listAssignees(tx, item.id)).map((a) => a.personId).filter((id) => id !== ctx.personId);
  } else {
    if (!mine) throw forbidden();
    if (item.statusCategory === "cancelled" || item.statusCategory === "done") throw validation(undefined, "این کار بسته شده است.");
    if (target.category === "doing") {
      if (mine.state !== "pending") throw validation(undefined, "این کار را قبلاً شروع کرده‌اید.");
      await tx
        .update(workItemAssignee)
        .set({ state: "accepted" })
        .where(and(eq(workItemAssignee.workItemId, item.id), eq(workItemAssignee.personId, ctx.personId), eq(workItemAssignee.role, "assignee")));
      if (item.statusCategory === "todo") {
        await setItemStatus(tx, ctx, item, target, note);
        itemChanged = true;
      }
    } else if (target.category === "done") {
      if (mine.state === "done") throw validation(undefined, "این کار را قبلاً انجام‌شده علامت زده‌اید.");
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
      if (item.createdByPersonId !== ctx.personId) recipients = [item.createdByPersonId];
    } else {
      throw forbidden("فقط سازندهٴ کار می‌تواند آن را بازگشایی یا لغو کند.");
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
      title: manager ? `وضعیت «${item.title}»: ${target.name}` : `${actorName} «${item.title}» را ${target.name} کرد${progress}`,
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
    { statusCode: itemChanged ? target.code : item.statusCode, myState: myStateAfter, note },
    tx,
  );
  return { statusCode: itemChanged ? target.code : item.statusCode, itemChanged, assigneesDone: done, assigneesTotal: assignees.length };
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

/** Hides the item from MY list only (state = archived); the item itself and everyone else's view are untouched. */
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
      isManager: isCreator || canBroadly(ctx.assignments, "workspace.work_item.update"),
      isStaff: staff,
      canComment: canAtAnyScope(ctx.assignments, "workspace.work_item.comment"),
      canUpdate: canAtAnyScope(ctx.assignments, "workspace.work_item.update"),
    },
  };
}
