// Counters of the admin scope — the /admin index, the Home tile and the onboarding checklist all read this one
// query. Everything is counted under RLS and narrowed to the caller's schools (organization admins see all).
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { defineQuery } from "@/lib/actions";
import { getAdminScope, liveSchoolEnrollmentSql, personInScopeSql, type AdminScope } from "@/modules/iam/service";

export interface AdminCounts {
  schools: number;
  branches: number;
  years: number;
  currentYears: number;
  terms: number;
  levels: number;
  grades: number;
  subjects: number;
  classes: number;
  /** Active classes with no open offering — nothing to teach yet («نیازمند توجه»). */
  classesWithoutOfferings: number;
  /** Active classes with no timetable slot — the week is empty for their students. */
  classesWithoutTimetable: number;
  offerings: number;
  offeringsWithoutTeacher: number;
  teachers: number;
  teacherAssignments: number;
  staff: number;
  students: number;
  /** Active manual manager assignments (مدیر مدرسه + معاون) in scope — the count beside «نقش‌ها». */
  managerRoles: number;
  activeEnrollments: number;
  studentsWithoutClass: number;
  accountsPending: number;
}

/** `school_id = any(...)` fragment, or TRUE for organization scope. */
function schoolFilter(scope: AdminScope, column: string) {
  if (scope.kind === "organization") return sql`true`;
  return sql`${sql.raw(column)} = any(${sql.param(scope.schoolIds, undefined)}::uuid[])`;
}

/**
 * Persons "in scope" — the single rule of `iam/service` (`personInScopeSql`): a positive anchor (school enrollment,
 * staff primary school, school/branch-scoped role) in one of the caller's schools and no organization-scoped role.
 */
const personInScope = personInScopeSql;

export { personInScope, schoolFilter };

/** One `select count(...)` per counter, narrowed to the scope — `adminCounts` runs them all as ONE statement. */
export function adminCountStatements(scope: AdminScope): Record<keyof AdminCounts, SQL> {
  const sch = (col: string) => schoolFilter(scope, col);
  return {
    schools: sql`select count(*)::int from tenancy.school s where ${sch("s.id")}`,
    branches: sql`select count(*)::int from tenancy.branch b where ${sch("b.school_id")}`,
    years: sql`select count(*)::int from tenancy.academic_year y where ${sch("y.school_id")}`,
    currentYears: sql`select count(*)::int from tenancy.academic_year y where y.is_current and ${sch("y.school_id")}`,
    terms: sql`select count(*)::int from tenancy.term t join tenancy.academic_year y on y.id = t.academic_year_id where ${sch("y.school_id")}`,
    levels: sql`select count(*)::int from tenancy.education_level`,
    grades: sql`select count(*)::int from tenancy.grade_level`,
    subjects: sql`select count(*)::int from tenancy.subject where parent_subject_id is null`,
    classes: sql`select count(*)::int from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id where cg.status = 'active' and ${sch("b.school_id")}`,
    classesWithoutOfferings: sql`select count(*)::int from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id where cg.status = 'active' and ${sch("b.school_id")}
          and not exists (select 1 from tenancy.class_offering o where o.class_group_id = cg.id and o.status <> 'closed')`,
    classesWithoutTimetable: sql`select count(*)::int from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id where cg.status = 'active' and ${sch("b.school_id")}
          and not exists (select 1 from academic.timetable_slot ts where ts.class_group_id = cg.id)`,
    offerings: sql`select count(*)::int from tenancy.class_offering o join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where cg.status = 'active' and o.status <> 'closed' and ${sch("b.school_id")}`,
    offeringsWithoutTeacher: sql`select count(*)::int from tenancy.class_offering o join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id
          where cg.status = 'active' and o.status <> 'closed' and ${sch("b.school_id")}
            and not exists (select 1 from academic.teacher_assignment ta where ta.class_offering_id = o.id and ta.valid_to is null)`,
    teachers: sql`select count(distinct ta.staff_profile_id)::int from academic.teacher_assignment ta join tenancy.class_offering o on o.id = ta.class_offering_id
          join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where ta.valid_to is null and ${sch("b.school_id")}`,
    teacherAssignments: sql`select count(*)::int from academic.teacher_assignment ta join tenancy.class_offering o on o.id = ta.class_offering_id
          join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where ta.valid_to is null and ${sch("b.school_id")}`,
    staff: sql`select count(*)::int from iam.staff_profile st join iam.person p on p.id = st.person_id where p.status = 'active' and st.left_on is null and ${personInScope(scope, "p.id")}`,
    students: sql`select count(*)::int from iam.student_profile sp join iam.person p on p.id = sp.person_id where p.status = 'active' and sp.status = 'active' and ${personInScope(scope, "p.id")}`,
    managerRoles: sql`
      select count(*)::int from iam.role_assignment ra join iam.role r on r.id = ra.role_id
      where ra.revoked_at is null and ra.source_type = 'manual' and r.code in ('school_principal', 'vice_principal')
        and ${
          scope.kind === "organization"
            ? sql`true`
            : sql`(ra.school_id = any(${sql.param(scope.schoolIds, undefined)}::uuid[])
                or exists (select 1 from tenancy.branch b where b.id = ra.branch_id and b.school_id = any(${sql.param(scope.schoolIds, undefined)}::uuid[])))`
        }`,
    activeEnrollments: sql`select count(*)::int from academic.class_enrollment ce join tenancy.class_group cg on cg.id = ce.class_group_id join tenancy.branch b on b.id = cg.branch_id where ce.status = 'active' and ${sch("b.school_id")}`,
    studentsWithoutClass: sql`select count(*)::int from iam.student_profile sp join iam.person p on p.id = sp.person_id where p.status = 'active' and sp.status = 'active' and ${personInScope(scope, "p.id")}
          and not exists (select 1 from academic.class_enrollment ce where ce.student_profile_id = sp.id and ce.status = 'active')`,
    accountsPending: sql`select count(*)::int from iam.organization_membership m join iam.user_account ua on ua.id = m.user_account_id join iam.person p on p.id = m.person_id
          where m.status = 'active' and ua.must_change_password and p.status = 'active' and ${personInScope(scope, "p.id")}`,
  };
}

