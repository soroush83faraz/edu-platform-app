// workspace/repo — read model of the کارتابل plus the small lookups the service needs. Every read is scoped to
// the caller (`personId`) or goes through `canViewWorkItem` in the service; RLS hides other tenants underneath.
// The inbox list is ONE SQL statement (inbox_entry ⨝ work_item ⨝ status ⨝ type ⨝ creator ⟕ درس/class + lateral counts) with
// the Tehran day boundaries passed in as parameters, so bucket and tab filters run in the database.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { type Bucket, type DayBounds, tehranDayBounds } from "@/lib/format";
import { person, roleAssignment, staffProfile, studentProfile } from "@/modules/iam/schema";
import { classEnrollment } from "@/modules/academic/schema";
import { classGroup, classOffering, gradeLevel, subject } from "@/modules/tenancy/schema";
import type { InboxTab } from "./dto";
import { inboxEntry, workItem, workItemAssignee, workItemComment, workItemStatus, workItemTransition, workItemType, workItemWatcher } from "./schema";

export type Priority = "low" | "normal" | "high" | "urgent";
export type StatusCategory = "todo" | "doing" | "done" | "cancelled";

// ---------------------------------------------------------------------------------------------------------------
// catalog lookups
// ---------------------------------------------------------------------------------------------------------------

export interface TypeWithInitialStatus {
  typeId: string;
  typeName: string;
  initialStatusId: string;
}

/** System type by code (organization_id IS NULL — tenant-defined types are not part of phase 1) + its first status. */
export async function findTypeWithInitialStatus(tx: Tx, typeCode: string): Promise<TypeWithInitialStatus | null> {
  const [row] = await tx
    .select({ typeId: workItemType.id, typeName: workItemType.name, initialStatusId: workItemStatus.id })
    .from(workItemType)
    .innerJoin(workItemStatus, eq(workItemStatus.workItemTypeId, workItemType.id))
    .where(and(isNull(workItemType.organizationId), eq(workItemType.code, typeCode)))
    .orderBy(asc(workItemStatus.sequence))
    .limit(1);
  return row ?? null;
}

export interface StatusRow {
  id: string;
  code: string;
  name: string;
  category: StatusCategory;
  isTerminal: boolean;
}

export async function listStatusesOfType(tx: Tx, typeId: string): Promise<StatusRow[]> {
  const rows = await tx
    .select({ id: workItemStatus.id, code: workItemStatus.code, name: workItemStatus.name, category: workItemStatus.category, isTerminal: workItemStatus.isTerminal })
    .from(workItemStatus)
    .where(eq(workItemStatus.workItemTypeId, typeId))
    .orderBy(asc(workItemStatus.sequence));
  return rows.map((r) => ({ ...r, category: r.category as StatusCategory }));
}

// ---------------------------------------------------------------------------------------------------------------
// people lookups
// ---------------------------------------------------------------------------------------------------------------

export async function isStaff(tx: Tx, personId: string): Promise<boolean> {
  const [row] = await tx.select({ id: staffProfile.id }).from(staffProfile).where(eq(staffProfile.personId, personId)).limit(1);
  return row !== undefined;
}

export async function findPersonName(tx: Tx, personId: string): Promise<string | null> {
  const [row] = await tx.select({ f: person.firstName, l: person.lastName }).from(person).where(eq(person.id, personId)).limit(1);
  return row ? `${row.f} ${row.l}` : null;
}

/** Ids of the given persons that exist in this tenant and are active (RLS already hides other organizations). */
export async function filterActivePersonIds(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: person.id })
    .from(person)
    .where(and(inArray(person.id, [...ids]), eq(person.status, "active")));
  return rows.map((r) => r.id);
}

export interface RosterRow {
  personId: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
}

