// academic/service — business rules for enrollments and teacher assignments. Every function is `(tx, ctx, input)`
// and runs inside the caller's tenant transaction (defineAction, or the seed's own app_owner transaction with the
// org context set). `organization_id` and the acting person come from `ctx`, never from input.
//
// teacher_assignment is the source of truth for "who teaches what"; authorization only reads iam.role_assignment.
// Therefore assignTeacher writes BOTH rows in one transaction (role `teacher`, scope `class_offering`,
// source_type `teacher_assignment`, source_id = the assignment id) and endTeacherAssignment revokes the derived row.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { conflict, invalidReference, notFound, validation } from "@/lib/errors";
import { normalizeFa } from "@/lib/normalize";
import { SCHOOL_WEEKDAYS, currentPeriodOf, nextSessionOf, tehranClock, type Weekday } from "@/lib/timetable";
import { can, canAtAnyScope, type CanContext } from "@/modules/iam/can";
import { role, roleAssignment, staffProfile } from "@/modules/iam/schema";
import { branch, classGroup, classOffering, school } from "@/modules/tenancy/schema";
import {
  findOfferingFacts,
  findStudentClass,
  findTeacherClash,
  listClassSlots,
  listOfferingSlots,
  listPeriodsOfSchools,
  listTaughtSlots,
  teachesOffering,
  type OfferingFacts,
  type PeriodRow,
  type SlotRow,
} from "./repo";
import { classEnrollment, schoolEnrollment, teacherAssignment, timetableSlot } from "./schema";

/** What the service needs from the request context (src/lib/ctx `Ctx` satisfies it; the seed builds one). */
export type ServiceCtx = AuditCtx & { orgId: string; personId: string };

export type TeacherRole = "main" | "assistant" | "substitute";
export type EnrollmentChangeReason = "transfer" | "level_change" | "admin";

const TEACHER_ROLE_CODE = "teacher";

export interface AssignTeacherInput {
  staffProfileId: string;
  classOfferingId: string;
  role?: TeacherRole;
  /** ISO date `YYYY-MM-DD`; defaults to today (DB `current_date`). */
  validFrom?: string;
}

export interface AssignTeacherResult {
  teacherAssignmentId: string;
  roleAssignmentId: string;
}

/**
 * Inserts academic.teacher_assignment AND the derived iam.role_assignment. The system `teacher` template is the
 * role (readable under any tenant via the tenant_isolation_select policy). Rejects with CONFLICT when the same
 * (offering, staff, role) is already active (partial unique `teacher_assignment_active_uq`).
 */
export async function assignTeacher(tx: Tx, ctx: ServiceCtx, input: AssignTeacherInput): Promise<AssignTeacherResult> {
  const teacherRole = input.role ?? "main";
  const [staff] = await tx
    .select({ id: staffProfile.id, personId: staffProfile.personId })
    .from(staffProfile)
    .where(eq(staffProfile.id, input.staffProfileId))
    .limit(1);
  if (!staff) throw invalidReference();

  const [tpl] = await tx
    .select({ id: role.id })
    .from(role)
    .where(and(isNull(role.organizationId), eq(role.code, TEACHER_ROLE_CODE)))
    .limit(1);
  if (!tpl) throw invalidReference("نقش سیستمی «معلم» یافت نشد.");

  const [existing] = await tx
    .select({ id: teacherAssignment.id })
    .from(teacherAssignment)
    .where(
      and(
        eq(teacherAssignment.classOfferingId, input.classOfferingId),
        eq(teacherAssignment.staffProfileId, input.staffProfileId),
        eq(teacherAssignment.role, teacherRole),
        isNull(teacherAssignment.validTo),
      ),
    )
    .limit(1);
  if (existing) throw conflict("این دبیر هم‌اکنون به این درس تخصیص دارد.");

  const [ta] = await tx
    .insert(teacherAssignment)
    .values({
      organizationId: ctx.orgId,
      staffProfileId: input.staffProfileId,
      classOfferingId: input.classOfferingId,
      role: teacherRole,
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
    })
    .returning({ id: teacherAssignment.id, validFrom: teacherAssignment.validFrom });

  const [ra] = await tx
    .insert(roleAssignment)
    .values({
      organizationId: ctx.orgId,
      personId: staff.personId,
      roleId: tpl.id,
      scopeType: "class_offering",
      classOfferingId: input.classOfferingId,
      sourceType: "teacher_assignment",
      sourceId: ta.id,
      grantedByPersonId: ctx.personId,
      validFrom: ta.validFrom,
    })
    .returning({ id: roleAssignment.id });

  await audit(
    ctx,
    "academic.teacher_assignment.created",
    { schema: "academic", table: "teacher_assignment", id: ta.id },
    null,
    { staffProfileId: input.staffProfileId, classOfferingId: input.classOfferingId, role: teacherRole, validFrom: ta.validFrom, roleAssignmentId: ra.id },
    tx,
  );
  return { teacherAssignmentId: ta.id, roleAssignmentId: ra.id };
}

