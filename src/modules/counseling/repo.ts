// counseling/repo — the reads (and the locked recipient reads) of «مشاوره». Every function takes the caller's tenant
// transaction; RLS hides other organizations underneath, and on the counseling tables the RESTRICTIVE policies of
// migration 0018 hide what the CURRENT person may not read. The reach filters below are the service's own rule in
// SQL (`reachSql`) — the two layers agree by construction (src/modules/counseling/policy.ts). Explicit columns only.
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { toAsciiDigits } from "@/lib/normalize";
import { person } from "@/modules/iam/schema";
import { liveSchoolEnrollmentSql } from "@/modules/iam/service";
import { closesOnFirstAnswer } from "@/modules/workspace/manage-policy";
import type { StatusCategory } from "@/modules/workspace/repo";
import type { CounselingStudentRow, NoteKind, NoteVisibility, ReferralKind, ReportKind, SchoolReach } from "./policy";

/** Column references passed to `reachSql` are code constants, never input. */
const COLUMN_RE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/** SQL predicate «the row's school (column `column`) lies in `reach`» — the service rule of `inReach`. */
export function reachSql(reach: SchoolReach, column: string): SQL {
  if (!COLUMN_RE.test(column)) throw new Error(`invalid column reference: ${column}`);
  if (reach.kind === "organization") return sql`true`;
  if (reach.schoolIds.length === 0) return sql`false`;
  return sql`${sql.raw(column)} = any(${sql.param([...reach.schoolIds], undefined)}::uuid[])`;
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ---------------------------------------------------------------------------------------------------------------
// schools and students
// ---------------------------------------------------------------------------------------------------------------

export interface SchoolOption {
  id: string;
  name: string;
}

/** The schools of `reach`, the organization's default school first. */
export async function listSchoolsInReach(tx: Tx, reach: SchoolReach): Promise<SchoolOption[]> {
  const res = await tx.execute<{ id: string; name: string }>(sql`
    select s.id, s.name from tenancy.school s
    where ${reachSql(reach, "s.id")}
    order by s.is_default desc, s.name`);
  return res.rows.map((r) => ({ id: r.id, name: r.name }));
}

/** The most students one school's list draws; past it the page asks for a search instead. */
export const STUDENT_LIST_LIMIT = 2000;

/**
 * The students of ONE school — an active student profile on an active person with a LIVE school enrollment there
 * (`liveSchoolEnrollmentSql`: registered/active, not ended — the admin people rule) — with the active class they sit
 * in at that school and its پایه (the enrollment's پایه for a student not yet in a class). `q` narrows by name
 * (`app.fa_norm` over the generated `search_text`) or student number (any digits).
 */
export async function listSchoolStudents(tx: Tx, schoolId: string, q: string): Promise<CounselingStudentRow[]> {
  const term = q.trim();
  const search = term
    ? sql`and (p.search_text ilike '%' || app.fa_norm(${term}) || '%' or sp.student_number ilike '%' || ${toAsciiDigits(term)} || '%')`
    : sql``;
  const res = await tx.execute<{
    student_profile_id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    class_group_name: string | null;
    grade_level_id: string | null;
    grade_name: string | null;
    grade_sequence: number | null;
  }>(sql`
    select sp.id as student_profile_id, p.first_name, p.last_name, sp.student_number,
           c.name as class_group_name, gl.id as grade_level_id, gl.name as grade_name, gl.sequence as grade_sequence
    from iam.student_profile sp
    join iam.person p on p.id = sp.person_id and p.status = 'active'
    left join lateral (
      select cg.name, cg.grade_level_id
      from academic.class_enrollment ce
      join tenancy.class_group cg on cg.id = ce.class_group_id
      join tenancy.branch b on b.id = cg.branch_id
      where ce.student_profile_id = sp.id and ce.status = 'active' and b.school_id = ${schoolId}::uuid
      order by ce.starts_on desc
      limit 1
    ) c on true
    left join lateral (
      select se.grade_level_id
      from academic.school_enrollment se
      where se.student_profile_id = sp.id and se.school_id = ${schoolId}::uuid and ${liveSchoolEnrollmentSql("se")}
      order by se.starts_on desc
      limit 1
    ) e on true
    left join tenancy.grade_level gl on gl.id = coalesce(c.grade_level_id, e.grade_level_id)
    where sp.status = 'active'
      and exists (
        select 1 from academic.school_enrollment se2
        where se2.student_profile_id = sp.id and se2.school_id = ${schoolId}::uuid and ${liveSchoolEnrollmentSql("se2")}
      )
      ${search}
    order by gl.sequence nulls last, c.name nulls last, p.last_name, p.first_name
    limit ${STUDENT_LIST_LIMIT}`);
  return res.rows.map((r) => ({
    studentProfileId: r.student_profile_id,
    firstName: r.first_name,
    lastName: r.last_name,
    studentNumber: r.student_number,
    classGroupName: r.class_group_name,
    gradeLevelId: r.grade_level_id,
    gradeName: r.grade_name,
    gradeSequence: r.grade_sequence === null ? null : Number(r.grade_sequence),
  }));
}

/** Who a student is and where they belong NOW — the anchor every counseling read and write is checked against. */
export interface StudentAnchor {
  studentProfileId: string;
  personId: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
  /** The school of the student's live school enrollment (the current year's first) — the school every row is written at. */
  schoolId: string;
  schoolName: string;
  academicYearId: string;
  academicYearName: string;
  /** `YYYY-MM-DD` — where the year's summaries start. */
  yearStartsOn: string;
  classGroupId: string | null;
  classGroupName: string | null;
  gradeLevelId: string | null;
  gradeName: string | null;
}

/**
 * The student's anchor: an active profile on an active person with a LIVE school enrollment (the current academic
 * year's first, then the latest), its school and year, and the active class at that school with its پایه. Null for
 * an unknown id, another organization (RLS), or a student no school holds any more (transferred out, graduated,
 * withdrawn, removed) — the counseling file is about the students a school has NOW.
 */
export async function findStudentAnchor(tx: Tx, studentProfileId: string): Promise<StudentAnchor | null> {
  const res = await tx.execute<{
    student_profile_id: string;
    person_id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    school_id: string;
    school_name: string;
    academic_year_id: string;
    academic_year_name: string;
    year_starts_on: string;
    class_group_id: string | null;
    class_group_name: string | null;
    grade_level_id: string | null;
    grade_name: string | null;
  }>(sql`
    select sp.id as student_profile_id, sp.person_id, p.first_name, p.last_name, sp.student_number,
           e.school_id, s.name as school_name, e.academic_year_id, ay.name as academic_year_name, ay.starts_on as year_starts_on,
           c.id as class_group_id, c.name as class_group_name, gl.id as grade_level_id, gl.name as grade_name
    from iam.student_profile sp
    join iam.person p on p.id = sp.person_id and p.status = 'active'
    join lateral (
      select se.school_id, se.academic_year_id, se.grade_level_id
      from academic.school_enrollment se
      join tenancy.academic_year y on y.id = se.academic_year_id
      where se.student_profile_id = sp.id and ${liveSchoolEnrollmentSql("se")}
      order by y.is_current desc, se.starts_on desc
      limit 1
    ) e on true
    join tenancy.school s on s.id = e.school_id
    join tenancy.academic_year ay on ay.id = e.academic_year_id
    left join lateral (
      select cg.id, cg.name, cg.grade_level_id
      from academic.class_enrollment ce
      join tenancy.class_group cg on cg.id = ce.class_group_id
      join tenancy.branch b on b.id = cg.branch_id
      where ce.student_profile_id = sp.id and ce.status = 'active' and b.school_id = e.school_id
      order by ce.starts_on desc
      limit 1
    ) c on true
    left join tenancy.grade_level gl on gl.id = coalesce(c.grade_level_id, e.grade_level_id)
    where sp.id = ${studentProfileId}::uuid and sp.status = 'active'
    limit 1`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    studentProfileId: r.student_profile_id,
    personId: r.person_id,
    firstName: r.first_name,
    lastName: r.last_name,
    studentNumber: r.student_number,
    schoolId: r.school_id,
    schoolName: r.school_name,
    academicYearId: r.academic_year_id,
    academicYearName: r.academic_year_name,
    yearStartsOn: iso(r.year_starts_on),
    classGroupId: r.class_group_id,
    classGroupName: r.class_group_name,
    gradeLevelId: r.grade_level_id,
    gradeName: r.grade_name,
  };
}

/** The guardian's phone numbers of a person (`contact_point` labelled «ولی», the student forms' field), primary first. */
export async function listGuardianPhones(tx: Tx, personId: string): Promise<string[]> {
  const res = await tx.execute<{ value: string }>(sql`
    select cp.value from iam.contact_point cp
    where cp.person_id = ${personId}::uuid and cp.label = 'ولی' and cp.kind in ('mobile', 'landline')
    order by cp.is_primary desc, cp.created_at
    limit 5`);
  return res.rows.map((r) => r.value);
}

// ---------------------------------------------------------------------------------------------------------------
// the academic summary
// ---------------------------------------------------------------------------------------------------------------

export interface WorkItemStats {
  /** Tasks given to the student this year by someone else (not cancelled). */
  given: number;
  /** Of those, finished — the student's own «انجام شد», or the item closed as done. */
  done: number;
  /** Still open for the student and past their deadline. */
  overdue: number;
}

/**
 * The student's تکالیف since `since`: `task` items given by SOMEONE ELSE (a teacher, the school) with the student as
 * an assignee — never a personal item, never one the student gave themselves. One indexed pass over their assignee rows.
 */
export async function workItemStats(tx: Tx, studentPersonId: string, since: Date, now: Date): Promise<WorkItemStats> {
  const res = await tx.execute<{ given: number; done: number; overdue: number }>(sql`
    select
      (count(*) filter (where s.category <> 'cancelled'))::int as given,
      (count(*) filter (where s.category <> 'cancelled' and (wa.state = 'done' or s.category = 'done')))::int as done,
      (count(*) filter (where s.category in ('todo', 'doing') and wa.state <> 'done' and wi.due_at < ${now})) ::int as overdue
    from workspace.work_item_assignee wa
    join workspace.work_item wi on wi.id = wa.work_item_id
    join workspace.work_item_status s on s.id = wi.status_id
    join workspace.work_item_type t on t.id = wi.type_id
    where wa.person_id = ${studentPersonId}::uuid and wa.role = 'assignee'
      and wi.created_by_person_id <> ${studentPersonId}::uuid
      and wi.archived_at is null
      and t.code = 'task'
      and wi.created_at >= ${since}`);
  const r = res.rows[0];
  return { given: Number(r?.given ?? 0), done: Number(r?.done ?? 0), overdue: Number(r?.overdue ?? 0) };
}

/** The Jalali months that have learning objectives for a پایه — non-empty only for a primary پایه («کارنامهٴ توصیفی»). */
export async function reportCardMonths(tx: Tx, gradeLevelId: string): Promise<number[]> {
  const res = await tx.execute<{ month: number }>(sql`
    select distinct lo.month from academic.learning_objective lo
    where lo.grade_level_id = ${gradeLevelId}::uuid and lo.status = 'active'
    order by lo.month`);
  return res.rows.map((r) => Number(r.month));
}

// ---------------------------------------------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------------------------------------------

export interface NoteRow {
  id: string;
  schoolId: string;
  authorPersonId: string;
  authorName: string;
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The ACTIVE notes on a student the viewer may read, newest first: every note of a school in `write` reach (the
 * counselors there), and the `counselors_and_principal` ones of a school in `read` reach (its management).
 */
export async function listNotes(tx: Tx, studentProfileId: string, viewer: { read: SchoolReach; write: SchoolReach }): Promise<NoteRow[]> {
  const res = await tx.execute<{
    id: string;
    school_id: string;
    author_person_id: string;
    first_name: string;
    last_name: string;
    kind: NoteKind;
    visibility: NoteVisibility;
    body: string;
    status: "active" | "archived";
    created_at: string;
    updated_at: string;
  }>(sql`
    select n.id, n.school_id, n.author_person_id, p.first_name, p.last_name, n.kind, n.visibility, n.body, n.status, n.created_at, n.updated_at
    from counseling.counselor_note n
    join iam.person p on p.id = n.author_person_id
    where n.student_profile_id = ${studentProfileId}::uuid and n.status = 'active'
      and (${reachSql(viewer.write, "n.school_id")} or (n.visibility = 'counselors_and_principal' and ${reachSql(viewer.read, "n.school_id")}))
    order by n.created_at desc, n.id desc
    limit 300`);
  return res.rows.map((r) => ({
    id: r.id,
    schoolId: r.school_id,
    authorPersonId: r.author_person_id,
    authorName: `${r.first_name} ${r.last_name}`,
    kind: r.kind,
    visibility: r.visibility,
    body: r.body,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  }));
}

export interface NoteForWrite {
  id: string;
  schoolId: string;
  studentProfileId: string;
  authorPersonId: string;
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
  status: "active" | "archived";
}

/**
 * One note — RLS decides whether it exists for the current person. `lock`: under its row lock (an edit or an archive
 * serialises with any other on the same note). A locking read must also pass the note's UPDATE policy (its author
 * only, migration 0018), so the service reads it plainly first to tell «not yours» (FORBIDDEN) from «not there».
 */
export async function findNote(tx: Tx, noteId: string, opts: { lock?: boolean } = {}): Promise<NoteForWrite | null> {
  const res = await tx.execute<{
    id: string;
    school_id: string;
    student_profile_id: string;
    author_person_id: string;
    kind: NoteKind;
    visibility: NoteVisibility;
    body: string;
    status: "active" | "archived";
  }>(sql`
    select n.id, n.school_id, n.student_profile_id, n.author_person_id, n.kind, n.visibility, n.body, n.status
    from counseling.counselor_note n
    where n.id = ${noteId}::uuid
    ${opts.lock ? sql`for update` : sql``}`);
  const r = res.rows[0];
  return r
    ? { id: r.id, schoolId: r.school_id, studentProfileId: r.student_profile_id, authorPersonId: r.author_person_id, kind: r.kind, visibility: r.visibility, body: r.body, status: r.status }
    : null;
}

// ---------------------------------------------------------------------------------------------------------------
// teacher reports
// ---------------------------------------------------------------------------------------------------------------

export interface TeacherReportRow {
  id: string;
  authorPersonId: string;
  authorName: string;
  subjectName: string | null;
  kind: ReportKind;
  body: string;
  createdAt: Date;
}

/**
 * Active reports on a student: of the schools in `read` reach (counselors and management), or — `authorPersonId` —
 * the ones that person wrote (the teacher reads back their own, nothing else). Newest first.
 */
export async function listTeacherReports(tx: Tx, studentProfileId: string, who: { read: SchoolReach } | { authorPersonId: string }): Promise<TeacherReportRow[]> {
  const filter = "authorPersonId" in who ? sql`r.author_person_id = ${who.authorPersonId}::uuid` : reachSql(who.read, "r.school_id");
  const res = await tx.execute<{
    id: string;
    author_person_id: string;
    first_name: string;
    last_name: string;
    subject_name: string | null;
    kind: ReportKind;
    body: string;
    created_at: string;
  }>(sql`
    select r.id, r.author_person_id, p.first_name, p.last_name, subj.name as subject_name, r.kind, r.body, r.created_at
    from counseling.teacher_report r
    join iam.person p on p.id = r.author_person_id
    left join tenancy.class_offering o on o.id = r.class_offering_id
    left join tenancy.subject subj on subj.id = o.subject_id
    where r.student_profile_id = ${studentProfileId}::uuid and r.status = 'active' and ${filter}
    order by r.created_at desc, r.id desc
    limit 300`);
  return res.rows.map((r) => ({
    id: r.id,
    authorPersonId: r.author_person_id,
    authorName: `${r.first_name} ${r.last_name}`,
    subjectName: r.subject_name,
    kind: r.kind,
    body: r.body,
    createdAt: new Date(r.created_at),
  }));
}

/** One report — RLS decides whether it exists; `lock` as `findNote` (its author only may take it). */
export async function findReport(
  tx: Tx,
  reportId: string,
  opts: { lock?: boolean } = {},
): Promise<{ id: string; studentProfileId: string; schoolId: string; authorPersonId: string; kind: ReportKind; status: "active" | "archived" } | null> {
  const res = await tx.execute<{ id: string; student_profile_id: string; school_id: string; author_person_id: string; kind: ReportKind; status: "active" | "archived" }>(sql`
    select r.id, r.student_profile_id, r.school_id, r.author_person_id, r.kind, r.status
    from counseling.teacher_report r
    where r.id = ${reportId}::uuid
    ${opts.lock ? sql`for update` : sql``}`);
  const r = res.rows[0];
  return r ? { id: r.id, studentProfileId: r.student_profile_id, schoolId: r.school_id, authorPersonId: r.author_person_id, kind: r.kind, status: r.status } : null;
}

/**
 * Does `personId` teach the student NOW — a current teacher assignment (`valid_to` null) of their staff profile on an
 * open offering of the student's ACTIVE class at `schoolId`? Returns those offerings, the main teaching first (the
 * report is filed under one of them).
 */
export async function taughtOfferingsOfStudent(tx: Tx, personId: string, studentProfileId: string, schoolId: string): Promise<string[]> {
  const res = await tx.execute<{ id: string }>(sql`
    select o.id
    from academic.class_enrollment ce
    join tenancy.class_group cg on cg.id = ce.class_group_id and cg.status = 'active'
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.class_offering o on o.class_group_id = cg.id and o.status <> 'closed'
    join academic.teacher_assignment ta on ta.class_offering_id = o.id and ta.valid_to is null
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    where ce.student_profile_id = ${studentProfileId}::uuid and ce.status = 'active' and b.school_id = ${schoolId}::uuid
      and stp.person_id = ${personId}::uuid
    order by case ta.role when 'main' then 0 when 'assistant' then 1 else 2 end, o.id`);
  return [...new Set(res.rows.map((r) => r.id))];
}

export interface StudentTeacher {
  personId: string;
  name: string;
  /** The درس‌ها they teach the student, by name. */
  subjects: string[];
}

/** The people who teach the student now (every open offering of their active class at `schoolId`), with their درس‌ها. */
export async function listStudentTeachers(tx: Tx, studentProfileId: string, schoolId: string): Promise<StudentTeacher[]> {
  const res = await tx.execute<{ person_id: string; first_name: string; last_name: string; subject_name: string }>(sql`
    select p.id as person_id, p.first_name, p.last_name, subj.name as subject_name
    from academic.class_enrollment ce
    join tenancy.class_group cg on cg.id = ce.class_group_id and cg.status = 'active'
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.class_offering o on o.class_group_id = cg.id and o.status <> 'closed'
    join tenancy.subject subj on subj.id = o.subject_id
    join academic.teacher_assignment ta on ta.class_offering_id = o.id and ta.valid_to is null
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    join iam.person p on p.id = stp.person_id and p.status = 'active'
    where ce.student_profile_id = ${studentProfileId}::uuid and ce.status = 'active' and b.school_id = ${schoolId}::uuid
    order by p.last_name, p.first_name, subj.name`);
  const out = new Map<string, StudentTeacher>();
  for (const r of res.rows) {
    const t = out.get(r.person_id) ?? { personId: r.person_id, name: `${r.first_name} ${r.last_name}`, subjects: [] };
    if (!t.subjects.includes(r.subject_name)) t.subjects.push(r.subject_name);
    out.set(r.person_id, t);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// referrals
// ---------------------------------------------------------------------------------------------------------------

/**
 * The people a «ارجاع به مدیریت» goes to: active persons holding `counseling.referral.receive` through a valid
 * assignment AT the school (school-scoped, or branch-scoped at one of its branches — its principal and vice
 * principals); when the school has none, the organization-scoped holders (the organization admin). Never `exceptPersonId`.
 */
export async function managementOfSchool(tx: Tx, schoolId: string, exceptPersonId: string): Promise<string[]> {
  const holders = (scope: SQL) =>
    tx.execute<{ person_id: string }>(sql`
      select distinct ra.person_id
      from iam.role_assignment ra
      join iam.role_permission rp on rp.role_id = ra.role_id and rp.permission_code = 'counseling.referral.receive'
      join iam.person p on p.id = ra.person_id and p.status = 'active'
      where ra.revoked_at is null
        and (ra.valid_from is null or ra.valid_from <= current_date)
        and (ra.valid_to is null or ra.valid_to >= current_date)
        and ra.person_id <> ${exceptPersonId}::uuid
        and ${scope}
      order by ra.person_id`);
  const atSchool = await holders(
    sql`((ra.scope_type = 'school' and ra.school_id = ${schoolId}::uuid)
         or (ra.scope_type = 'branch' and exists (select 1 from tenancy.branch b where b.id = ra.branch_id and b.school_id = ${schoolId}::uuid)))`,
  );
  if (atSchool.rows.length > 0) return atSchool.rows.map((r) => r.person_id);
  const orgWide = await holders(sql`ra.scope_type = 'organization'`);
  return orgWide.rows.map((r) => r.person_id);
}

/**
 * The counselors of a school — whom a teacher's «گزارش به مشاور» is announced to: active persons holding
 * `counseling.note.write` through a valid assignment AT the school (school-scoped, or branch-scoped at one of its
 * branches). Management never holds it (catalog `NON_MANAGER_PERMS`). Never `exceptPersonId`.
 */
export async function counselorsOfSchool(tx: Tx, schoolId: string, exceptPersonId: string): Promise<string[]> {
  const res = await tx.execute<{ person_id: string }>(sql`
    select distinct ra.person_id
    from iam.role_assignment ra
    join iam.role_permission rp on rp.role_id = ra.role_id and rp.permission_code = 'counseling.note.write'
    join iam.person p on p.id = ra.person_id and p.status = 'active'
    where ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and ra.person_id <> ${exceptPersonId}::uuid
      and ((ra.scope_type = 'school' and ra.school_id = ${schoolId}::uuid)
           or (ra.scope_type = 'branch' and exists (select 1 from tenancy.branch b where b.id = ra.branch_id and b.school_id = ${schoolId}::uuid)))
    order by ra.person_id`);
  return res.rows.map((r) => r.person_id);
}

/**
 * FOR KEY SHARE on the given person rows in ascending id order, returning the ones still active — the recipients of a
 * new work item, read under the lock a removal's FOR UPDATE waits for (workspace/repo `RecipientReadOptions`,
 * iam/removal «Concurrency»: person rows before work items).
 */
export async function lockActivePersons(tx: Tx, personIds: readonly string[]): Promise<string[]> {
  if (personIds.length === 0) return [];
  const rows = await tx
    .select({ id: person.id })
    .from(person)
    .where(and(inArray(person.id, [...personIds]), eq(person.status, "active")))
    .orderBy(asc(person.id))
    .for("key share");
  return rows.map((r) => r.id);
}

export interface ReferralRow {
  id: string;
  kind: ReferralKind;
  workItemId: string;
  createdAt: Date;
  createdByName: string;
  title: string;
  priority: string;
  statusCategory: StatusCategory;
  /**
   * «پاسخ مدیریت»: the note of the answer that CLOSED the request — the item's latest transition, when it took the
   * item to a done status, was made by one of its addressees (an assignee) and the item's type is closed by its first
   * answer (`closesOnFirstAnswer`: an `admin_request`, i.e. «ارجاع به مدیریت»). Null otherwise: an open or reopened
   * item, a report request (teachers answer with a «گزارش به مشاور»), or a transition by anyone else — no other note
   * of the item ever reaches the file (security review 2026-10-14, D5).
   */
  answer: string | null;
  answerBy: string | null;
  answerAt: Date | null;
  assignees: Array<{ personId: string; name: string; state: "pending" | "accepted" | "done" }>;
}

/**
 * The referrals on a student of the schools in `read` reach, newest first, with their work item's live status and
 * the answer that closed it (`answer`). Every case reader of the school sees this list — title, status, addressees
 * and that answer — although only the item's participants can open the work item itself (`canViewWorkItem`).
 */
export async function listReferrals(tx: Tx, studentProfileId: string, read: SchoolReach): Promise<ReferralRow[]> {
  const res = await tx.execute<{
    id: string;
    kind: ReferralKind;
    work_item_id: string;
    created_at: string;
    first_name: string;
    last_name: string;
    title: string;
    priority: string;
    category: StatusCategory;
    type_code: string;
    last_note: string | null;
    last_note_by: string | null;
    last_note_at: string | null;
    last_category: StatusCategory | null;
    last_by_addressee: boolean | null;
  }>(sql`
    select r.id, r.kind, r.work_item_id, r.created_at, cp.first_name, cp.last_name, wi.title, wi.priority, s.category,
           ty.code as type_code,
           lt.note as last_note, lt.by_name as last_note_by, lt.at as last_note_at, lt.category as last_category, lt.by_addressee as last_by_addressee
    from counseling.referral r
    join workspace.work_item wi on wi.id = r.work_item_id
    join workspace.work_item_type ty on ty.id = wi.type_id
    join workspace.work_item_status s on s.id = wi.status_id
    join iam.person cp on cp.id = r.created_by_person_id
    left join lateral (
      -- The LATEST transition only (the item's current state): an answer counts while it is what closed the item.
      select t.note, t.at, bp.first_name || ' ' || bp.last_name as by_name, ts.category,
             exists (
               select 1 from workspace.work_item_assignee a
               where a.work_item_id = wi.id and a.person_id = t.by_person_id and a.role = 'assignee'
             ) as by_addressee
      from workspace.work_item_transition t
      join workspace.work_item_status ts on ts.id = t.to_status_id
      join iam.person bp on bp.id = t.by_person_id
      where t.work_item_id = wi.id
      order by t.at desc, t.id desc
      limit 1
    ) lt on true
    where r.student_profile_id = ${studentProfileId}::uuid and ${reachSql(read, "r.school_id")}
    order by r.created_at desc, r.id desc
    limit 100`);
  const ids = res.rows.map((r) => r.work_item_id);
  const people = new Map<string, ReferralRow["assignees"]>();
  if (ids.length > 0) {
    const a = await tx.execute<{ work_item_id: string; person_id: string; first_name: string; last_name: string; state: "pending" | "accepted" | "done" }>(sql`
      select a.work_item_id, a.person_id, p.first_name, p.last_name, a.state
      from workspace.work_item_assignee a
      join iam.person p on p.id = a.person_id
      where a.work_item_id = any(${sql.param(ids, undefined)}::uuid[]) and a.role = 'assignee'
      order by p.last_name, p.first_name`);
    for (const r of a.rows) {
      const list = people.get(r.work_item_id) ?? [];
      list.push({ personId: r.person_id, name: `${r.first_name} ${r.last_name}`, state: r.state });
      people.set(r.work_item_id, list);
    }
  }
  return res.rows.map((r) => {
    const answered = closesOnFirstAnswer(r.type_code) && r.last_category === "done" && r.last_by_addressee === true && !!r.last_note;
    return {
      id: r.id,
      kind: r.kind,
      workItemId: r.work_item_id,
      createdAt: new Date(r.created_at),
      createdByName: `${r.first_name} ${r.last_name}`,
      title: r.title,
      priority: r.priority,
      statusCategory: r.category,
      answer: answered ? r.last_note : null,
      answerBy: answered ? r.last_note_by : null,
      answerAt: answered && r.last_note_at ? new Date(r.last_note_at) : null,
      assignees: people.get(r.work_item_id) ?? [],
    };
  });
}

/** The referral behind a work item, when the current person may read it (RLS: its school's case readers and its addressees). */
export async function findReferralByWorkItem(
  tx: Tx,
  workItemId: string,
): Promise<{ id: string; kind: ReferralKind; schoolId: string; studentProfileId: string; createdByPersonId: string } | null> {
  const res = await tx.execute<{ id: string; kind: ReferralKind; school_id: string; student_profile_id: string; created_by_person_id: string }>(sql`
    select r.id, r.kind, r.school_id, r.student_profile_id, r.created_by_person_id from counseling.referral r where r.work_item_id = ${workItemId}::uuid limit 1`);
  const r = res.rows[0];
  return r ? { id: r.id, kind: r.kind, schoolId: r.school_id, studentProfileId: r.student_profile_id, createdByPersonId: r.created_by_person_id } : null;
}

/** Is `personId` an assignee of the work item? */
export async function isAssigneeOf(tx: Tx, personId: string, workItemId: string): Promise<boolean> {
  const res = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from workspace.work_item_assignee a where a.work_item_id = ${workItemId}::uuid and a.person_id = ${personId}::uuid and a.role = 'assignee') as ok`);
  return Boolean(res.rows[0]?.ok);
}

/** The student's display name (no scope decided here — callers have checked it). */
export async function studentNameOf(tx: Tx, studentProfileId: string): Promise<string | null> {
  const res = await tx.execute<{ first_name: string; last_name: string }>(sql`
    select p.first_name, p.last_name from iam.student_profile sp join iam.person p on p.id = sp.person_id where sp.id = ${studentProfileId}::uuid limit 1`);
  const r = res.rows[0];
  return r ? `${r.first_name} ${r.last_name}` : null;
}

/** The referral of a work item created with an idempotency key that was replayed (`duplicate`). */
export async function findReferralIdOfWorkItem(tx: Tx, workItemId: string): Promise<string | null> {
  const res = await tx.execute<{ id: string }>(sql`select r.id from counseling.referral r where r.work_item_id = ${workItemId}::uuid limit 1`);
  return res.rows[0]?.id ?? null;
}