/** Active students of the offering's class group (academic.class_enrollment status = 'active'). */
export async function listOfferingRoster(tx: Tx, classOfferingId: string): Promise<RosterRow[]> {
  return tx
    .select({ personId: person.id, firstName: person.firstName, lastName: person.lastName, studentNumber: studentProfile.studentNumber })
    .from(classOffering)
    .innerJoin(classEnrollment, and(eq(classEnrollment.classGroupId, classOffering.classGroupId), eq(classEnrollment.status, "active")))
    .innerJoin(studentProfile, eq(studentProfile.id, classEnrollment.studentProfileId))
    .innerJoin(person, and(eq(person.id, studentProfile.personId), eq(person.status, "active")))
    .where(eq(classOffering.id, classOfferingId))
    .orderBy(asc(person.lastName), asc(person.firstName));
}

export interface OfferingRow {
  id: string;
  subjectName: string;
  classGroupName: string;
  studentCount: number;
}

const OFFERING_SELECT = {
  id: classOffering.id,
  subjectName: subject.name,
  classGroupName: classGroup.name,
  studentCount: sql<number>`(select count(*)::int from ${classEnrollment} ce where ce.class_group_id = ${classOffering.classGroupId} and ce.status = 'active')`,
  gradeSequence: gradeLevel.sequence,
};

/** Class pickers read grade first («دهم» before «یازدهم»), then class name, then subject. */
function sortOfferings(rows: Array<OfferingRow & { gradeSequence: number }>): OfferingRow[] {
  const collator = new Intl.Collator("fa");
  return rows
    .sort((a, b) => a.gradeSequence - b.gradeSequence || collator.compare(a.classGroupName, b.classGroupName) || collator.compare(a.subjectName, b.subjectName))
    .map(({ id, subjectName, classGroupName, studentCount }) => ({ id, subjectName, classGroupName, studentCount }));
}

/** Offerings the person teaches: valid `teacher`-style role_assignments scoped to a class_offering. */
export async function listTaughtOfferings(tx: Tx, personId: string): Promise<OfferingRow[]> {
  const rows = await tx
    .selectDistinctOn([classOffering.id], OFFERING_SELECT)
    .from(roleAssignment)
    .innerJoin(classOffering, eq(classOffering.id, roleAssignment.classOfferingId))
    .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
    .innerJoin(gradeLevel, eq(gradeLevel.id, classGroup.gradeLevelId))
    .innerJoin(subject, eq(subject.id, classOffering.subjectId))
    .where(
      and(
        eq(roleAssignment.personId, personId),
        eq(roleAssignment.scopeType, "class_offering"),
        isNull(roleAssignment.revokedAt),
        sql`(${roleAssignment.validFrom} is null or ${roleAssignment.validFrom} <= current_date)`,
        sql`(${roleAssignment.validTo} is null or ${roleAssignment.validTo} >= current_date)`,
        sql`${classOffering.status} <> 'closed'`,
      ),
    )
    .orderBy(asc(classOffering.id));
  return sortOfferings(rows);
}

/** Every open offering of the organization (admins/principals — broad `assign_class`). */
export async function listAllOfferings(tx: Tx): Promise<OfferingRow[]> {
  const rows = await tx
    .select(OFFERING_SELECT)
    .from(classOffering)
    .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
    .innerJoin(gradeLevel, eq(gradeLevel.id, classGroup.gradeLevelId))
    .innerJoin(subject, eq(subject.id, classOffering.subjectId))
    .where(sql`${classOffering.status} <> 'closed' and ${classGroup.status} = 'active'`)
    .orderBy(asc(gradeLevel.sequence), asc(classGroup.name), asc(subject.name));
  return sortOfferings(rows);
}

export interface PersonHit {
  id: string;
  firstName: string;
  lastName: string;
  kind: "student" | "staff" | "person";
}