export interface EndTeacherAssignmentInput {
  teacherAssignmentId: string;
  /** ISO date; defaults to today. */
  validTo?: string;
}

/** Sets `valid_to` on the assignment and `revoked_at` (+ `valid_to`) on its derived role_assignment(s). */
export async function endTeacherAssignment(tx: Tx, ctx: ServiceCtx, input: EndTeacherAssignmentInput): Promise<{ revokedRoleAssignments: number }> {
  // Default "today", but never before valid_from (an assignment that starts in the future ends as an empty range).
  const validTo = input.validTo ? sql`${input.validTo}::date` : sql`greatest(current_date, ${teacherAssignment.validFrom})`;
  const [ta] = await tx
    .update(teacherAssignment)
    .set({ validTo })
    .where(and(eq(teacherAssignment.id, input.teacherAssignmentId), isNull(teacherAssignment.validTo)))
    .returning({ id: teacherAssignment.id, validTo: teacherAssignment.validTo, staffProfileId: teacherAssignment.staffProfileId, classOfferingId: teacherAssignment.classOfferingId });
  if (!ta) throw invalidReference("تخصیص فعالی با این شناسه یافت نشد.");

  const revoked = await tx
    .update(roleAssignment)
    .set({ revokedAt: sql`now()`, validTo: ta.validTo })
    .where(and(eq(roleAssignment.sourceType, "teacher_assignment"), eq(roleAssignment.sourceId, ta.id), isNull(roleAssignment.revokedAt)))
    .returning({ id: roleAssignment.id });

  await audit(
    ctx,
    "academic.teacher_assignment.ended",
    { schema: "academic", table: "teacher_assignment", id: ta.id },
    { validTo: null },
    { validTo: ta.validTo, revokedRoleAssignments: revoked.map((r) => r.id) },
    tx,
  );
  return { revokedRoleAssignments: revoked.length };
}

export interface EnrollStudentInput {
  studentProfileId: string;
  classGroupId: string;
  /** ISO date; defaults to today. */
  startsOn?: string;
}

export interface EnrollStudentResult {
  schoolEnrollmentId: string;
  classEnrollmentId: string;
  /** false when the student already had a school_enrollment for that academic year (reused). */
  schoolEnrollmentCreated: boolean;
}

interface ClassGroupFacts {
  id: string;
  academicYearId: string;
  gradeLevelId: string;
  schoolId: string;
}

async function loadClassGroup(tx: Tx, classGroupId: string): Promise<ClassGroupFacts> {
  const [cg] = await tx
    .select({ id: classGroup.id, academicYearId: classGroup.academicYearId, gradeLevelId: classGroup.gradeLevelId, schoolId: branch.schoolId })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .where(eq(classGroup.id, classGroupId))
    .limit(1);
  if (!cg) throw invalidReference("کلاس یافت نشد.");
  return cg;
}

/**
 * Enrolls a student in a class: finds or creates the school_enrollment for the class's (school, academic year,
 * grade) and inserts an active class_enrollment. A second active class in the same period is rejected by the
 * exclusion constraint (`class_enrollment_active_excl`) — use moveEnrollment for a transfer.
 */
