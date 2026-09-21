// academic/repo — read models over the academic graph. Repos take `tx`; queries/services own the permission gate.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";

export interface MyClassTeacher {
  offeringId: string;
  subjectName: string;
  teacherName: string | null;
}

export interface MyClass {
  classGroupName: string;
  schoolName: string;
  /** Active enrollments of the class group minus me. */
  classmates: number;
  /** One row per offering of the class, ordered by subject; `teacherName` is the current main teacher or null. */
  teachers: MyClassTeacher[];
}

/**
 * «کلاس من» for a student: the class, its school, the number of classmates and the current teacher of every
 * offering — ONE statement under RLS (the class fields repeat on every offering row; a class without offerings
 * still yields one row with a null offering). Null when the person has no active enrollment.
 */
export async function getMyClass(tx: Tx, personId: string): Promise<MyClass | null> {
  const res = await tx.execute<{
    class_group_name: string;
    school_name: string;
    classmates: number;
    offering_id: string | null;
    subject_name: string | null;
    teacher_name: string | null;
  }>(sql`
    with mine as (
      select cg.id as class_group_id, cg.name as class_group_name, s.name as school_name
      from iam.student_profile sp
      join academic.class_enrollment ce on ce.student_profile_id = sp.id and ce.status = 'active'
      join tenancy.class_group cg on cg.id = ce.class_group_id
      join tenancy.branch b on b.id = cg.branch_id
      join tenancy.school s on s.id = b.school_id
      where sp.person_id = ${personId}::uuid and sp.status = 'active'
      order by ce.starts_on desc
      limit 1
    )
    select
      m.class_group_name,
      m.school_name,
      (
        select count(*)::int
        from academic.class_enrollment ce2
        join iam.student_profile sp2 on sp2.id = ce2.student_profile_id
        where ce2.class_group_id = m.class_group_id and ce2.status = 'active' and sp2.person_id <> ${personId}::uuid
      ) as classmates,
      o.id as offering_id,
      subj.name as subject_name,
      (
        select p.first_name || ' ' || p.last_name
        from academic.teacher_assignment ta
        join iam.staff_profile stp on stp.id = ta.staff_profile_id
        join iam.person p on p.id = stp.person_id
        where ta.class_offering_id = o.id and ta.valid_to is null
        order by case ta.role when 'main' then 0 when 'assistant' then 1 else 2 end, ta.valid_from desc
        limit 1
      ) as teacher_name
    from mine m
    left join tenancy.class_offering o on o.class_group_id = m.class_group_id and o.status <> 'closed'
    left join tenancy.subject subj on subj.id = o.subject_id
    order by subj.name nulls last
  `);
  const first = res.rows[0];
  if (!first) return null;
  return {
    classGroupName: first.class_group_name,
    schoolName: first.school_name,
    classmates: Number(first.classmates),
    teachers: res.rows.flatMap((r) => (r.offering_id ? [{ offeringId: r.offering_id, subjectName: r.subject_name ?? "", teacherName: r.teacher_name }] : [])),
  };
}