/** Persian name search through the generated `search_text` (app.fa_norm + trigram index). */
export async function searchPersons(tx: Tx, q: string, limit = 20): Promise<PersonHit[]> {
  const rows = await tx
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      kind: sql<string>`case when ${studentProfile.id} is not null then 'student' when ${staffProfile.id} is not null then 'staff' else 'person' end`,
    })
    .from(person)
    .leftJoin(studentProfile, eq(studentProfile.personId, person.id))
    .leftJoin(staffProfile, eq(staffProfile.personId, person.id))
    .where(and(eq(person.status, "active"), sql`${person.searchText} ilike '%' || app.fa_norm(${q}) || '%'`))
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(limit);
  return rows.map((r) => ({ ...r, kind: r.kind as PersonHit["kind"] }));
}

// ---------------------------------------------------------------------------------------------------------------
// inbox list
// ---------------------------------------------------------------------------------------------------------------

export interface InboxRow {
  id: string;
  title: string;
  priority: Priority;
  dueAt: Date | null;
  createdAt: Date;
  typeCode: string;
  typeName: string;
  statusCode: string;
  statusName: string;
  /** The item's status category as the CALLER experiences it (own assignee state wins for assignees). */
  category: StatusCategory;
  creatorId: string;
  creatorName: string;
  createdByMe: boolean;
  unread: boolean;
  isPinned: boolean;
  myAssigneeState: "pending" | "accepted" | "done" | null;
  assigneesTotal: number;
  assigneesDone: number;
  commentsCount: number;
  bucket: Bucket;
  /** The درس of a class task (via `work_item.class_offering_id`); null for personal notes and admin tasks. */
  subjectId: string | null;
  subjectName: string | null;
  /** The class of that درس — a teacher's rows name it («ریاضی · کلاس ۱۰۲»). */
  classGroupName: string | null;
}

export interface InboxPage {
  rows: InboxRow[];
  nextCursor: string | null;
}

export interface ListInboxOptions {
  tab: InboxTab;
  bucket?: Bucket;
  createdByMe?: boolean;
  unreadOnly?: boolean;
  /** Only items still open for the caller (effective category todo/doing) — the Home «کارهای نزدیک» list. */
  openOnly?: boolean;
  /** Only items of one درس (`work_item.class_offering_id`) — the subject page. */
  offeringId?: string | null;
  cursor?: string | null;
  limit?: number;
  now?: Date;
  /** Staff see staff-only comments, so their comment counts include them (everyone counts their own). */
  viewerIsStaff?: boolean;
}

export function encodeInboxCursor(dueAt: Date | null, id: string): string {
  return Buffer.from(`${dueAt ? dueAt.getTime() : ""}|${id}`, "utf8").toString("base64url");
}