export async function enrollStudent(tx: Tx, ctx: ServiceCtx, input: EnrollStudentInput): Promise<EnrollStudentResult> {
  const cg = await loadClassGroup(tx, input.classGroupId);
  const startsOn = input.startsOn ? { startsOn: input.startsOn } : {};

  let schoolEnrollmentCreated = false;
  const [existing] = await tx
    .select({ id: schoolEnrollment.id, gradeLevelId: schoolEnrollment.gradeLevelId, status: schoolEnrollment.status })
    .from(schoolEnrollment)
    .where(and(eq(schoolEnrollment.studentProfileId, input.studentProfileId), eq(schoolEnrollment.academicYearId, cg.academicYearId)))
    .limit(1);
  let se: { id: string };
  if (!existing) {
    [se] = await tx
      .insert(schoolEnrollment)
      .values({
        organizationId: ctx.orgId,
        studentProfileId: input.studentProfileId,
        schoolId: cg.schoolId,
        academicYearId: cg.academicYearId,
        gradeLevelId: cg.gradeLevelId,
        status: "active",
        ...startsOn,
      })
      .returning({ id: schoolEnrollment.id });
    schoolEnrollmentCreated = true;
  } else {
    se = existing;
    // A `registered` anchor row (student created with a school but no class) gets its grade from the first class.
    if (existing.status === "registered" || existing.gradeLevelId === null) {
      await tx
        .update(schoolEnrollment)
        .set({ gradeLevelId: existing.gradeLevelId ?? cg.gradeLevelId, ...(existing.status === "registered" ? { status: "active" } : {}) })
        .where(eq(schoolEnrollment.id, existing.id));
    }
  }

  const [ce] = await tx
    .insert(classEnrollment)
    .values({
      organizationId: ctx.orgId,
      schoolEnrollmentId: se.id,
      classGroupId: cg.id,
      studentProfileId: input.studentProfileId,
      status: "active",
      changedByPersonId: ctx.personId,
      ...startsOn,
    })
    .returning({ id: classEnrollment.id, startsOn: classEnrollment.startsOn });

  await audit(
    ctx,
    "academic.class_enrollment.created",
    { schema: "academic", table: "class_enrollment", id: ce.id },
    null,
    { studentProfileId: input.studentProfileId, classGroupId: cg.id, schoolEnrollmentId: se.id, startsOn: ce.startsOn },
    tx,
  );
  return { schoolEnrollmentId: se.id, classEnrollmentId: ce.id, schoolEnrollmentCreated };
}

export interface MoveEnrollmentInput {
  classEnrollmentId: string;
  newClassGroupId: string;
  reason: EnrollmentChangeReason;
}

/**
 * Transfers a student to another class of the SAME academic year: the current row ends today
 * (`status = 'transferred'`, `ends_on = today`) and a new active row starts today with `previous_enrollment_id`.
 */
export async function moveEnrollment(tx: Tx, ctx: ServiceCtx, input: MoveEnrollmentInput): Promise<{ classEnrollmentId: string }> {
  const [current] = await tx
    .select({
      id: classEnrollment.id,
      schoolEnrollmentId: classEnrollment.schoolEnrollmentId,
      classGroupId: classEnrollment.classGroupId,
      studentProfileId: classEnrollment.studentProfileId,
      academicYearId: classGroup.academicYearId,
    })
    .from(classEnrollment)
    .innerJoin(classGroup, eq(classGroup.id, classEnrollment.classGroupId))
    .where(and(eq(classEnrollment.id, input.classEnrollmentId), eq(classEnrollment.status, "active")))
    .limit(1);
  if (!current) throw invalidReference("ثبت‌نام فعالی با این شناسه یافت نشد.");
  if (current.classGroupId === input.newClassGroupId) throw validation(undefined, "دانش‌آموز هم‌اکنون در همین کلاس است.");

  const target = await loadClassGroup(tx, input.newClassGroupId);
  if (target.academicYearId !== current.academicYearId) {
    throw validation(undefined, "انتقال فقط بین کلاس‌های همان سال تحصیلی ممکن است.");
  }

  // ends_on = today, but never before starts_on (a future-dated enrollment collapses to an empty range).
  await tx
    .update(classEnrollment)
    .set({ status: "transferred", endsOn: sql`greatest(current_date, ${classEnrollment.startsOn})`, changeReason: input.reason, changedByPersonId: ctx.personId })
    .where(eq(classEnrollment.id, current.id));

  const [next] = await tx
    .insert(classEnrollment)
    .values({
      organizationId: ctx.orgId,
      schoolEnrollmentId: current.schoolEnrollmentId,
      classGroupId: target.id,
      studentProfileId: current.studentProfileId,
      status: "active",
      changeReason: input.reason,
      previousEnrollmentId: current.id,
      changedByPersonId: ctx.personId,
    })
    .returning({ id: classEnrollment.id });

  await audit(
    ctx,
    "academic.class_enrollment.moved",
    { schema: "academic", table: "class_enrollment", id: next.id },
    { classEnrollmentId: current.id, classGroupId: current.classGroupId },
    { classGroupId: target.id, reason: input.reason },
    tx,
  );
  return { classEnrollmentId: next.id };
}

