// «افزودن تدریس» on a colleague's page (/admin/people/[id], owner 2026-09-27: «when the manager taps a staff member
// they should be able to make them teach a subject»). The per-class door (/admin/classes/[id]/offerings) stays; this
// is the same write from the person's side and goes through the SAME services and the SAME permissions:
//   - teaching an existing offering = `academic.teacher_assignment.write` at the offering's school; a new main
//     teacher replaces the current one exactly like the offerings form does (endTeacherAssignment → assignTeacher),
//     but only after the manager confirmed the replacement (`replaceMain`);
//   - teaching a درس the class does not have yet first DEFINES the offering (class × subject × the class year's
//     current نوبت) — structure, `tenancy.structure.write` at the class's school, `createClassOffering` — then assigns.
// Scope (docs/admin.md «قانون دامنه»): the colleague must be in the caller's admin scope (`requirePersonInScope`, the
// rule that shows the person page at all) and the class in one of the caller's schools; outside = NOT_FOUND, never a
// hint. Audit rows are written by the services, inside the caller's transaction.
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { conflict, forbidden, notFound, validation } from "@/lib/errors";
import { assignTeacher, endTeacherAssignment, type TeacherRole } from "@/modules/academic/service";
import { teacherAssignment } from "@/modules/academic/schema";
import { can } from "@/modules/iam/can";
import { person, staffProfile, studentProfile } from "@/modules/iam/schema";
import { assertSchoolInScope, getAdminScope, requirePersonInScope, type AdminScope } from "@/modules/iam/service";
import { findClassGroup } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering, gradeLevel, school, subject, term } from "@/modules/tenancy/schema";
import { createClassOffering } from "@/modules/tenancy/service";
import type { ResourceCtx } from "./defineResource";
import { TEACHING_MESSAGES } from "./labels";
import { RESOURCE_MESSAGES } from "./resources";

export { TEACHING_MESSAGES };

