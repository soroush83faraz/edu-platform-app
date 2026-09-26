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
  subjectId: string;
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
    subject_id: string;
    subject_name: string;
    class_group_id: string;
    class_group_name: string;
    school_id: string;
    school_name: string;
    status: string;
    teacher_name: string | null;
    teacher_person_id: string | null;
  }>(sql`
    select o.id, subj.id as subject_id, subj.name as subject_name, cg.id as class_group_id, cg.name as class_group_name, s.id as school_id, s.name as school_name, o.status,
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
    subjectId: r.subject_id,
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

// ---------------------------------------------------------------------------------------------------------------
// attendance read models («حضور و غیاب», migration 0016)
// ---------------------------------------------------------------------------------------------------------------

export interface RosterStudent {
  studentProfileId: string;
  personId: string;
  fullName: string;
  studentNumber: string | null;
}

/**
 * The roster of a class ON a date: the students whose class_enrollment is `active` and has not ended before that
 * date. `starts_on` is deliberately NOT compared — a roll call for a past day still lists today's class (the
 * enrollment row carries the day the school registered the student, not the day they joined the room), and the
 * one-active-class-per-day exclusion constraint keeps a student out of two rosters anyway. Ordered like every
 * other person list: family name, then first name.
 */
export async function listClassRoster(tx: Tx, classGroupId: string, date: string): Promise<RosterStudent[]> {
  const res = await tx.execute<{ student_profile_id: string; person_id: string; first_name: string; last_name: string; student_number: string | null }>(sql`
    select sp.id as student_profile_id, p.id as person_id, p.first_name, p.last_name, sp.student_number
    from academic.class_enrollment ce
    join iam.student_profile sp on sp.id = ce.student_profile_id
    join iam.person p on p.id = sp.person_id
    where ce.class_group_id = ${classGroupId}::uuid
      and ce.status = 'active'
      and (ce.ends_on is null or ce.ends_on >= ${date}::date)
      and p.status = 'active'
    order by p.last_name, p.first_name`);
  return res.rows.map((r) => ({
    studentProfileId: r.student_profile_id,
    personId: r.person_id,
    fullName: `${r.first_name} ${r.last_name}`,
    studentNumber: r.student_number,
  }));
}

export interface AttendanceSessionRow {
  id: string;
  classGroupId: string;
  classOfferingId: string | null;
  date: string;
  periodNo: number | null;
  takenAt: Date;
  takenByPersonId: string;
  takenByName: string | null;
  note: string | null;
}

/** The roll call of one cell — `periodNo` null is the daily roll call (`is not distinct from`, like the UNIQUE). */
export async function findAttendanceSession(tx: Tx, classGroupId: string, date: string, periodNo: number | null): Promise<AttendanceSessionRow | null> {
  const res = await tx.execute<{
    id: string;
    class_group_id: string;
    class_offering_id: string | null;
    date: string;
    period_no: number | null;
    taken_at: Date;
    taken_by_person_id: string;
    taken_by_name: string | null;
    note: string | null;
  }>(sql`
    select s.id, s.class_group_id, s.class_offering_id, s.date::text as date, s.period_no, s.taken_at, s.taken_by_person_id,
      p.first_name || ' ' || p.last_name as taken_by_name, s.note
    from academic.attendance_session s
    left join iam.person p on p.id = s.taken_by_person_id
    where s.class_group_id = ${classGroupId}::uuid and s.date = ${date}::date and s.period_no is not distinct from ${periodNo}
    limit 1`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    classGroupId: r.class_group_id,
    classOfferingId: r.class_offering_id,
    date: r.date,
    periodNo: r.period_no === null ? null : Number(r.period_no),
    takenAt: new Date(r.taken_at),
    takenByPersonId: r.taken_by_person_id,
    takenByName: r.taken_by_name,
    note: r.note,
  };
}

export interface AttendanceEntryRow {
  id: string;
  studentProfileId: string;
  status: string;
  minutesLate: number | null;
  note: string | null;
}

export async function listSessionEntries(tx: Tx, sessionId: string): Promise<AttendanceEntryRow[]> {
  const res = await tx.execute<{ id: string; student_profile_id: string; status: string; minutes_late: number | null; note: string | null }>(sql`
    select id, student_profile_id, status, minutes_late, note
    from academic.attendance_entry
    where attendance_session_id = ${sessionId}::uuid`);
  return res.rows.map((r) => ({
    id: r.id,
    studentProfileId: r.student_profile_id,
    status: r.status,
    minutesLate: r.minutes_late === null ? null : Number(r.minutes_late),
    note: r.note,
  }));
}

export interface StudentAttendanceRow {
  date: string;
  periodNo: number | null;
  status: string;
  minutesLate: number | null;
  note: string | null;
  subjectName: string | null;
  classGroupName: string;
}

/** A student's marks in `[from, to]`, newest first — «حضور و غیاب من» and the admin's drill-down read the same rows. */
export async function listStudentAttendance(tx: Tx, studentProfileId: string, from: string, to: string, limit = 60): Promise<StudentAttendanceRow[]> {
  const res = await tx.execute<{ date: string; period_no: number | null; status: string; minutes_late: number | null; note: string | null; subject_name: string | null; class_group_name: string }>(sql`
    select s.date::text as date, s.period_no, e.status, e.minutes_late, e.note, subj.name as subject_name, cg.name as class_group_name
    from academic.attendance_entry e
    join academic.attendance_session s on s.id = e.attendance_session_id
    join tenancy.class_group cg on cg.id = s.class_group_id
    left join tenancy.class_offering o on o.id = s.class_offering_id
    left join tenancy.subject subj on subj.id = o.subject_id
    where e.student_profile_id = ${studentProfileId}::uuid and s.date between ${from}::date and ${to}::date
    order by s.date desc, s.period_no desc nulls last
    limit ${limit}`);
  return res.rows.map((r) => ({
    date: r.date,
    periodNo: r.period_no === null ? null : Number(r.period_no),
    status: r.status,
    minutesLate: r.minutes_late === null ? null : Number(r.minutes_late),
    note: r.note,
    subjectName: r.subject_name,
    classGroupName: r.class_group_name,
  }));
}

/** `status → count` of one student in `[from, to]` (every class they were in). */
export async function countStudentAttendance(tx: Tx, studentProfileId: string, from: string, to: string): Promise<Array<{ status: string; n: number }>> {
  const res = await tx.execute<{ status: string; n: number }>(sql`
    select e.status, count(*)::int as n
    from academic.attendance_entry e
    join academic.attendance_session s on s.id = e.attendance_session_id
    where e.student_profile_id = ${studentProfileId}::uuid and s.date between ${from}::date and ${to}::date
    group by e.status`);
  return res.rows.map((r) => ({ status: r.status, n: Number(r.n) }));
}

export interface ClassStatusCount {
  studentProfileId: string;
  fullName: string;
  status: string;
  n: number;
}

/** Per-student `status → count` of ONE class in `[from, to]` — the body of the admin report table. */
export async function countClassAttendanceByStudent(tx: Tx, classGroupId: string, from: string, to: string): Promise<ClassStatusCount[]> {
  const res = await tx.execute<{ student_profile_id: string; first_name: string; last_name: string; status: string; n: number }>(sql`
    select e.student_profile_id, p.first_name, p.last_name, e.status, count(*)::int as n
    from academic.attendance_entry e
    join academic.attendance_session s on s.id = e.attendance_session_id
    join iam.student_profile sp on sp.id = e.student_profile_id
    join iam.person p on p.id = sp.person_id
    where s.class_group_id = ${classGroupId}::uuid and s.date between ${from}::date and ${to}::date
    group by e.student_profile_id, p.first_name, p.last_name, e.status
    order by p.last_name, p.first_name`);
  return res.rows.map((r) => ({ studentProfileId: r.student_profile_id, fullName: `${r.first_name} ${r.last_name}`, status: r.status, n: Number(r.n) }));
}

export interface ClassDateCount {
  date: string;
  periodNo: number | null;
  status: string;
  n: number;
}

/** Per-date (and زنگ) `status → count` of one class — the report's day rows. */
export async function countClassAttendanceByDate(tx: Tx, classGroupId: string, from: string, to: string): Promise<ClassDateCount[]> {
  const res = await tx.execute<{ date: string; period_no: number | null; status: string; n: number }>(sql`
    select s.date::text as date, s.period_no, e.status, count(*)::int as n
    from academic.attendance_entry e
    join academic.attendance_session s on s.id = e.attendance_session_id
    where s.class_group_id = ${classGroupId}::uuid and s.date between ${from}::date and ${to}::date
    group by s.date, s.period_no, e.status
    order by s.date desc, s.period_no nulls first`);
  return res.rows.map((r) => ({ date: r.date, periodNo: r.period_no === null ? null : Number(r.period_no), status: r.status, n: Number(r.n) }));
}

export interface TakenCell {
  classGroupId: string;
  periodNo: number | null;
  entries: number;
  absent: number;
  takenAt: Date;
}

/** Which cells of `classGroupIds` already have a roll call on `date` (with their counts) — the «ثبت‌شده» marks. */
export async function listTakenCells(tx: Tx, date: string, classGroupIds: readonly string[]): Promise<TakenCell[]> {
  if (classGroupIds.length === 0) return [];
  const res = await tx.execute<{ class_group_id: string; period_no: number | null; entries: number; absent: number; taken_at: Date }>(sql`
    select s.class_group_id, s.period_no, s.taken_at,
      (select count(*)::int from academic.attendance_entry e where e.attendance_session_id = s.id) as entries,
      (select count(*)::int from academic.attendance_entry e where e.attendance_session_id = s.id and e.status = 'absent') as absent
    from academic.attendance_session s
    where s.date = ${date}::date and s.class_group_id = any(${sql.param([...classGroupIds], undefined)}::uuid[])`);
  return res.rows.map((r) => ({
    classGroupId: r.class_group_id,
    periodNo: r.period_no === null ? null : Number(r.period_no),
    entries: Number(r.entries),
    absent: Number(r.absent),
    takenAt: new Date(r.taken_at),
  }));
}

export interface UntakenCell {
  classGroupId: string;
  classGroupName: string;
  schoolId: string;
  schoolName: string;
  periodNo: number;
  offeringId: string;
  subjectName: string;
  teacherName: string | null;
}

/**
 * Today's timetable cells of the caller's schools that have NO roll call yet — «امروز ثبت نشده» on /admin/attendance.
 * `schoolIds` null = every school of the tenant (an organization admin); otherwise the caller's schools.
 */
export async function listUntakenCells(tx: Tx, date: string, weekday: number, schoolIds: readonly string[] | null): Promise<UntakenCell[]> {
  const schoolFilter = schoolIds === null ? sql`true` : sql`b.school_id = any(${sql.param([...schoolIds], undefined)}::uuid[])`;
  const res = await tx.execute<{
    class_group_id: string;
    class_group_name: string;
    school_id: string;
    school_name: string;
    period_no: number;
    offering_id: string;
    subject_name: string;
    teacher_name: string | null;
  }>(sql`
    select ts.class_group_id, cg.name as class_group_name, sc.id as school_id, sc.name as school_name, ts.period_no,
      o.id as offering_id, subj.name as subject_name, t.teacher_name
    from academic.timetable_slot ts
    join tenancy.class_group cg on cg.id = ts.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school sc on sc.id = b.school_id
    join tenancy.class_offering o on o.id = ts.class_offering_id
    join tenancy.subject subj on subj.id = o.subject_id
    left join lateral (
      select p.first_name || ' ' || p.last_name as teacher_name
      from academic.teacher_assignment ta
      join iam.staff_profile stp on stp.id = ta.staff_profile_id
      join iam.person p on p.id = stp.person_id
      where ta.class_offering_id = o.id and ta.valid_to is null
      order by case ta.role when 'main' then 0 when 'assistant' then 1 else 2 end, ta.valid_from desc
      limit 1
    ) t on true
    where ts.weekday = ${weekday} and cg.status = 'active' and o.status <> 'closed' and ${schoolFilter}
      and not exists (
        select 1 from academic.attendance_session s
        where s.class_group_id = ts.class_group_id and s.date = ${date}::date and s.period_no = ts.period_no
      )
    order by sc.name, cg.name, ts.period_no`);
  return res.rows.map((r) => ({
    classGroupId: r.class_group_id,
    classGroupName: r.class_group_name,
    schoolId: r.school_id,
    schoolName: r.school_name,
    periodNo: Number(r.period_no),
    offeringId: r.offering_id,
    subjectName: r.subject_name,
    teacherName: r.teacher_name,
  }));
}

/** The active student profile of a person (the `student` scope of their own reads); null when they are not one. */
export async function findStudentProfile(tx: Tx, personId: string): Promise<{ id: string; fullName: string } | null> {
  const res = await tx.execute<{ id: string; first_name: string; last_name: string }>(sql`
    select sp.id, p.first_name, p.last_name
    from iam.student_profile sp
    join iam.person p on p.id = sp.person_id
    where sp.person_id = ${personId}::uuid and sp.status = 'active'
    limit 1`);
  const r = res.rows[0];
  return r ? { id: r.id, fullName: `${r.first_name} ${r.last_name}` } : null;
}

/** The class a student profile currently belongs to (active enrollment) — the scope of a staff read about them. */
export async function findClassOfStudentProfile(tx: Tx, studentProfileId: string): Promise<{ classGroupId: string; classGroupName: string } | null> {
  const res = await tx.execute<{ class_group_id: string; class_group_name: string }>(sql`
    select cg.id as class_group_id, cg.name as class_group_name
    from academic.class_enrollment ce
    join tenancy.class_group cg on cg.id = ce.class_group_id
    where ce.student_profile_id = ${studentProfileId}::uuid and ce.status = 'active'
    order by ce.starts_on desc
    limit 1`);
  const r = res.rows[0];
  return r ? { classGroupId: r.class_group_id, classGroupName: r.class_group_name } : null;
}

export interface ClassPickerRow {
  id: string;
  name: string;
  schoolName: string;
  students: number;
}

/**
 * Active classes of `schoolIds` (null = every school of the tenant) with their school and roster size — the class
 * picker of the admin attendance report. Deliberately NOT the generic admin resource list: the academic module
 * must not depend on `src/lib/admin`.
 */
export async function listClassesForPicker(tx: Tx, schoolIds: readonly string[] | null): Promise<ClassPickerRow[]> {
  const filter = schoolIds === null ? sql`true` : sql`b.school_id = any(${sql.param([...schoolIds], undefined)}::uuid[])`;
  const res = await tx.execute<{ id: string; name: string; school_name: string; students: number }>(sql`
    select cg.id, cg.name, s.name as school_name,
      (select count(*)::int from academic.class_enrollment ce where ce.class_group_id = cg.id and ce.status = 'active') as students
    from tenancy.class_group cg
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school s on s.id = b.school_id
    where cg.status = 'active' and ${filter}
    order by s.name, cg.name`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, schoolName: r.school_name, students: Number(r.students) }));
}
