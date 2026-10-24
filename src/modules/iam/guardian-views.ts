// iam/guardian-views — what a guardian READS about their children (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»):
// the children (Home's cards), and for ONE child the تکالیف given to them, their attendance, the primary report card
// and the class week. Read-only — nothing here writes.
//
// The gate, for every child read (`requireChild`): the child must be one of the CALLER's live children — a live
// guardian link to an active student AND the derived `guardian_full` assignment of the session (`ctx.assignments`,
// valid today) — and the caller must hold the page's permission at that child's student scope (`can()`); anything else
// is NOT_FOUND. Both halves matter: the link alone would survive a revoked role, `can()` alone would let an
// organization admin (whose organization-scoped assignment matches every chain) read any child as a «guardian».
// `?child=` is only a choice among the server's own list (`pickChild`) — never trusted, never a fallback to another.
//
// What a guardian never sees: the child's personal notes («یادداشت/تسک شخصی» — items the child created, `todo`
// type, self-assigned), confidential items (the counselor's referrals), comments, other students, counseling,
// teacher reports, admin pages. The تکالیف list is items of type `task` given to the child by someone else, the
// child's own state on each («انجام‌شده» when the child marked it), title, درس and deadline.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import type { Ctx } from "@/lib/ctx";
import { notFound } from "@/lib/errors";
import { type Bucket, type DayBounds, tehranDayBounds } from "@/lib/format";
import { defaultRange, studentAttendanceSummary, type StudentAttendanceSummary } from "@/modules/academic/attendance";
import { studentReportCard, type StudentReportCard } from "@/modules/academic/report-card";
import { getStudentTimetable, type MyTimetable } from "@/modules/academic/service";
import type { InboxRow, Priority, StatusCategory } from "@/modules/workspace/repo";
import { can } from "./can";
import { GUARDIAN_ROLE_CODE } from "./guardian";
import { isGuardianRelation, pickChild, type GuardianRelation } from "./guardian-policy";
import type { Permission } from "./permissions";

export type GuardianViewCtx = Pick<Ctx, "orgId" | "personId" | "assignments">;

export interface GuardianChild {
  studentProfileId: string;
  personId: string;
  firstName: string;
  lastName: string;
  relation: GuardianRelation;
  classGroupId: string | null;
  className: string | null;
  /** The school of the child's class (the feature switches a child tile depends on are that school's). */
  schoolId: string | null;
  schoolName: string | null;
  /** The class's پایه has learning objectives — a دبستان class: the «کارنامه» tile exists. */
  primary: boolean;
  /**
   * Open تکالیف given to the child whose deadline day has passed — computed when read (phase 1 has no scheduler, so no
   * «overdue» notification row is ever written; Home shows this number on the child's card instead).
   */
  overdue: number;
}

/** The session's own guardian assignments, by child — valid today (`listValidAssignments` filtered the dates). */
function guardedChildren(ctx: GuardianViewCtx): Set<string> {
  const ids = new Set<string>();
  for (const a of ctx.assignments) if (a.roleCode === GUARDIAN_ROLE_CODE && a.scopeType === "student" && a.scopeId) ids.add(a.scopeId);
  return ids;
}

/** Does the session wear the «ولی» hat at all? (pure — no query; Home asks before reading the children). */
export function isGuardian(ctx: Pick<Ctx, "assignments">): boolean {
  return ctx.assignments.some((a) => a.roleCode === GUARDIAN_ROLE_CODE && a.scopeType === "student");
}

/**
 * The caller's live children: a live guardian link of THIS person to an active student, kept only where the session
 * carries the matching guardian assignment. With the child's class (active enrollment), school, whether it is a
 * primary class, and the overdue count. Ordered by first name.
 */
