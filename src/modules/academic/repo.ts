// academic/repo — read models over the academic graph. Repos take `tx`; queries/services own the permission gate.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { normalizeTime } from "@/lib/timetable";

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

// ---------------------------------------------------------------------------------------------------------------
// timetable read models
// ---------------------------------------------------------------------------------------------------------------

/** One occupied cell of a weekly timetable, denormalized for display. */
export interface SlotRow {
  slotId: string;
  classGroupId: string;
  classGroupName: string;
  weekday: number;
  periodNo: number;
  offeringId: string;
  subjectName: string;
  /** Current main (else assistant/substitute) teacher of the offering; null when nobody teaches it yet. */
  teacherName: string | null;
  teacherPersonId: string | null;
  room: string | null;
}

type SlotRaw = {
  slot_id: string;
  class_group_id: string;
  class_group_name: string;
  weekday: number;
  period_no: number;
  offering_id: string;
  subject_name: string;
  teacher_name: string | null;
  teacher_person_id: string | null;
  room: string | null;
};

const SLOT_SELECT = sql`
  select
    ts.id as slot_id,
    cg.id as class_group_id,
    cg.name as class_group_name,
    ts.weekday,
    ts.period_no,
    o.id as offering_id,
    subj.name as subject_name,
    t.teacher_name,
    t.teacher_person_id,
    ts.room
  from academic.timetable_slot ts
  join tenancy.class_group cg on cg.id = ts.class_group_id
  join tenancy.class_offering o on o.id = ts.class_offering_id
  join tenancy.subject subj on subj.id = o.subject_id
  left join lateral (
    select p.first_name || ' ' || p.last_name as teacher_name, p.id as teacher_person_id
    from academic.teacher_assignment ta
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    join iam.person p on p.id = stp.person_id
    where ta.class_offering_id = o.id and ta.valid_to is null
    order by case ta.role when 'main' then 0 when 'assistant' then 1 else 2 end, ta.valid_from desc
    limit 1
  ) t on true`;

const toSlot = (r: SlotRaw): SlotRow => ({
  slotId: r.slot_id,
  classGroupId: r.class_group_id,
  classGroupName: r.class_group_name,
  weekday: Number(r.weekday),
  periodNo: Number(r.period_no),
  offeringId: r.offering_id,
  subjectName: r.subject_name,
  teacherName: r.teacher_name,
  teacherPersonId: r.teacher_person_id,
  room: r.room,
});

/** Every slot of one class group, weekday then period. */
export async function listClassSlots(tx: Tx, classGroupId: string): Promise<SlotRow[]> {
  const res = await tx.execute<SlotRaw>(sql`${SLOT_SELECT} where ts.class_group_id = ${classGroupId}::uuid order by ts.weekday, ts.period_no`);
  return res.rows.map(toSlot);
}

/** Every slot of the offerings `personId` currently teaches (valid teacher_assignment, open offering, active class). */
export async function listTaughtSlots(tx: Tx, personId: string): Promise<SlotRow[]> {
  const res = await tx.execute<SlotRaw>(sql`${SLOT_SELECT}
    where cg.status = 'active' and o.status <> 'closed' and exists (
      select 1 from academic.teacher_assignment mine
      join iam.staff_profile sp on sp.id = mine.staff_profile_id
      where mine.class_offering_id = o.id and mine.valid_to is null and sp.person_id = ${personId}::uuid
    )
    order by ts.weekday, ts.period_no, cg.name`);
  return res.rows.map(toSlot);
}

/** The slots of one offering (its sessions in the week). */
export async function listOfferingSlots(tx: Tx, offeringId: string): Promise<SlotRow[]> {
  const res = await tx.execute<SlotRaw>(sql`${SLOT_SELECT} where ts.class_offering_id = ${offeringId}::uuid order by ts.weekday, ts.period_no`);
  return res.rows.map(toSlot);
}

export interface PeriodRow {
  periodNo: number;
  label: string;
  startsAt: string;
  endsAt: string;
}

/** Bell schedules of many schools at once (a teacher's classes may span schools), keyed by school id. */
export async function listPeriodsOfSchools(tx: Tx, schoolIds: readonly string[]): Promise<Map<string, PeriodRow[]>> {
  const out = new Map<string, PeriodRow[]>();
  if (schoolIds.length === 0) return out;
  const res = await tx.execute<{ school_id: string; period_no: number; label: string; starts_at: string; ends_at: string }>(sql`
    select school_id, period_no, label, starts_at::text as starts_at, ends_at::text as ends_at
    from tenancy.school_period
    where school_id = any(${sql.param([...schoolIds], undefined)}::uuid[])
    order by school_id, period_no`);
  for (const r of res.rows) {
    const list = out.get(r.school_id) ?? [];
    list.push({ periodNo: Number(r.period_no), label: r.label, startsAt: normalizeTime(r.starts_at), endsAt: normalizeTime(r.ends_at) });
    out.set(r.school_id, list);
  }
  return out;
}