// ---------------------------------------------------------------------------------------------------------------
// weekly timetable («برنامهٴ کلاسی»)
// ---------------------------------------------------------------------------------------------------------------

/** Timetable functions decide scope themselves (`can()` inside), so they need the caller's assignments too. */
export type TimetableCtx = ServiceCtx & CanContext;

export const TIMETABLE_MESSAGES = {
  offeringNotOfClass: "این درس برای این کلاس تعریف نشده است.",
  offeringClosed: "این درس پایان یافته و در برنامه قرار نمی‌گیرد.",
  periodUnknown: "این زنگ در زنگ‌بندی مدرسه وجود ندارد.",
  weekdayUnknown: "روز هفته نامعتبر است.",
  /** `(teacher, class, subject)` — the double-booking warning (allowed, flagged). */
  teacherClash: (teacher: string, cls: string, subject: string) => `${teacher} در همین زنگ در کلاس ${cls} (${subject}) هم درس دارد.`,
} as const;

export interface SetTimetableSlotInput {
  classGroupId: string;
  /** 0 = شنبه … 5 = پنجشنبه. */
  weekday: number;
  periodNo: number;
  /** null = clear the cell (the row is deleted). */
  classOfferingId: string | null;
  room?: string | null;
}

export interface SetTimetableSlotResult {
  /** The slot after the change; null when the cell was cleared. */
  slot: SlotRow | null;
  /** Persian double-booking warning: the offering's teacher already has another class at this cell. */
  warning: string | null;
}

/**
 * Upserts or clears one cell of a class's weekly timetable. Scope: `academic.timetable.write` must hold at the
 * class group (through the school — org admin, principal, vice principal of that school); an unknown class or one
 * outside the caller's scope is NOT_FOUND alike (no existence oracle). The offering must be an open offering OF
 * THIS class and the period must exist in the school's زنگ‌بندی (VALIDATION otherwise). A teacher already booked
 * elsewhere at the same cell is ALLOWED — the database has no constraint for it — but the result carries a Persian
 * `warning` the UI shows as a toast (docs/decisions.md «برنامهٴ کلاسی»: substitutes and split classes are real).
 * Audited on the class group (`academic.timetable_slot.set` / `.cleared`).
 */