export async function listMyChildren(tx: Tx, ctx: GuardianViewCtx, bounds: DayBounds = tehranDayBounds()): Promise<GuardianChild[]> {
  const guarded = guardedChildren(ctx);
  if (guarded.size === 0) return [];
  const res = await tx.execute<{
    student_profile_id: string;
    person_id: string;
    first_name: string;
    last_name: string;
    relation: string;
    class_group_id: string | null;
    class_name: string | null;
    school_id: string | null;
    school_name: string | null;
    is_primary: boolean;
    overdue: number;
  }>(sql`
    select sp.id as student_profile_id, sp.person_id, p.first_name, p.last_name, gl.relation,
      cls.class_group_id, cls.class_name, cls.school_id, cls.school_name,
      coalesce(cls.is_primary, false) as is_primary,
      (
        select count(*)::int
        from workspace.work_item_assignee wa
        join workspace.work_item wi on wi.id = wa.work_item_id
        join workspace.work_item_type t on t.id = wi.type_id
        join workspace.work_item_status s on s.id = wi.status_id
        where wa.person_id = sp.person_id and wa.role = 'assignee' and wa.state <> 'done'
          and t.code = 'task' and wi.created_by_person_id <> sp.person_id and wi.is_confidential = false
          and wi.archived_at is null and s.category in ('todo', 'doing')
          and wi.due_at is not null and wi.due_at < ${bounds.todayStart}
      ) as overdue
    from iam.guardian_link gl
    join iam.student_profile sp on sp.id = gl.student_profile_id
    join iam.person p on p.id = sp.person_id
    left join lateral (
      select cg.id as class_group_id, cg.name as class_name, s.id as school_id, s.name as school_name,
        exists (select 1 from academic.learning_objective lo where lo.grade_level_id = cg.grade_level_id and lo.status = 'active') as is_primary
      from academic.class_enrollment ce
      join tenancy.class_group cg on cg.id = ce.class_group_id
      join tenancy.branch b on b.id = cg.branch_id
      join tenancy.school s on s.id = b.school_id
      where ce.student_profile_id = sp.id and ce.status = 'active'
      order by ce.starts_on desc
      limit 1
    ) cls on true
    where gl.guardian_person_id = ${ctx.personId}::uuid and gl.status = 'active'
      and sp.status = 'active' and p.status = 'active'
    order by p.first_name, p.last_name, sp.id`);
  return res.rows
    .filter((r) => guarded.has(r.student_profile_id))
    .map((r) => ({
      studentProfileId: r.student_profile_id,
      personId: r.person_id,
      firstName: r.first_name,
      lastName: r.last_name,
      relation: isGuardianRelation(r.relation) ? r.relation : "other",
      classGroupId: r.class_group_id,
      className: r.class_name,
      schoolId: r.school_id,
      schoolName: r.school_name,
      primary: r.is_primary,
      overdue: Number(r.overdue),
    }));
}

export interface ChildContext {
  children: GuardianChild[];
  child: GuardianChild;
}

/**
 * The gate of every child page (module header): the requested child among the caller's live children (`pickChild`;
 * none requested = the first), and `permission` at that child's student scope — NOT_FOUND otherwise.
 */
export async function requireChild(tx: Tx, ctx: GuardianViewCtx, requested: string | undefined, permission: Permission): Promise<ChildContext> {
  const children = await listMyChildren(tx, ctx);
  const child = pickChild(children, requested);
  if (!child) throw notFound();
  if (!(await can(tx, ctx, permission, { scopeType: "student", id: child.studentProfileId }))) throw notFound();
  return { children, child };
}

/**
 * The تکالیف given to the child, as rows of the unified list (`WorkItemList`, read-only for the guardian): type `task`,
 * created by someone else, not confidential, not archived, still assigned to the child. The category is the CHILD's
 * («انجام‌شده» once they marked it; a «حذف»-ed item reads «حذف‌شده»), the bucket from the Tehran day like «پنل من».
 * Never the child's personal notes, never the read/pinned state of their inbox, never comments.
 */