/**
 * Every counter in ONE statement — each one a scalar sub-select — instead of 21 sequential round trips: this runs on
 * every /admin page (the layout's section counts), and on a hosted database each round trip is paid in full.
 */
export async function adminCounts(tx: Tx, scope: AdminScope): Promise<AdminCounts> {
  const statements = adminCountStatements(scope);
  const keys = Object.keys(statements) as (keyof AdminCounts)[];
  const res = await tx.execute<Record<keyof AdminCounts, number>>(sql`select ${sql.join(keys.map((k) => sql`(${statements[k]}) as ${sql.identifier(k)}`), sql`, `)}`);
  const row = res.rows[0];
  return Object.fromEntries(keys.map((k) => [k, Number(row?.[k] ?? 0)])) as unknown as AdminCounts;
}

export interface SchoolCounts {
  id: string;
  name: string;
  classes: number;
  students: number;
  staff: number;
}

/**
 * The same three numbers as the counters, per school — what a principal of two schools or an organization admin
 * needs before the aggregate means anything (owner, QA round 3). Read only when the scope holds more than one
 * school; one statement, explicit columns, every sub-count narrowed to that school.
 */
export async function schoolCounts(tx: Tx, scope: AdminScope): Promise<SchoolCounts[]> {
  const res = await tx.execute<{ id: string; name: string; classes: number; students: number; staff: number }>(sql`
    select s.id, s.name,
      (select count(*)::int from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id where b.school_id = s.id and cg.status = 'active') as classes,
      (select count(*)::int from academic.school_enrollment se
         join iam.student_profile sp on sp.id = se.student_profile_id
         join iam.person p on p.id = sp.person_id
        where se.school_id = s.id and p.status = 'active' and sp.status = 'active' and ${liveSchoolEnrollmentSql("se")}) as students,
      (select count(*)::int from iam.staff_profile st join iam.person p2 on p2.id = st.person_id
        where st.school_id = s.id and p2.status = 'active' and st.left_on is null) as staff
    from tenancy.school s
    where ${schoolFilter(scope, "s.id")}
    order by s.is_default desc, s.name asc`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, classes: Number(r.classes), students: Number(r.students), staff: Number(r.staff) }));
}

/** The same three numbers as `schoolCounts`, for a SINGLE school — what the school hub's stat row shows. */
export async function oneSchoolCounts(tx: Tx, schoolId: string): Promise<{ classes: number; students: number; staff: number }> {
  const res = await tx.execute<{ classes: number; students: number; staff: number }>(sql`
    select
      (select count(*)::int from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id where b.school_id = ${schoolId} and cg.status = 'active') as classes,
      (select count(*)::int from academic.school_enrollment se
         join iam.student_profile sp on sp.id = se.student_profile_id
         join iam.person p on p.id = sp.person_id
        where se.school_id = ${schoolId} and p.status = 'active' and sp.status = 'active' and ${liveSchoolEnrollmentSql("se")}) as students,
      (select count(*)::int from iam.staff_profile st join iam.person p2 on p2.id = st.person_id
        where st.school_id = ${schoolId} and p2.status = 'active' and st.left_on is null) as staff`);
  const r = res.rows[0];
  return { classes: Number(r?.classes ?? 0), students: Number(r?.students ?? 0), staff: Number(r?.staff ?? 0) };
}

export interface AdminOverviewData {
  scope: AdminScope;
  counts: AdminCounts;
  /** Per-school rows when the scope spans two or more schools; empty (or absent) otherwise — one school IS the aggregate. */
  schools?: SchoolCounts[];
}

export const adminOverviewQuery = defineQuery({ permission: "iam.admin.access", scope: "any" }, async (tx, _input, ctx): Promise<AdminOverviewData> => {
  const scope = await getAdminScope(tx, ctx);
  const counts = await adminCounts(tx, scope);
  return { scope, counts, schools: counts.schools > 1 ? await schoolCounts(tx, scope) : [] };
});