export function decodeInboxCursor(cursor: string | null | undefined): { dueAt: Date | null; id: string } | null {
  if (!cursor) return null;
  const [ms, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (ms === "") return { dueAt: null, id };
  const t = Number(ms);
  return Number.isFinite(t) ? { dueAt: new Date(t), id } : null;
}

// «انجام‌نشده» = everything still open for me (todo + doing); «انجام‌شده» = done + cancelled.
const TAB_CATEGORIES: Record<InboxTab, StatusCategory[] | null> = {
  todo: ["todo", "doing"],
  done: ["done", "cancelled"],
  all: null,
};

/**
 * My inbox: one statement. `category` and `bucket` are computed per row from the caller's own assignee state
 * and the Tehran boundaries in `bounds`; ordering is `due_at NULLS LAST, id` with a (due_at, id) keyset cursor.
 */
export async function listInbox(tx: Tx, personId: string, opts: ListInboxOptions, bounds: DayBounds = tehranDayBounds(opts.now)): Promise<InboxPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const cats = TAB_CATEGORIES[opts.tab];
  const after = decodeInboxCursor(opts.cursor);

  const filters = [sql`true`];
  if (cats) filters.push(sql`r.category in (${sql.join(cats.map((c) => sql`${c}`), sql`, `)})`);
  if (opts.bucket) filters.push(sql`r.bucket = ${opts.bucket}`);
  if (opts.createdByMe) filters.push(sql`r.created_by_me`);
  if (opts.unreadOnly) filters.push(sql`r.unread`);
  if (opts.openOnly) filters.push(sql`r.category in ('todo', 'doing')`);
  if (opts.offeringId) filters.push(sql`r.class_offering_id = ${opts.offeringId}::uuid`);
  if (after) {
    filters.push(
      after.dueAt
        ? sql`(r.due_at > ${after.dueAt} or (r.due_at = ${after.dueAt} and r.id > ${after.id}::uuid) or r.due_at is null)`
        : sql`(r.due_at is null and r.id > ${after.id}::uuid)`,
    );
  }

  const res = await tx.execute<{
    id: string;
    title: string;
    priority: Priority;
    // Raw `execute` rows: drizzle registers pass-through pg type parsers, so timestamptz arrives as text.
    due_at: string | null;
    created_at: string;
    type_code: string;
    type_name: string;
    status_code: string;
    status_name: string;
    category: StatusCategory;
    creator_id: string;
    creator_name: string;
    created_by_me: boolean;
    unread: boolean;
    is_pinned: boolean;
    my_assignee_state: InboxRow["myAssigneeState"];
    assignees_total: number;
    assignees_done: number;
    comments_count: number;
    bucket: Bucket;
    subject_id: string | null;
    subject_name: string | null;
    class_group_name: string | null;
  }>(sql`
    select * from (
      select
        wi.id, wi.title, wi.priority, wi.due_at, wi.created_at, wi.class_offering_id,
        t.code as type_code, t.name as type_name,
        s.code as status_code, s.name as status_name,
        eff.category,
        wi.created_by_person_id as creator_id,
        p.first_name || ' ' || p.last_name as creator_name,
        (wi.created_by_person_id = ie.person_id) as created_by_me,
        (ie.state = 'unread') as unread,
        ie.is_pinned,
        wa.state as my_assignee_state,
        cnt.total as assignees_total, cnt.done as assignees_done,
        cm.n as comments_count,
        subj.id as subject_id, subj.name as subject_name, cg.name as class_group_name,
        case
          when wi.due_at is null then 'none'
          when wi.due_at < ${bounds.todayStart} then (case when eff.category in ('todo', 'doing') then 'overdue' else 'today' end)
          when wi.due_at < ${bounds.todayEnd} then 'today'
          when wi.due_at < ${bounds.weekEnd} then 'week'
          else 'later'
        end as bucket
      from ${inboxEntry} ie
      join ${workItem} wi on wi.id = ie.work_item_id
      join ${workItemStatus} s on s.id = wi.status_id
      join ${workItemType} t on t.id = wi.type_id
      join ${person} p on p.id = wi.created_by_person_id
      left join ${workItemAssignee} wa on wa.work_item_id = wi.id and wa.person_id = ie.person_id and wa.role = 'assignee'
      left join ${classOffering} co on co.organization_id = wi.organization_id and co.id = wi.class_offering_id
      left join ${subject} subj on subj.organization_id = co.organization_id and subj.id = co.subject_id
      left join ${classGroup} cg on cg.organization_id = co.organization_id and cg.id = co.class_group_id
      cross join lateral (
        select count(*)::int as total, (count(*) filter (where a.state = 'done'))::int as done
        from ${workItemAssignee} a where a.work_item_id = wi.id and a.role = 'assignee'
      ) cnt
      cross join lateral (
        select count(*)::int as n from ${workItemComment} c
        where c.work_item_id = wi.id and c.deleted_at is null and (${opts.viewerIsStaff ?? false} or c.visibility = 'all' or c.author_person_id = ie.person_id)
      ) cm
      cross join lateral (
        select case
          when wa.state = 'done' then 'done'
          when wa.state = 'accepted' and s.category = 'todo' then 'doing'
          else s.category
        end as category
      ) eff
      where ie.person_id = ${personId}::uuid and ie.state <> 'archived' and wi.archived_at is null
    ) r
    where ${sql.join(filters, sql` and `)}
    order by r.due_at asc nulls last, r.id asc
    limit ${limit + 1}
  `);

  const all = res.rows.map<InboxRow>((r) => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    dueAt: r.due_at ? new Date(r.due_at) : null,
    createdAt: new Date(r.created_at),
    typeCode: r.type_code,
    typeName: r.type_name,
    statusCode: r.status_code,
    statusName: r.status_name,
    category: r.category,
    creatorId: r.creator_id,
    creatorName: r.creator_name,
    createdByMe: r.created_by_me,
    unread: r.unread,
    isPinned: r.is_pinned,
    myAssigneeState: r.my_assignee_state,
    assigneesTotal: r.assignees_total,
    assigneesDone: r.assignees_done,
    commentsCount: r.comments_count,
    bucket: r.bucket,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    classGroupName: r.class_group_name,
  }));
  const rows = all.slice(0, limit);
  const last = rows.at(-1);
  return { rows, nextCursor: all.length > limit && last ? encodeInboxCursor(last.dueAt, last.id) : null };
}

