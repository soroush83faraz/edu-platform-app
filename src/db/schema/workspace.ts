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
import { person, studentProfile } from "./iam";
import { classOffering, orgFk, organization, school } from "./tenancy";

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
    /**
     * Participants only (migration 0018): the item is visible to its creator and to the people it was given to /
     * who watch it — the BROAD `workspace.work_item.read` of managers does not reach it (`canViewWorkItem`), and its
     * title never enters the audit trail. Set by `createConfidentialWorkItem` (the counselor's referrals).
     */
    isConfidential: boolean("is_confidential").notNull().default(false),
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

/**
 * «تحویل پاسخ» (migration 0024; owner 2026-10-19; docs/decisions.md «پیوست تکلیف و تحویل پاسخ»): ONE student's answer
 * to ONE تکلیف — text (optional) and up to five files (`work_item_attachment` rows with this `submission_id`). Created
 * on the first «ثبت پاسخ», edited in place while the تکلیف is open (`submitted_at` = the first one, `updated_at` = the
 * last); never deleted (no DELETE for app_rw) — a removed student's پاسخ stays for the giver as history.
 * RESTRICTIVE policies for app_rw (0024): readable by its student and by the تکلیف's managers
 * (`app.work_item_manager`: its creator, or a broad `workspace.work_item.update` holder — `managesItem`); written by its
 * student only. Never by another student, a guardian or a counselor.
 */
export const workItemSubmission = workspace.table(
  "work_item_submission",
  {
    id: id(),
    organizationId: orgFk(),
    workItemId: uuid("work_item_id").notNull(),
    studentPersonId: uuid("student_person_id").notNull(),
    /** The پاسخ text; null when the student sent files only. */
    body: text("body"),
    /** The first «ثبت پاسخ». */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("work_item_submission_org_id_uq").on(t.organizationId, t.id),
    /** The composite FK target of an attachment's (submission, work item) pair. */
    unique("work_item_submission_org_id_item_uq").on(t.organizationId, t.id, t.workItemId),
    unique("work_item_submission_student_uq").on(t.organizationId, t.workItemId, t.studentPersonId),
    check("work_item_submission_body_chk", sql`${t.body} IS NULL OR char_length(${t.body}) BETWEEN 1 AND 4000`),
    foreignKey({
      name: "work_item_submission_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_submission_student_fk",
      columns: [t.organizationId, t.studentPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/**
 * A file on a تکلیف (migration 0024 gives it its use): `submission_id` NULL = the giver's «فایل‌های تکلیف», set = one
 * file of that student's «پاسخ» (the composite FK pins the pair to the same تکلیف). A file is attached once
 * (`work_item_attachment_file_uq`); removing it sets `archived_at` (and archives the file, whose bytes are deleted).
 * RESTRICTIVE policies for app_rw (0024): a پاسخ's file row is readable only where the پاسخ is (its student, the
 * تکلیف's managers), and only its student adds or removes it; the giver's files follow the تکلیف (`canViewWorkItem`).
 */
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
    /** The student's پاسخ this file belongs to; NULL for the giver's own files of the تکلیف. */
    submissionId: uuid("submission_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("work_item_attachment_item_idx").on(t.workItemId, t.sequence),
    unique("work_item_attachment_file_uq").on(t.organizationId, t.fileId),
    index("work_item_attachment_submission_idx").on(t.organizationId, t.submissionId).where(sql`${t.submissionId} IS NOT NULL`),
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
    foreignKey({
      name: "work_item_attachment_submission_fk",
      columns: [t.organizationId, t.submissionId, t.workItemId],
      foreignColumns: [workItemSubmission.organizationId, workItemSubmission.id, workItemSubmission.workItemId],
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

/**
 * «ارتباط ولی و مدرسه» (migration 0022; owner 2026-10-19; docs/decisions.md): the link between a guardian's message
 * about ONE child and the confidential `parent_message` work item that carries it to the addressees. The guardian is
 * the item's creator but NOT one of its participants (workspace/manage-policy `creatorParticipates`): they read their
 * message's status and the answer through THIS row — the way the counseling file reads its referrals — never by
 * opening the item. The text (subject + body) lives on the item; this row holds no text at all: who sent it, about
 * whom, at which school, what kind, to which destination (and, for a teacher, which of the child's درس‌ها).
 *
 * The owner's rule is a CHECK too: a «انتقاد» never goes straight to a teacher (`guardian_message_criticism_chk`).
 * Immutable: no `updated_at`; app_rw may neither UPDATE nor DELETE it (`app.apply_grants()`, 0022). RESTRICTIVE policies
 * for app_rw (0022): readable by the sending guardian and by the item's addressees only; inserted only in the current
 * person's own name.
 */
export const guardianMessage = workspace.table(
  "guardian_message",
  {
    id: id(),
    organizationId: orgFk(),
    /** The child's school when the message was sent — where the addressees were resolved. */
    schoolId: uuid("school_id").notNull(),
    guardianPersonId: uuid("guardian_person_id").notNull(),
    studentProfileId: uuid("student_profile_id").notNull(),
    workItemId: uuid("work_item_id").notNull(),
    /** question «سؤال» · suggestion «پیشنهاد» · criticism «انتقاد». */
    kind: text("kind").notNull(),
    /** teacher «دبیر» · counselor «مشاور» · vice_principal «معاون» · principal «مدیر». */
    destinationKind: text("destination_kind").notNull(),
    /** The درس (class offering of the child's class) a `teacher` message is about; null for every other destination. */
    classOfferingId: uuid("class_offering_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("guardian_message_org_id_uq").on(t.organizationId, t.id),
    unique("guardian_message_work_item_uq").on(t.organizationId, t.workItemId),
    index("guardian_message_org_guardian_idx").on(t.organizationId, t.guardianPersonId, t.studentProfileId, t.createdAt.desc()),
    check("guardian_message_kind_chk", sql`${t.kind} IN ('question', 'suggestion', 'criticism')`),
    check("guardian_message_destination_chk", sql`${t.destinationKind} IN ('teacher', 'counselor', 'vice_principal', 'principal')`),
    check("guardian_message_offering_chk", sql`(${t.destinationKind} = 'teacher') = (${t.classOfferingId} IS NOT NULL)`),
    check("guardian_message_criticism_chk", sql`NOT (${t.kind} = 'criticism' AND ${t.destinationKind} = 'teacher')`),
    foreignKey({
      name: "guardian_message_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guardian_message_guardian_fk",
      columns: [t.organizationId, t.guardianPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guardian_message_student_fk",
      columns: [t.organizationId, t.studentProfileId],
      foreignColumns: [studentProfile.organizationId, studentProfile.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guardian_message_work_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guardian_message_offering_fk",
      columns: [t.organizationId, t.classOfferingId],
      foreignColumns: [classOffering.organizationId, classOffering.id],
    }).onDelete("restrict"),
  ],
);