export async function listChildWorkItems(tx: Tx, child: Pick<GuardianChild, "personId">, bounds: DayBounds = tehranDayBounds()): Promise<InboxRow[]> {
  const res = await tx.execute<{
    id: string;
    title: string;
    priority: Priority;
    due_at: string | null;
    created_at: string;
    class_offering_id: string | null;
    type_code: string;
    type_name: string;
    status_code: string;
    status_name: string;
    category: StatusCategory;
    creator_id: string;
    creator_name: string;
    child_state: InboxRow["myAssigneeState"];
    subject_id: string | null;
    subject_name: string | null;
    class_group_name: string | null;
    bucket: Bucket;
  }>(sql`
    select wi.id, wi.title, wi.priority, wi.due_at, wi.created_at, wi.class_offering_id,
      t.code as type_code, t.name as type_name, s.code as status_code, s.name as status_name,
      eff.category, wi.created_by_person_id as creator_id, cp.first_name || ' ' || cp.last_name as creator_name,
      wa.state as child_state,
      subj.id as subject_id, subj.name as subject_name, cg.name as class_group_name,
      case
        when wi.due_at is null then 'none'
        when wi.due_at < ${bounds.todayStart} then (case when eff.category in ('todo', 'doing') then 'overdue' else 'today' end)
        when wi.due_at < ${bounds.todayEnd} then 'today'
        when wi.due_at < ${bounds.weekEnd} then 'week'
        else 'later'
      end as bucket
    from workspace.work_item_assignee wa
    join workspace.work_item wi on wi.id = wa.work_item_id
    join workspace.work_item_status s on s.id = wi.status_id
    join workspace.work_item_type t on t.id = wi.type_id
    join iam.person cp on cp.id = wi.created_by_person_id
    left join tenancy.class_offering co on co.organization_id = wi.organization_id and co.id = wi.class_offering_id
    left join tenancy.subject subj on subj.organization_id = co.organization_id and subj.id = co.subject_id
    left join tenancy.class_group cg on cg.organization_id = co.organization_id and cg.id = co.class_group_id
    cross join lateral (
      select case
        when s.category = 'cancelled' then 'cancelled'
        when wa.state = 'done' then 'done'
        when wa.state = 'accepted' and s.category = 'todo' then 'doing'
        else s.category
      end as category
    ) eff
    where wa.person_id = ${child.personId}::uuid and wa.role = 'assignee'
      and t.code = 'task'
      and wi.created_by_person_id <> wa.person_id
      and wi.is_confidential = false
      and wi.archived_at is null
    order by wi.due_at asc nulls last, wi.id asc
    limit 200`);
  return res.rows.map<InboxRow>((r) => ({
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
    // The guardian is neither the giver nor the reader of the child's inbox: no progress bar, no unread dot.
    createdByMe: false,
    unread: false,
    isPinned: false,
    myAssigneeState: r.child_state,
    assigneesTotal: 0,
    assigneesDone: 0,
    commentsCount: 0,
    bucket: r.bucket,
    offeringId: r.class_offering_id,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    classGroupName: r.class_group_name,
  }));
}

/** The child's attendance of the last 30 days (Tehran) — the student's own summary read, authorized by `can(student)`. */
export async function childAttendance(tx: Tx, ctx: GuardianViewCtx, child: Pick<GuardianChild, "studentProfileId">): Promise<StudentAttendanceSummary> {
  const range = defaultRange();
  return studentAttendanceSummary(tx, ctx, { studentProfileId: child.studentProfileId, from: range.from, to: range.to });
}

/** The child's «کارنامهٴ توصیفی» for a month (null: not a primary class / no class). */
export async function childReportCard(tx: Tx, child: Pick<GuardianChild, "studentProfileId" | "firstName" | "lastName">, month: number | undefined): Promise<StudentReportCard | null> {
  return studentReportCard(tx, { id: child.studentProfileId, fullName: `${child.firstName} ${child.lastName}` }, { month });
}

/** The child's class week (the student half only). */
export async function childTimetable(tx: Tx, child: Pick<GuardianChild, "personId">): Promise<MyTimetable> {
  return getStudentTimetable(tx, child.personId);
}