export async function setTimetableSlot(tx: Tx, ctx: TimetableCtx, input: SetTimetableSlotInput): Promise<SetTimetableSlotResult> {
  const cg = await findClassGroupFacts(tx, input.classGroupId);
  if (!cg) throw notFound();
  if (!(await can(tx, ctx, "academic.timetable.write", { scopeType: "class_group", id: cg.id }))) throw notFound();
  if (!SCHOOL_WEEKDAYS.includes(input.weekday as (typeof SCHOOL_WEEKDAYS)[number])) throw validation({ fieldErrors: { weekday: [TIMETABLE_MESSAGES.weekdayUnknown] } }, TIMETABLE_MESSAGES.weekdayUnknown);
  const periods = (await listPeriodsOfSchools(tx, [cg.schoolId])).get(cg.schoolId) ?? [];
  if (!periods.some((p) => p.periodNo === input.periodNo)) throw validation({ fieldErrors: { periodNo: [TIMETABLE_MESSAGES.periodUnknown] } }, TIMETABLE_MESSAGES.periodUnknown);

  const [before] = await tx
    .select({ id: timetableSlot.id, classOfferingId: timetableSlot.classOfferingId, room: timetableSlot.room })
    .from(timetableSlot)
    .where(and(eq(timetableSlot.classGroupId, cg.id), eq(timetableSlot.weekday, input.weekday), eq(timetableSlot.periodNo, input.periodNo)))
    .limit(1);
  const entity = { schema: "academic", table: "timetable_slot" } as const;
  const cell = { classGroupId: cg.id, weekday: input.weekday, periodNo: input.periodNo };

  if (input.classOfferingId === null) {
    if (!before) return { slot: null, warning: null };
    await tx.delete(timetableSlot).where(eq(timetableSlot.id, before.id));
    await audit(ctx, "academic.timetable_slot.cleared", { ...entity, id: before.id }, { ...cell, classOfferingId: before.classOfferingId, room: before.room }, null, tx);
    return { slot: null, warning: null };
  }

  const [offering] = await tx
    .select({ id: classOffering.id, classGroupId: classOffering.classGroupId, status: classOffering.status })
    .from(classOffering)
    .where(eq(classOffering.id, input.classOfferingId))
    .limit(1);
  if (!offering || offering.classGroupId !== cg.id) throw validation({ fieldErrors: { classOfferingId: [TIMETABLE_MESSAGES.offeringNotOfClass] } }, TIMETABLE_MESSAGES.offeringNotOfClass);
  if (offering.status === "closed") throw validation({ fieldErrors: { classOfferingId: [TIMETABLE_MESSAGES.offeringClosed] } }, TIMETABLE_MESSAGES.offeringClosed);
  const room = input.room?.trim() ? normalizeFa(input.room.trim()) : null;

  let id: string;
  if (before) {
    id = before.id;
    await tx.update(timetableSlot).set({ classOfferingId: offering.id, room }).where(eq(timetableSlot.id, before.id));
  } else {
    const [row] = await tx
      .insert(timetableSlot)
      .values({ organizationId: ctx.orgId, classGroupId: cg.id, weekday: input.weekday, periodNo: input.periodNo, classOfferingId: offering.id, room })
      .returning({ id: timetableSlot.id });
    id = row.id;
  }
  await audit(
    ctx,
    "academic.timetable_slot.set",
    { ...entity, id },
    before ? { ...cell, classOfferingId: before.classOfferingId, room: before.room } : null,
    { ...cell, classOfferingId: offering.id, room },
    tx,
  );
  const slot = (await listClassSlots(tx, cg.id)).find((s) => s.slotId === id) ?? null;
  let warning: string | null = null;
  if (slot?.teacherName) {
    const clash = await findTeacherClash(tx, offering.id, input.weekday, input.periodNo);
    if (clash) warning = TIMETABLE_MESSAGES.teacherClash(slot.teacherName, clash.classGroupName, clash.subjectName);
  }
  return { slot, warning };
}

export interface ClassGroupRef {
  id: string;
  name: string;
  schoolId: string;
  schoolName: string;
}

/** The class with its school — the one lookup every class-scoped service starts from (unknown id = null). */
export async function findClassGroupFacts(tx: Tx, classGroupId: string): Promise<ClassGroupRef | null> {
  const [cg] = await tx
    .select({ id: classGroup.id, name: classGroup.name, schoolId: branch.schoolId, schoolName: school.name })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .innerJoin(school, eq(school.id, branch.schoolId))
    .where(eq(classGroup.id, classGroupId))
    .limit(1);
  return cg ?? null;
}

export interface TimetableOffering {
  id: string;
  subjectName: string;
  teacherName: string | null;
  status: string;
}