export interface InboxSummary {
  overdue: number;
  dueToday: number;
  unread: number;
  unreadNotifications: number;
}

/** Counts for the badge / Home strip (same effective-category rule as the list). `unreadNotifications` is filled by the caller. */
export async function inboxCounts(tx: Tx, personId: string, bounds: DayBounds = tehranDayBounds()): Promise<Omit<InboxSummary, "unreadNotifications">> {
  const res = await tx.execute<{ overdue: number; due_today: number; unread: number }>(sql`
    select
      (count(*) filter (where open_ and wi.due_at < ${bounds.todayStart}))::int as overdue,
      (count(*) filter (where open_ and wi.due_at >= ${bounds.todayStart} and wi.due_at < ${bounds.todayEnd}))::int as due_today,
      (count(*) filter (where ie.state = 'unread'))::int as unread
    from ${inboxEntry} ie
    join ${workItem} wi on wi.id = ie.work_item_id
    join ${workItemStatus} s on s.id = wi.status_id
    left join ${workItemAssignee} wa on wa.work_item_id = wi.id and wa.person_id = ie.person_id and wa.role = 'assignee'
    cross join lateral (select (coalesce(wa.state, '') <> 'done' and s.category in ('todo', 'doing')) as open_) o
    where ie.person_id = ${personId}::uuid and ie.state <> 'archived' and wi.archived_at is null
  `);
  const r = res.rows[0];
  return { overdue: r?.overdue ?? 0, dueToday: r?.due_today ?? 0, unread: r?.unread ?? 0 };
}

export interface InboxTabCounts {
  todo: number;
  done: number;
}

/**
 * Rows per کارتابل tab for the segmented control — the same effective category as `listInbox` (own assignee state
 * wins), so the numbers match the lists. `todo` includes `doing`, `done` includes cancelled — like the two tabs.
 * The «فقط کارهایی که دادم» / «خوانده‌نشده» filters narrow the counts too, so the tabs never promise rows the
 * filtered list does not show.
 */
