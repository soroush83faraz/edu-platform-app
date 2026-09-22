import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { fileObject } from "./files";
import { person } from "./iam";
import { classOffering, orgFk, organization } from "./tenancy";

export const workspace = pgSchema("workspace");

/**
 * Kinds of work items (todo, task, admin_request, reminder, approval). `organization_id NULL` = system type
 * seeded by app_owner and readable by every tenant — same RLS shape as iam.role (per-command policies from
 * app.apply_rls(), nullability read from information_schema). Tenant-defined types are not part of phase 1.
 */
export const workItemType = workspace.table(
  "work_item_type",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organization.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Name of an extension table holding type-specific columns (none in phase 1). */
    extensionTable: text("extension_table"),
    allowRecurrence: boolean("allow_recurrence").notNull().default(false),
    requiresAssignee: boolean("requires_assignee").notNull().default(true),
    defaultSettings: jsonb("default_settings").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [unique("work_item_type_org_code_uq").on(t.organizationId, t.code).nullsNotDistinct()],
);

/** GLOBAL catalog under a type (no organization_id, no RLS): seed-managed; app_rw SELECT only (apply_grants). */
export const workItemStatus = workspace.table(
  "work_item_status",
  {
    id: id(),
    workItemTypeId: uuid("work_item_type_id")
      .notNull()
      .references(() => workItemType.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    sequence: integer("sequence").notNull(),
    isTerminal: boolean("is_terminal").notNull().default(false),
  },
  (t) => [
    unique("work_item_status_type_code_uq").on(t.workItemTypeId, t.code),
    check("work_item_status_category_chk", sql`${t.category} IN ('todo', 'doing', 'done', 'cancelled')`),
  ],
);

export const workItem = workspace.table(
  "work_item",
  {
    id: id(),
    organizationId: orgFk(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => workItemType.id, { onDelete: "restrict" }),
    statusId: uuid("status_id")
      .notNull()
      .references(() => workItemStatus.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("normal"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").notNull(),
    parentWorkItemId: uuid("parent_work_item_id"),
    /** No recurrence table in phase 1 — kept so a later step can add the FK additively. */
    recurrenceRuleId: uuid("recurrence_rule_id"),
    recurrenceSourceId: uuid("recurrence_source_id"),
    visibility: text("visibility").notNull().default("assignees"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Client-generated UUID v7 of the «کار جدید» form; a resubmit within 10 minutes returns the existing item. */
    idempotencyKey: uuid("idempotency_key"),
    /** The درس the item belongs to — set by `createWorkItem` for `class_offering` recipients (migration 0015); null otherwise. */
    classOfferingId: uuid("class_offering_id"),
    ...timestamps(),
  },
  (t) => [
    unique("work_item_org_id_uq").on(t.organizationId, t.id),
    index("work_item_org_offering_idx").on(t.organizationId, t.classOfferingId).where(sql`${t.classOfferingId} IS NOT NULL`),
    uniqueIndex("work_item_idempotency_uq")
      .on(t.organizationId, t.createdByPersonId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("work_item_org_due_open_idx")
      .on(t.organizationId, t.dueAt)
      .where(sql`${t.completedAt} IS NULL AND ${t.archivedAt} IS NULL`),
    index("work_item_org_creator_idx").on(t.organizationId, t.createdByPersonId),
    check("work_item_title_chk", sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    check("work_item_priority_chk", sql`${t.priority} IN ('low', 'normal', 'high', 'urgent')`),
    check("work_item_visibility_chk", sql`${t.visibility} IN ('assignees', 'watchers', 'scope')`),
    foreignKey({
      name: "work_item_created_by_fk",
      columns: [t.organizationId, t.createdByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_parent_fk",
      columns: [t.organizationId, t.parentWorkItemId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
  ],
);

export const workItemAssignee = workspace.table(
  "work_item_assignee",
  {
    workItemId: uuid("work_item_id").notNull(),
    personId: uuid("person_id").notNull(),
    organizationId: orgFk(),
    role: text("role").notNull().default("assignee"),
    step: integer("step").notNull().default(1),
    state: text("state").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "work_item_assignee_pk", columns: [t.workItemId, t.personId, t.role] }),
    index("work_item_assignee_org_person_idx").on(t.organizationId, t.personId),
    check("work_item_assignee_role_chk", sql`${t.role} IN ('owner', 'assignee', 'approver')`),
    check("work_item_assignee_state_chk", sql`${t.state} IN ('pending', 'accepted', 'done')`),
    foreignKey({
      name: "work_item_assignee_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_assignee_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

export const workItemWatcher = workspace.table(
  "work_item_watcher",
  {
    workItemId: uuid("work_item_id").notNull(),
    personId: uuid("person_id").notNull(),
    organizationId: orgFk(),
    reason: text("reason").notNull().default("manual"),
  },
  (t) => [
    primaryKey({ name: "work_item_watcher_pk", columns: [t.workItemId, t.personId] }),
    index("work_item_watcher_org_person_idx").on(t.organizationId, t.personId),
    check("work_item_watcher_reason_chk", sql`${t.reason} IN ('guardian', 'supervisor', 'manual', 'creator')`),
    foreignKey({
      name: "work_item_watcher_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_watcher_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/** Comments are the ONE place with a soft-delete timestamp (spec): a removed comment keeps its slot in the thread. */
export const workItemComment = workspace.table(
  "work_item_comment",
  {
    id: id(),
    organizationId: orgFk(),
    workItemId: uuid("work_item_id").notNull(),
    authorPersonId: uuid("author_person_id").notNull(),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("all"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("work_item_comment_item_created_idx").on(t.workItemId, t.createdAt),
    check("work_item_comment_body_chk", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
    check("work_item_comment_visibility_chk", sql`${t.visibility} IN ('all', 'staff_only')`),
    foreignKey({
      name: "work_item_comment_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_comment_author_fk",
      columns: [t.organizationId, t.authorPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/** Table only — the upload UI is cut from phase 1. */
export const workItemAttachment = workspace.table(
  "work_item_attachment",
  {
    id: id(),
    organizationId: orgFk(),
    workItemId: uuid("work_item_id").notNull(),
    fileId: uuid("file_id").notNull(),
    addedByPersonId: uuid("added_by_person_id").notNull(),
    sequence: integer("sequence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("work_item_attachment_item_idx").on(t.workItemId, t.sequence),
    foreignKey({
      name: "work_item_attachment_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_attachment_file_fk",
      columns: [t.organizationId, t.fileId],
      foreignColumns: [fileObject.organizationId, fileObject.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_attachment_added_by_fk",
      columns: [t.organizationId, t.addedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

export const workItemTransition = workspace.table(
  "work_item_transition",
  {
    id: id(),
    organizationId: orgFk(),
    workItemId: uuid("work_item_id").notNull(),
    fromStatusId: uuid("from_status_id").references(() => workItemStatus.id, { onDelete: "restrict" }),
    toStatusId: uuid("to_status_id")
      .notNull()
      .references(() => workItemStatus.id, { onDelete: "restrict" }),
    byPersonId: uuid("by_person_id").notNull(),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("work_item_transition_item_at_idx").on(t.workItemId, t.at),
    foreignKey({
      name: "work_item_transition_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_transition_by_fk",
      columns: [t.organizationId, t.byPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/** The کارتابل itself: one row per (person, work item) the person should see, with read/snooze/pin state. */
export const inboxEntry = workspace.table(
  "inbox_entry",
  {
    id: id(),
    organizationId: orgFk(),
    personId: uuid("person_id").notNull(),
    workItemId: uuid("work_item_id").notNull(),
    relation: text("relation").notNull(),
    state: text("state").notNull().default("unread"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    isPinned: boolean("is_pinned").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("inbox_entry_person_item_uq").on(t.personId, t.workItemId),
    index("inbox_entry_org_person_state_idx").on(t.organizationId, t.personId, t.state, t.isPinned),
    check("inbox_entry_relation_chk", sql`${t.relation} IN ('assignee', 'watcher', 'approver', 'creator', 'mentioned')`),
    check("inbox_entry_state_chk", sql`${t.state} IN ('unread', 'read', 'snoozed', 'archived')`),
    foreignKey({
      name: "inbox_entry_person_fk",
      columns: [t.organizationId, t.personId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inbox_entry_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
  ],
);
