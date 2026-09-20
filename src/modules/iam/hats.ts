// "Hats" — the roles a person wears, derived from data rather than from a switcher: a student profile with an
// active class, valid teacher role assignments (one per offering), and admin role assignments (reuses
// `getAdminScope`). Home stacks one section per hat. Every count runs under RLS inside the caller's transaction.
import { sql } from "drizzle-orm";
import { defineQuery, type Tx } from "@/lib/actions";
import type { Ctx } from "@/lib/ctx";
import { canAtAnyScope } from "./can";
import { getAdminScope, type AdminScope } from "./service";

export interface TeachingOffering {
  offeringId: string;
  subjectName: string;
  classGroupName: string;
  activeStudents: number;
  /** Open (todo/doing) items I created whose assignees include a student of this class. */
  openItems: number;
}

export interface Hats {
  isStudent: boolean;
  studentClass: { classGroupName: string; schoolName: string } | null;
  teachingOfferings: TeachingOffering[];
  adminScope: AdminScope["kind"] | null;
}

async function studentClassOf(tx: Tx, personId: string): Promise<Hats["studentClass"]> {
  const res = await tx.execute<{ class_group_name: string; school_name: string }>(sql`
    select cg.name as class_group_name, s.name as school_name
    from iam.student_profile sp
    join academic.class_enrollment ce on ce.student_profile_id = sp.id and ce.status = 'active'
    join tenancy.class_group cg on cg.id = ce.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school s on s.id = b.school_id
    where sp.person_id = ${personId}::uuid and sp.status = 'active'
    order by ce.starts_on desc
    limit 1
  `);
  const r = res.rows[0];
  return r ? { classGroupName: r.class_group_name, schoolName: r.school_name } : null;
}

async function isStudent(tx: Tx, personId: string): Promise<boolean> {
  const res = await tx.execute<{ n: number }>(sql`select count(*)::int as n from iam.student_profile sp where sp.person_id = ${personId}::uuid and sp.status = 'active'`);
  return Number(res.rows[0]?.n ?? 0) > 0;
}

async function teachingOfferingsOf(tx: Tx, personId: string): Promise<TeachingOffering[]> {
  const res = await tx.execute<{ offering_id: string; subject_name: string; class_group_name: string; active_students: number; open_items: number }>(sql`
    select
      o.id as offering_id,
      subj.name as subject_name,
      cg.name as class_group_name,
      (select count(*)::int from academic.class_enrollment ce where ce.class_group_id = cg.id and ce.status = 'active') as active_students,
      (
        select count(distinct wi.id)::int
        from workspace.work_item wi
        join workspace.work_item_status st on st.id = wi.status_id
        where wi.created_by_person_id = ${personId}::uuid
          and wi.archived_at is null
          and st.category in ('todo', 'doing')
          and exists (
            select 1
            from workspace.work_item_assignee a
            join iam.student_profile sp on sp.person_id = a.person_id
            join academic.class_enrollment ce on ce.student_profile_id = sp.id and ce.status = 'active'
            where a.work_item_id = wi.id and a.role = 'assignee' and ce.class_group_id = cg.id
          )
      ) as open_items
    from academic.teacher_assignment ta
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    join tenancy.class_offering o on o.id = ta.class_offering_id
    join tenancy.class_group cg on cg.id = o.class_group_id
    join tenancy.subject subj on subj.id = o.subject_id
    where stp.person_id = ${personId}::uuid
      and ta.valid_to is null
      and o.status <> 'closed'
      and cg.status = 'active'
    order by cg.name, subj.name
  `);
  return res.rows.map((r) => ({
    offeringId: r.offering_id,
    subjectName: r.subject_name,
    classGroupName: r.class_group_name,
    activeStudents: Number(r.active_students),
    openItems: Number(r.open_items),
  }));
}

export async function getHats(tx: Tx, ctx: Pick<Ctx, "orgId" | "personId" | "assignments">): Promise<Hats> {
  const student = await isStudent(tx, ctx.personId);
  const studentClass = student ? await studentClassOf(tx, ctx.personId) : null;
  const teachingOfferings = await teachingOfferingsOf(tx, ctx.personId);
  let adminScope: Hats["adminScope"] = null;
  if (canAtAnyScope(ctx.assignments, "iam.admin.access")) {
    try {
      adminScope = (await getAdminScope(tx, ctx)).kind;
    } catch {
      adminScope = null; // admin permission at a scope that maps to no school → no admin section
    }
  }
  return { isStudent: student, studentClass, teachingOfferings, adminScope };
}

/** Every member may ask which hats they wear (`iam.account.self` is implicit). */
export const hatsQuery = defineQuery({ permission: "iam.account.self" }, async (tx, _input, ctx) => getHats(tx, ctx));