export async function inboxTabCounts(tx: Tx, personId: string, opts: { createdByMe?: boolean; unreadOnly?: boolean; offeringId?: string | null } = {}): Promise<InboxTabCounts> {
  const filters = [sql`ie.person_id = ${personId}::uuid and ie.state <> 'archived' and wi.archived_at is null`];
  if (opts.createdByMe) filters.push(sql`wi.created_by_person_id = ie.person_id`);
  if (opts.unreadOnly) filters.push(sql`ie.state = 'unread'`);
  if (opts.offeringId) filters.push(sql`wi.class_offering_id = ${opts.offeringId}::uuid`);
  const res = await tx.execute<{ todo: number; done: number }>(sql`
    select
      (count(*) filter (where eff.category in ('todo', 'doing')))::int as todo,
      (count(*) filter (where eff.category in ('done', 'cancelled')))::int as done
    from ${inboxEntry} ie
    join ${workItem} wi on wi.id = ie.work_item_id
    join ${workItemStatus} s on s.id = wi.status_id
    left join ${workItemAssignee} wa on wa.work_item_id = wi.id and wa.person_id = ie.person_id and wa.role = 'assignee'
    cross join lateral (
      select case
        when wa.state = 'done' then 'done'
        when wa.state = 'accepted' and s.category = 'todo' then 'doing'
        else s.category
      end as category
    ) eff
    where ${sql.join(filters, sql` and `)}
  `);
  const r = res.rows[0];
  return { todo: r?.todo ?? 0, done: r?.done ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------------------------------------------

export interface WorkItemCore {
  id: string;
  typeId: string;
  typeCode: string;
  typeName: string;
  statusId: string;
  statusCode: string;
  statusName: string;
  statusCategory: StatusCategory;
  title: string;
  description: string | null;
  priority: Priority;
  dueAt: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdByPersonId: string;
  /** Set when the item was given to a class (its درس) — its recipients are that class's students. */
  classOfferingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function findWorkItemCore(tx: Tx, id: string): Promise<WorkItemCore | null> {
  const [row] = await tx
    .select({
      id: workItem.id,
      typeId: workItem.typeId,
      typeCode: workItemType.code,
      typeName: workItemType.name,
      statusId: workItem.statusId,
      statusCode: workItemStatus.code,
      statusName: workItemStatus.name,
      statusCategory: workItemStatus.category,
      title: workItem.title,
      description: workItem.description,
      priority: workItem.priority,
      dueAt: workItem.dueAt,
      completedAt: workItem.completedAt,
      archivedAt: workItem.archivedAt,
      createdByPersonId: workItem.createdByPersonId,
      classOfferingId: workItem.classOfferingId,
      createdAt: workItem.createdAt,
      updatedAt: workItem.updatedAt,
    })
    .from(workItem)
    .innerJoin(workItemType, eq(workItemType.id, workItem.typeId))
    .innerJoin(workItemStatus, eq(workItemStatus.id, workItem.statusId))
    .where(eq(workItem.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, priority: row.priority as Priority, statusCategory: row.statusCategory as StatusCategory };
}

export interface AssigneeRow {
  personId: string;
  name: string;
  state: "pending" | "accepted" | "done";
  respondedAt: Date | null;
}

export async function listAssignees(tx: Tx, workItemId: string): Promise<AssigneeRow[]> {
  const rows = await tx
    .select({ personId: workItemAssignee.personId, f: person.firstName, l: person.lastName, state: workItemAssignee.state, respondedAt: workItemAssignee.respondedAt })
    .from(workItemAssignee)
    .innerJoin(person, eq(person.id, workItemAssignee.personId))
    .where(and(eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.role, "assignee")))
    .orderBy(asc(person.lastName), asc(person.firstName));
  return rows.map((r) => ({ personId: r.personId, name: `${r.f} ${r.l}`, state: r.state as AssigneeRow["state"], respondedAt: r.respondedAt }));
}

export interface WatcherRow {
  personId: string;
  name: string;
  reason: string;
}

export async function listWatchers(tx: Tx, workItemId: string): Promise<WatcherRow[]> {
  const rows = await tx
    .select({ personId: workItemWatcher.personId, f: person.firstName, l: person.lastName, reason: workItemWatcher.reason })
    .from(workItemWatcher)
    .innerJoin(person, eq(person.id, workItemWatcher.personId))
    .where(eq(workItemWatcher.workItemId, workItemId));
  return rows.map((r) => ({ personId: r.personId, name: `${r.f} ${r.l}`, reason: r.reason }));
}

export interface CommentRow {
  id: string;
  authorPersonId: string;
  authorName: string;
  body: string;
  visibility: "all" | "staff_only";
  createdAt: Date;
}

export interface CommentViewer {
  personId: string;
  isStaff: boolean;
}

/**
 * Oldest first. Staff see everything; anyone else sees `all` comments plus the ones they wrote themselves (an
 * assignee's comment on a multi-assignee item is stored `staff_only` — service `addComment`).
 */
export async function listComments(tx: Tx, workItemId: string, viewer: CommentViewer): Promise<CommentRow[]> {
  const rows = await tx
    .select({
      id: workItemComment.id,
      authorPersonId: workItemComment.authorPersonId,
      f: person.firstName,
      l: person.lastName,
      body: workItemComment.body,
      visibility: workItemComment.visibility,
      createdAt: workItemComment.createdAt,
    })
    .from(workItemComment)
    .innerJoin(person, eq(person.id, workItemComment.authorPersonId))
    .where(
      and(
        eq(workItemComment.workItemId, workItemId),
        isNull(workItemComment.deletedAt),
        viewer.isStaff ? undefined : sql`(${workItemComment.visibility} = 'all' or ${workItemComment.authorPersonId} = ${viewer.personId}::uuid)`,
      ),
    )
    .orderBy(asc(workItemComment.createdAt), asc(workItemComment.id));
  return rows.map((r) => ({ id: r.id, authorPersonId: r.authorPersonId, authorName: `${r.f} ${r.l}`, body: r.body, visibility: r.visibility as CommentRow["visibility"], createdAt: r.createdAt }));
}

export interface TransitionRow {
  id: string;
  fromStatusName: string | null;
  toStatusName: string;
  byName: string;
  note: string | null;
  at: Date;
}

export async function listTransitions(tx: Tx, workItemId: string, limit = 20): Promise<TransitionRow[]> {
  const fromStatus = sql<string | null>`(select name from ${workItemStatus} fs where fs.id = ${workItemTransition.fromStatusId})`;
  const rows = await tx
    .select({
      id: workItemTransition.id,
      fromStatusName: fromStatus,
      toStatusName: workItemStatus.name,
      f: person.firstName,
      l: person.lastName,
      note: workItemTransition.note,
      at: workItemTransition.at,
    })
    .from(workItemTransition)
    .innerJoin(workItemStatus, eq(workItemStatus.id, workItemTransition.toStatusId))
    .innerJoin(person, eq(person.id, workItemTransition.byPersonId))
    .where(eq(workItemTransition.workItemId, workItemId))
    .orderBy(desc(workItemTransition.at), desc(workItemTransition.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, fromStatusName: r.fromStatusName, toStatusName: r.toStatusName, byName: `${r.f} ${r.l}`, note: r.note, at: r.at }));
}

export interface MyInboxState {
  relation: string;
  state: "unread" | "read" | "snoozed" | "archived";
  isPinned: boolean;
}

export async function findMyInboxEntry(tx: Tx, personId: string, workItemId: string): Promise<MyInboxState | null> {
  const [row] = await tx
    .select({ relation: inboxEntry.relation, state: inboxEntry.state, isPinned: inboxEntry.isPinned })
    .from(inboxEntry)
    .where(and(eq(inboxEntry.personId, personId), eq(inboxEntry.workItemId, workItemId)))
    .limit(1);
  return row ? { ...row, state: row.state as MyInboxState["state"] } : null;
}

export async function findMyAssigneeRow(tx: Tx, personId: string, workItemId: string): Promise<{ state: AssigneeRow["state"] } | null> {
  const [row] = await tx
    .select({ state: workItemAssignee.state })
    .from(workItemAssignee)
    .where(and(eq(workItemAssignee.personId, personId), eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.role, "assignee")))
    .limit(1);
  return row ? { state: row.state as AssigneeRow["state"] } : null;
}