export interface StudentClassRef {
  classGroupId: string;
  classGroupName: string;
  schoolId: string;
  schoolName: string;
}

/** The active class of a student person (latest enrollment), with its school — null when not enrolled. */
export async function findStudentClass(tx: Tx, personId: string): Promise<StudentClassRef | null> {
  const res = await tx.execute<{ class_group_id: string; class_group_name: string; school_id: string; school_name: string }>(sql`
    select cg.id as class_group_id, cg.name as class_group_name, s.id as school_id, s.name as school_name
    from iam.student_profile sp
    join academic.class_enrollment ce on ce.student_profile_id = sp.id and ce.status = 'active'
    join tenancy.class_group cg on cg.id = ce.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school s on s.id = b.school_id
    where sp.person_id = ${personId}::uuid and sp.status = 'active'
    order by ce.starts_on desc
    limit 1`);
  const r = res.rows[0];
  return r ? { classGroupId: r.class_group_id, classGroupName: r.class_group_name, schoolId: r.school_id, schoolName: r.school_name } : null;
}

export interface OfferingFacts {
  id: string;
  subjectName: string;
  classGroupId: string;
  classGroupName: string;
  schoolId: string;
  schoolName: string;
  status: string;
  teacherName: string | null;
  teacherPersonId: string | null;
}

/** One offering with its class, school and current teacher; null when not visible here. */
export async function findOfferingFacts(tx: Tx, offeringId: string): Promise<OfferingFacts | null> {
  const res = await tx.execute<{
    id: string;
    subject_name: string;
    class_group_id: string;
    class_group_name: string;
    school_id: string;
    school_name: string;
    status: string;
    teacher_name: string | null;
    teacher_person_id: string | null;
  }>(sql`
    select o.id, subj.name as subject_name, cg.id as class_group_id, cg.name as class_group_name, s.id as school_id, s.name as school_name, o.status,
      t.teacher_name, t.teacher_person_id
    from tenancy.class_offering o
    join tenancy.subject subj on subj.id = o.subject_id
    join tenancy.class_group cg on cg.id = o.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school s on s.id = b.school_id
    left join lateral (
      select p.first_name || ' ' || p.last_name as teacher_name, p.id as teacher_person_id
      from academic.teacher_assignment ta
      join iam.staff_profile stp on stp.id = ta.staff_profile_id
      join iam.person p on p.id = stp.person_id
      where ta.class_offering_id = o.id and ta.valid_to is null
      order by case ta.role when 'main' then 0 when 'assistant' then 1 else 2 end, ta.valid_from desc
      limit 1
    ) t on true
    where o.id = ${offeringId}::uuid
    limit 1`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    subjectName: r.subject_name,
    classGroupId: r.class_group_id,
    classGroupName: r.class_group_name,
    schoolId: r.school_id,
    schoolName: r.school_name,
    status: r.status,
    teacherName: r.teacher_name,
    teacherPersonId: r.teacher_person_id,
  };
}

/** Does `personId` currently teach `offeringId` (valid teacher_assignment through their staff profile)? */
export async function teachesOffering(tx: Tx, personId: string, offeringId: string): Promise<boolean> {
  const res = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
    from academic.teacher_assignment ta
    join iam.staff_profile sp on sp.id = ta.staff_profile_id
    where ta.class_offering_id = ${offeringId}::uuid and ta.valid_to is null and sp.person_id = ${personId}::uuid`);
  return Number(res.rows[0]?.n ?? 0) > 0;
}

export interface TeacherClash {
  classGroupName: string;
  subjectName: string;
}

/**
 * Another class where the current teacher of `offeringId` already has a slot at (weekday, periodNo) — the
 * double-booking the service warns about (allowed by the database; docs/decisions.md «برنامهٴ کلاسی»).
 */
export async function findTeacherClash(tx: Tx, offeringId: string, weekday: number, periodNo: number): Promise<TeacherClash | null> {
  const res = await tx.execute<{ class_group_name: string; subject_name: string }>(sql`
    with teachers as (
      select ta.staff_profile_id from academic.teacher_assignment ta where ta.class_offering_id = ${offeringId}::uuid and ta.valid_to is null
    )
    select cg.name as class_group_name, subj.name as subject_name
    from academic.timetable_slot ts
    join tenancy.class_offering o on o.id = ts.class_offering_id
    join tenancy.class_group cg on cg.id = ts.class_group_id
    join tenancy.subject subj on subj.id = o.subject_id
    where ts.weekday = ${weekday} and ts.period_no = ${periodNo} and ts.class_offering_id <> ${offeringId}::uuid
      and exists (
        select 1 from academic.teacher_assignment other
        where other.class_offering_id = o.id and other.valid_to is null and other.staff_profile_id in (select staff_profile_id from teachers)
      )
    limit 1`);
  const r = res.rows[0];
  return r ? { classGroupName: r.class_group_name, subjectName: r.subject_name } : null;
}