export interface ClassTimetable {
  classGroup: ClassGroupRef;
  periods: PeriodRow[];
  slots: SlotRow[];
  /** Open offerings of the class — the choices of the editor's selects. */
  offerings: TimetableOffering[];
  /** Whether the caller may edit (`academic.timetable.write` at the class). */
  canEdit: boolean;
}

/** The whole grid of one class for the admin editor. Read scope: `academic.timetable.read` at the class group. */
export async function getClassTimetable(tx: Tx, ctx: TimetableCtx, classGroupId: string): Promise<ClassTimetable> {
  const cg = await findClassGroupFacts(tx, classGroupId);
  if (!cg) throw notFound();
  if (!(await can(tx, ctx, "academic.timetable.read", { scopeType: "class_group", id: cg.id }))) throw notFound();
  const periods = (await listPeriodsOfSchools(tx, [cg.schoolId])).get(cg.schoolId) ?? [];
  const slots = await listClassSlots(tx, cg.id);
  const rows = await tx.execute<{ id: string; subject_name: string; teacher_name: string | null; status: string }>(sql`
    select o.id, subj.name as subject_name, o.status,
      (
        select p.first_name || ' ' || p.last_name
        from academic.teacher_assignment ta
        join iam.staff_profile stp on stp.id = ta.staff_profile_id
        join iam.person p on p.id = stp.person_id
        where ta.class_offering_id = o.id and ta.valid_to is null
        order by case ta.role when 'main' then 0 when 'assistant' then 1 else 2 end, ta.valid_from desc
        limit 1
      ) as teacher_name
    from tenancy.class_offering o
    join tenancy.subject subj on subj.id = o.subject_id
    where o.class_group_id = ${cg.id}::uuid and o.status <> 'closed'
    order by subj.name`);
  const canEdit = await can(tx, ctx, "academic.timetable.write", { scopeType: "class_group", id: cg.id });
  return {
    classGroup: cg,
    periods,
    slots,
    offerings: rows.rows.map((r) => ({ id: r.id, subjectName: r.subject_name, teacherName: r.teacher_name, status: r.status })),
    canEdit,
  };
}

/** One session as the student/teacher pages render it: the slot plus the bell times of its school. */
export interface Session extends SlotRow {
  label: string;
  startsAt: string;
  endsAt: string;
}

export interface DayPlan {
  weekday: Weekday;
  sessions: Session[];
}

export interface MyTimetable {
  /** Student view: the class of the active enrollment; null when the person is not an enrolled student. */
  student: { classGroupName: string; schoolName: string; periods: PeriodRow[]; days: DayPlan[] } | null;
  /** Teacher view: every session of the offerings the person teaches; null when they teach nothing on the grid. */
  teacher: { days: DayPlan[]; sessions: number } | null;
  /** Tehran clock at the time of the read. */
  today: Weekday;
  nowMinutes: number;
  /** Ringing / next زنگ of the STUDENT's school (teachers span schools: the pages compute per session). */
  currentPeriodNo: number | null;
  nextPeriodNo: number | null;
}

function toDays(slots: readonly SlotRow[], periodsOf: (schoolId: string) => PeriodRow[], schoolOfClass: (classGroupId: string) => string): DayPlan[] {
  const days: DayPlan[] = SCHOOL_WEEKDAYS.map((weekday) => ({ weekday, sessions: [] }));
  for (const s of slots) {
    const p = periodsOf(schoolOfClass(s.classGroupId)).find((x) => x.periodNo === s.periodNo);
    if (!p) continue; // a slot beyond the current زنگ‌بندی stays invisible until a period with that number exists again
    const day = days.find((d) => d.weekday === s.weekday);
    if (!day) continue;
    day.sessions.push({ ...s, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt });
  }
  for (const d of days) d.sessions.sort((a, b) => a.periodNo - b.periodNo || a.classGroupName.localeCompare(b.classGroupName, "fa"));
  return days;
}

/**
 * «برنامهٴ من»: a student's class timetable and/or a teacher's teaching sessions across classes, grouped by weekday
 * with `today` and the ringing period (Tehran). Personal read — the person's own enrollment / assignments are the
 * boundary; the caller holds `academic.timetable.read` at some scope (checked by the query).
 */
