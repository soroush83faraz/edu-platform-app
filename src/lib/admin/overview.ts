// Counters of the admin scope — the /admin index, the Home tile and the onboarding checklist all read this one
// query. Everything is counted under RLS and narrowed to the caller's schools (organization admins see all).
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { defineQuery } from "@/lib/actions";
import { getAdminScope, type AdminScope } from "@/modules/iam/service";

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
  offerings: number;
  offeringsWithoutTeacher: number;
  teachers: number;
  teacherAssignments: number;
  staff: number;
  students: number;
  activeEnrollments: number;
  studentsWithoutClass: number;
  accountsPending: number;
}

/** `school_id = any(...)` fragment, or TRUE for organization scope. */
function schoolFilter(scope: AdminScope, column: string) {
  if (scope.kind === "organization") return sql`true`;
  return sql`${sql.raw(column)} = any(${sql.param(scope.schoolIds, undefined)}::uuid[])`;
}

/** Persons "in scope": students by school enrollment, staff by school-scoped roles or teaching; unanchored persons count everywhere. */
function personInScope(scope: AdminScope, personColumn: string) {
  if (scope.kind === "organization") return sql`true`;
  const p = sql.raw(personColumn);
  const ids = sql`${sql.param(scope.schoolIds, undefined)}::uuid[]`;
  return sql`(
    exists (select 1 from academic.school_enrollment se join iam.student_profile sp on sp.id = se.student_profile_id where sp.person_id = ${p} and se.school_id = any(${ids}))
    or exists (select 1 from iam.role_assignment ra where ra.person_id = ${p} and ra.revoked_at is null and ra.school_id = any(${ids}))
    or exists (select 1 from iam.role_assignment ra join tenancy.class_offering o on o.id = ra.class_offering_id join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id
               where ra.person_id = ${p} and ra.revoked_at is null and b.school_id = any(${ids}))
    or (
      not exists (select 1 from academic.school_enrollment se join iam.student_profile sp on sp.id = se.student_profile_id where sp.person_id = ${p})
      and not exists (select 1 from iam.role_assignment ra where ra.person_id = ${p} and ra.revoked_at is null and (ra.school_id is not null or ra.class_offering_id is not null or ra.branch_id is not null))
    )
  )`;
}

export { personInScope, schoolFilter };

export async function adminCounts(tx: Tx, scope: AdminScope): Promise<AdminCounts> {
  const n = async (q: ReturnType<typeof sql>): Promise<number> => {
    const res = await tx.execute<{ n: number }>(q);
    return Number(res.rows[0]?.n ?? 0);
  };
  const sch = (col: string) => schoolFilter(scope, col);
  return {
    schools: await n(sql`select count(*)::int as n from tenancy.school s where ${sch("s.id")}`),
    branches: await n(sql`select count(*)::int as n from tenancy.branch b where ${sch("b.school_id")}`),
    years: await n(sql`select count(*)::int as n from tenancy.academic_year y where ${sch("y.school_id")}`),
    currentYears: await n(sql`select count(*)::int as n from tenancy.academic_year y where y.is_current and ${sch("y.school_id")}`),
    terms: await n(sql`select count(*)::int as n from tenancy.term t join tenancy.academic_year y on y.id = t.academic_year_id where ${sch("y.school_id")}`),
    levels: await n(sql`select count(*)::int as n from tenancy.education_level`),
    grades: await n(sql`select count(*)::int as n from tenancy.grade_level`),
    subjects: await n(sql`select count(*)::int as n from tenancy.subject where parent_subject_id is null`),
    classes: await n(sql`select count(*)::int as n from tenancy.class_group cg join tenancy.branch b on b.id = cg.branch_id where cg.status = 'active' and ${sch("b.school_id")}`),
    offerings: await n(
      sql`select count(*)::int as n from tenancy.class_offering o join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where cg.status = 'active' and o.status <> 'closed' and ${sch("b.school_id")}`,
    ),
    offeringsWithoutTeacher: await n(
      sql`select count(*)::int as n from tenancy.class_offering o join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id
          where cg.status = 'active' and o.status <> 'closed' and ${sch("b.school_id")}
            and not exists (select 1 from academic.teacher_assignment ta where ta.class_offering_id = o.id and ta.valid_to is null)`,
    ),
    teachers: await n(
      sql`select count(distinct ta.staff_profile_id)::int as n from academic.teacher_assignment ta join tenancy.class_offering o on o.id = ta.class_offering_id
          join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where ta.valid_to is null and ${sch("b.school_id")}`,
    ),
    teacherAssignments: await n(
      sql`select count(*)::int as n from academic.teacher_assignment ta join tenancy.class_offering o on o.id = ta.class_offering_id
          join tenancy.class_group cg on cg.id = o.class_group_id join tenancy.branch b on b.id = cg.branch_id where ta.valid_to is null and ${sch("b.school_id")}`,
    ),
    staff: await n(sql`select count(*)::int as n from iam.staff_profile st join iam.person p on p.id = st.person_id where p.status = 'active' and st.left_on is null and ${personInScope(scope, "p.id")}`),
    students: await n(sql`select count(*)::int as n from iam.student_profile sp join iam.person p on p.id = sp.person_id where p.status = 'active' and sp.status = 'active' and ${personInScope(scope, "p.id")}`),
    activeEnrollments: await n(
      sql`select count(*)::int as n from academic.class_enrollment ce join tenancy.class_group cg on cg.id = ce.class_group_id join tenancy.branch b on b.id = cg.branch_id where ce.status = 'active' and ${sch("b.school_id")}`,
    ),
    studentsWithoutClass: await n(
      sql`select count(*)::int as n from iam.student_profile sp join iam.person p on p.id = sp.person_id where p.status = 'active' and sp.status = 'active' and ${personInScope(scope, "p.id")}
          and not exists (select 1 from academic.class_enrollment ce where ce.student_profile_id = sp.id and ce.status = 'active')`,
    ),
    accountsPending: await n(
      sql`select count(*)::int as n from iam.organization_membership m join iam.user_account ua on ua.id = m.user_account_id join iam.person p on p.id = m.person_id
          where m.status = 'active' and ua.must_change_password and p.status = 'active' and ${personInScope(scope, "p.id")}`,
    ),
  };
}

export interface AdminOverviewData {
  scope: AdminScope;
  counts: AdminCounts;
}

export const adminOverviewQuery = defineQuery({ permission: "iam.admin.access", scope: "any" }, async (tx, _input, ctx): Promise<AdminOverviewData> => {
  const scope = await getAdminScope(tx, ctx);
  return { scope, counts: await adminCounts(tx, scope) };
});