/** The نوبت a new offering goes to: the one containing today, else the first of the year (the shell bar's rule). */
async function currentTermOf(tx: Tx, academicYearId: string): Promise<string | null> {
  const [t] = await tx
    .select({ id: term.id })
    .from(term)
    .where(eq(term.academicYearId, academicYearId))
    .orderBy(sql`(${term.startsOn} <= current_date and ${term.endsOn} >= current_date) desc`, asc(term.sequence))
    .limit(1);
  return t?.id ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// read: what the «افزودن تدریس» dialog offers
// ---------------------------------------------------------------------------------------------------------------

export interface TeachingOffering {
  id: string;
  subjectId: string;
  subjectName: string;
  termId: string;
  termName: string;
  mainTeacher: { staffProfileId: string; name: string } | null;
}

export interface TeachingClassOption {
  value: string;
  label: string;
  group?: string;
  /** The نوبت a NEW offering of this class is created in; null = the year has no نوبت (no new درس offered). */
  currentTermId: string | null;
  /** Offerings of the class that are not closed. */
  offerings: TeachingOffering[];
  /** The caller may DEFINE offerings at this class's school (`tenancy.structure.write`) — else only existing ones are offered. */
  canCreateOffering: boolean;
}

export interface TeachingFormOptions {
  classes: TeachingClassOption[];
  /** The organization's درس catalog (top-level, as the offerings form lists it). */
  subjects: Array<{ value: string; label: string }>;
}

/** Active classes of the CURRENT year in the caller's schools, each with its open offerings and their main teacher. */
export async function teachingFormOptions(tx: Tx, ctx: ResourceCtx, scope: AdminScope): Promise<TeachingFormOptions> {
  const classes = await tx
    .select({ id: classGroup.id, name: classGroup.name, gradeName: gradeLevel.name, schoolId: school.id, schoolName: school.name, academicYearId: classGroup.academicYearId })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .innerJoin(school, eq(school.id, branch.schoolId))
    .innerJoin(gradeLevel, eq(gradeLevel.id, classGroup.gradeLevelId))
    .innerJoin(academicYear, eq(academicYear.id, classGroup.academicYearId))
    .where(and(eq(classGroup.status, "active"), eq(academicYear.isCurrent, true), scope.kind === "organization" ? undefined : inArray(school.id, scope.schoolIds)))
    .orderBy(asc(school.name), asc(gradeLevel.sequence), asc(classGroup.name));
  const classIds = classes.map((c) => c.id);
  const yearIds = [...new Set(classes.map((c) => c.academicYearId))];
  const offerings = classIds.length
    ? await tx
        .select({
          id: classOffering.id,
          classGroupId: classOffering.classGroupId,
          subjectId: classOffering.subjectId,
          subjectName: subject.name,
          termId: classOffering.termId,
          termName: term.name,
          teacherStaffProfileId: teacherAssignment.staffProfileId,
          teacherName: sql<string | null>`case when ${person.id} is null then null else ${person.firstName} || ' ' || ${person.lastName} end`,
        })
        .from(classOffering)
        .innerJoin(subject, eq(subject.id, classOffering.subjectId))
        .innerJoin(term, eq(term.id, classOffering.termId))
        .leftJoin(teacherAssignment, and(eq(teacherAssignment.classOfferingId, classOffering.id), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)))
        .leftJoin(staffProfile, eq(staffProfile.id, teacherAssignment.staffProfileId))
        .leftJoin(person, eq(person.id, staffProfile.personId))
        .where(and(inArray(classOffering.classGroupId, classIds), ne(classOffering.status, "closed")))
        .orderBy(asc(term.sequence), asc(subject.name))
    : [];
  const currentTerm = new Map<string, string | null>();
  for (const y of yearIds) currentTerm.set(y, await currentTermOf(tx, y));
  const subjects = await tx.select({ id: subject.id, name: subject.name }).from(subject).where(isNull(subject.parentSubjectId)).orderBy(asc(subject.name));
  const schoolIds = [...new Set(classes.map((c) => c.schoolId))];
  // «درس تازه» is structure: offered where the caller may define offerings (the action re-checks at the class's school).
  const canCreate = new Map<string, boolean>();
  for (const id of schoolIds) canCreate.set(id, await can(tx, ctx, "tenancy.structure.write", { scopeType: "school", id }));
  const many = schoolIds.length > 1;
  return {
    classes: classes.map((c) => ({
      value: c.id,
      label: `${c.name} (${c.gradeName})`,
      ...(many ? { group: c.schoolName } : {}),
      currentTermId: currentTerm.get(c.academicYearId) ?? null,
      offerings: offerings
        .filter((o) => o.classGroupId === c.id)
        .map((o) => ({
          id: o.id,
          subjectId: o.subjectId,
          subjectName: o.subjectName,
          termId: o.termId,
          termName: o.termName,
          mainTeacher: o.teacherStaffProfileId && o.teacherName ? { staffProfileId: o.teacherStaffProfileId, name: o.teacherName } : null,
        })),
      canCreateOffering: canCreate.get(c.schoolId) ?? false,
    })),
    subjects: subjects.map((s) => ({ value: s.id, label: s.name })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------------------------------------------

export interface AssignTeachingInput {
  personId: string;
  classGroupId: string;
  /** An existing offering of that class … */
  classOfferingId?: string;
  /** … or a درس the class does not have yet in its current نوبت (a new offering is defined first). */
  subjectId?: string;
  role: TeacherRole;
  /** The manager confirmed replacing the offering's current main teacher. */
  replaceMain: boolean;
}

export interface AssignTeachingResult {
  classOfferingId: string;
  teacherAssignmentId: string;
  offeringCreated: boolean;
  replacedTeacherAssignmentId: string | null;
}

const fieldError = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

/**
 * Order (no existence oracle): admin scope → person in scope (NOT_FOUND) → an active colleague (VALIDATION) → class
 * in scope (NOT_FOUND) → `academic.teacher_assignment.write` at the class's school (FORBIDDEN) → a current-year active
 * class (VALIDATION) → the offering: one of THIS class (NOT_FOUND) or, for a new درس, `tenancy.structure.write`
 * (FORBIDDEN) + `createClassOffering` in the current نوبت → the colleague does not teach that offering yet (CONFLICT) →
 * the role: a main teacher already there is replaced only with `replaceMain` (CONFLICT otherwise), exactly as the
 * offerings form swaps it.
 */
export async function assignTeaching(tx: Tx, ctx: ResourceCtx, input: AssignTeachingInput): Promise<AssignTeachingResult> {
  const scope = await getAdminScope(tx, ctx);
  await requirePersonInScope(tx, scope, input.personId);
  const [staff] = await tx
    .select({ id: staffProfile.id, leftOn: staffProfile.leftOn, personStatus: person.status })
    .from(staffProfile)
    .innerJoin(person, eq(person.id, staffProfile.personId))
    .where(eq(staffProfile.personId, input.personId))
    .limit(1);
  const [student] = await tx.select({ id: studentProfile.id }).from(studentProfile).where(eq(studentProfile.personId, input.personId)).limit(1);
  if (!staff || student || staff.leftOn || staff.personStatus !== "active") throw fieldError("personId", TEACHING_MESSAGES.notStaff);

  const cg = await findClassGroup(tx, input.classGroupId);
  if (!cg) throw notFound();
  assertSchoolInScope(scope, cg.schoolId);
  const atSchool = { scopeType: "school", id: cg.schoolId } as const;
  if (!(await can(tx, ctx, "academic.teacher_assignment.write", atSchool))) throw forbidden(RESOURCE_MESSAGES.teacherAssignForbidden);
  const [year] = await tx.select({ isCurrent: academicYear.isCurrent }).from(academicYear).where(eq(academicYear.id, cg.academicYearId)).limit(1);
  if (cg.status !== "active" || !year?.isCurrent) throw fieldError("classGroupId", TEACHING_MESSAGES.classNotCurrent);

  let classOfferingId: string;
  let offeringCreated = false;
  if (input.classOfferingId && !input.subjectId) {
    const [o] = await tx
      .select({ id: classOffering.id })
      .from(classOffering)
      .where(and(eq(classOffering.id, input.classOfferingId), eq(classOffering.classGroupId, cg.id)))
      .limit(1);
    if (!o) throw notFound();
    classOfferingId = o.id;
  } else if (input.subjectId && !input.classOfferingId) {
    if (!(await can(tx, ctx, "tenancy.structure.write", atSchool))) throw forbidden(RESOURCE_MESSAGES.offeringCreateForbidden);
    const termId = await currentTermOf(tx, cg.academicYearId);
    if (!termId) throw fieldError("subjectId", TEACHING_MESSAGES.noTerm);
    const res = await createClassOffering(tx, ctx, { classGroupId: cg.id, subjectId: input.subjectId, termId, status: "active" });
    classOfferingId = res.classOfferingId;
    offeringCreated = true;
  } else {
    throw fieldError("subjectId", TEACHING_MESSAGES.pickSubject);
  }

  // One active teaching per colleague and offering, whatever the role: the derived `teacher` role_assignment is unique
  // per (person, role, offering), so a second role on the same offering would fail in the database instead.
  const [own] = await tx
    .select({ id: teacherAssignment.id })
    .from(teacherAssignment)
    .where(and(eq(teacherAssignment.classOfferingId, classOfferingId), eq(teacherAssignment.staffProfileId, staff.id), isNull(teacherAssignment.validTo)))
    .limit(1);
  if (own) throw conflict(TEACHING_MESSAGES.alreadyTeaches);

  let replacedTeacherAssignmentId: string | null = null;
  if (input.role === "main") {
    const [current] = await tx
      .select({ id: teacherAssignment.id })
      .from(teacherAssignment)
      .where(and(eq(teacherAssignment.classOfferingId, classOfferingId), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)))
      .limit(1);
    if (current) {
      if (!input.replaceMain) throw conflict(TEACHING_MESSAGES.mainTaken);
      await endTeacherAssignment(tx, ctx, { teacherAssignmentId: current.id });
      replacedTeacherAssignmentId = current.id;
    }
  }
  const res = await assignTeacher(tx, ctx, { staffProfileId: staff.id, classOfferingId, role: input.role });
  return { classOfferingId, teacherAssignmentId: res.teacherAssignmentId, offeringCreated, replacedTeacherAssignmentId };
}