export async function getMyTimetable(tx: Tx, ctx: TimetableCtx, now = new Date()): Promise<MyTimetable> {
  const clock = tehranClock(now);
  const cls = await findStudentClass(tx, ctx.personId);
  const taught = await listTaughtSlots(tx, ctx.personId);
  const schoolIds = new Set<string>();
  if (cls) schoolIds.add(cls.schoolId);
  const classSchool = new Map<string, string>();
  if (cls) classSchool.set(cls.classGroupId, cls.schoolId);
  if (taught.length > 0) {
    const ids = [...new Set(taught.map((s) => s.classGroupId))];
    const rows = await tx
      .select({ id: classGroup.id, schoolId: branch.schoolId })
      .from(classGroup)
      .innerJoin(branch, eq(branch.id, classGroup.branchId))
      .where(inArray(classGroup.id, ids));
    for (const r of rows) {
      classSchool.set(r.id, r.schoolId);
      schoolIds.add(r.schoolId);
    }
  }
  const periodsBySchool = await listPeriodsOfSchools(tx, [...schoolIds]);
  const periodsOf = (schoolId: string) => periodsBySchool.get(schoolId) ?? [];
  const schoolOf = (classGroupId: string) => classSchool.get(classGroupId) ?? "";

  let student: MyTimetable["student"] = null;
  if (cls) {
    const slots = await listClassSlots(tx, cls.classGroupId);
    student = { classGroupName: cls.classGroupName, schoolName: cls.schoolName, periods: periodsOf(cls.schoolId), days: toDays(slots, periodsOf, schoolOf) };
  }
  const teacher: MyTimetable["teacher"] = taught.length > 0 ? { days: toDays(taught, periodsOf, schoolOf), sessions: taught.length } : null;
  const ref = cls ? periodsOf(cls.schoolId) : teacher ? periodsOf(schoolOf(taught[0].classGroupId)) : [];
  const { currentPeriodNo, nextPeriodNo } = currentPeriodOf(ref, clock.minutes);
  return { student, teacher, today: clock.weekday, nowMinutes: clock.minutes, currentPeriodNo, nextPeriodNo };
}

export interface OfferingPage {
  offering: OfferingFacts;
  /** All sessions of the درس in the week, with times. */
  sessions: Session[];
  /** The next session from now (Tehran), with how many days ahead it is (0 = today). */
  nextSession: (Session & { daysAhead: number }) | null;
  viewer: { isTeacher: boolean; isStudent: boolean; canCreate: boolean };
}

/**
 * The subject page: who may see it — the offering's teacher, a student of its class, or anyone holding
 * `academic.timetable.read` through the class/school/organization (admins); everyone else gets NOT_FOUND. Work
 * items of the درس are listed by the workspace query with `offeringId` (each viewer sees their own inbox rows).
 */
export async function getOfferingPage(tx: Tx, ctx: TimetableCtx, offeringId: string, now = new Date()): Promise<OfferingPage> {
  const offering = await findOfferingFacts(tx, offeringId);
  if (!offering) throw notFound();
  const isTeacher = await teachesOffering(tx, ctx.personId, offeringId);
  const cls = await findStudentClass(tx, ctx.personId);
  const isStudent = cls !== null && cls.classGroupId === offering.classGroupId;
  if (!isTeacher && !isStudent && !(await can(tx, ctx, "academic.timetable.read", { scopeType: "class_offering", id: offeringId }))) throw notFound();
  const periods = (await listPeriodsOfSchools(tx, [offering.schoolId])).get(offering.schoolId) ?? [];
  const slots = await listOfferingSlots(tx, offeringId);
  const sessions: Session[] = slots.flatMap((s) => {
    const p = periods.find((x) => x.periodNo === s.periodNo);
    return p ? [{ ...s, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt }] : [];
  });
  const nextSession = nextSessionOf(sessions, periods, now);
  return {
    offering,
    sessions,
    nextSession,
    viewer: { isTeacher, isStudent, canCreate: isTeacher && canAtAnyScope(ctx.assignments, "workspace.work_item.create") },
  };
}
