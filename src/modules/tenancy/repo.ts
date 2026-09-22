// tenancy queries. Every function takes a tenant-bound `tx` (RLS filters the organization); "school of X" lookups
// are what the admin scope rule (`getAdminScope` in iam/service) checks against before any structure mutation.
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { normalizeTime } from "@/lib/timetable";
import { academicYear, branch, classGroup, classOffering, educationLevel, gradeLevel, school, schoolPeriod, subject, term } from "./schema";

export interface SchoolRow {
  id: string;
  name: string;
  code: string;
  genderPolicy: string | null;
  isDefault: boolean;
}

const schoolColumns = { id: school.id, name: school.name, code: school.code, genderPolicy: school.genderPolicy, isDefault: school.isDefault };

export async function findSchoolById(tx: Tx, id: string): Promise<SchoolRow | null> {
  const rows = await tx.select(schoolColumns).from(school).where(eq(school.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Case-insensitive (`school_org_code_ci_uq`): the code is the lower-cased prefix of generated usernames. */
export async function findSchoolByCode(tx: Tx, code: string): Promise<SchoolRow | null> {
  const rows = await tx.select(schoolColumns).from(school).where(sql`lower(${school.code}) = lower(${code})`).limit(1);
  return rows[0] ?? null;
}

export async function listSchools(tx: Tx): Promise<SchoolRow[]> {
  return tx.select(schoolColumns).from(school).orderBy(desc(school.isDefault), asc(school.name));
}

/** The default branch of a school, else its oldest one. */
export async function findDefaultBranch(tx: Tx, schoolId: string): Promise<{ id: string; name: string } | null> {
  const rows = await tx
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(eq(branch.schoolId, schoolId))
    .orderBy(desc(branch.isDefault), asc(branch.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findBranchByName(tx: Tx, schoolId: string, name: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: branch.id }).from(branch).where(and(eq(branch.schoolId, schoolId), eq(branch.name, name))).limit(1);
  return rows[0] ?? null;
}

export async function schoolIdOfBranch(tx: Tx, branchId: string): Promise<string | null> {
  const rows = await tx.select({ schoolId: branch.schoolId }).from(branch).where(eq(branch.id, branchId)).limit(1);
  return rows[0]?.schoolId ?? null;
}

export async function schoolIdOfAcademicYear(tx: Tx, academicYearId: string): Promise<string | null> {
  const rows = await tx.select({ schoolId: academicYear.schoolId }).from(academicYear).where(eq(academicYear.id, academicYearId)).limit(1);
  return rows[0]?.schoolId ?? null;
}

export async function schoolIdOfTerm(tx: Tx, termId: string): Promise<string | null> {
  const rows = await tx
    .select({ schoolId: academicYear.schoolId })
    .from(term)
    .innerJoin(academicYear, eq(academicYear.id, term.academicYearId))
    .where(eq(term.id, termId))
    .limit(1);
  return rows[0]?.schoolId ?? null;
}

export interface ClassGroupFacts {
  id: string;
  name: string;
  branchId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevelId: string;
  status: string;
}

export async function findClassGroup(tx: Tx, classGroupId: string): Promise<ClassGroupFacts | null> {
  const rows = await tx
    .select({
      id: classGroup.id,
      name: classGroup.name,
      branchId: classGroup.branchId,
      schoolId: branch.schoolId,
      academicYearId: classGroup.academicYearId,
      gradeLevelId: classGroup.gradeLevelId,
      status: classGroup.status,
    })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .where(eq(classGroup.id, classGroupId))
    .limit(1);
  return rows[0] ?? null;
}

export async function schoolIdOfClassGroup(tx: Tx, classGroupId: string): Promise<string | null> {
  return (await findClassGroup(tx, classGroupId))?.schoolId ?? null;
}

export async function schoolIdOfClassOffering(tx: Tx, classOfferingId: string): Promise<string | null> {
  const rows = await tx
    .select({ schoolId: branch.schoolId })
    .from(classOffering)
    .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .where(eq(classOffering.id, classOfferingId))
    .limit(1);
  return rows[0]?.schoolId ?? null;
}

export async function findClassGroupByName(tx: Tx, academicYearId: string, branchId: string, name: string): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: classGroup.id })
    .from(classGroup)
    .where(and(eq(classGroup.academicYearId, academicYearId), eq(classGroup.branchId, branchId), eq(classGroup.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCurrentAcademicYear(tx: Tx, schoolId: string): Promise<{ id: string; name: string } | null> {
  const rows = await tx
    .select({ id: academicYear.id, name: academicYear.name })
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, schoolId), eq(academicYear.isCurrent, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAcademicYearByName(tx: Tx, schoolId: string, name: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: academicYear.id }).from(academicYear).where(and(eq(academicYear.schoolId, schoolId), eq(academicYear.name, name))).limit(1);
  return rows[0] ?? null;
}

export async function listTerms(tx: Tx, academicYearId: string): Promise<Array<{ id: string; name: string; sequence: number; startsOn: string; endsOn: string }>> {
  return tx
    .select({ id: term.id, name: term.name, sequence: term.sequence, startsOn: term.startsOn, endsOn: term.endsOn })
    .from(term)
    .where(eq(term.academicYearId, academicYearId))
    .orderBy(asc(term.sequence));
}

export async function findTermBySequence(tx: Tx, academicYearId: string, sequence: number): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: term.id }).from(term).where(and(eq(term.academicYearId, academicYearId), eq(term.sequence, sequence))).limit(1);
  return rows[0] ?? null;
}

/** The term containing today, else the first term of the year. */
export async function findCurrentTerm(tx: Tx, academicYearId: string): Promise<{ id: string; name: string } | null> {
  const terms = await listTerms(tx, academicYearId);
  if (terms.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const now = terms.find((t) => t.startsOn <= today && today <= t.endsOn);
  return now ?? terms[0];
}

export async function findEducationLevelByCode(tx: Tx, code: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: educationLevel.id }).from(educationLevel).where(eq(educationLevel.code, code)).limit(1);
  return rows[0] ?? null;
}

export interface GradeRow {
  id: string;
  name: string;
  code: string;
  educationLevelId: string;
}

export async function listGradeLevels(tx: Tx): Promise<GradeRow[]> {
  return tx
    .select({ id: gradeLevel.id, name: gradeLevel.name, code: gradeLevel.code, educationLevelId: gradeLevel.educationLevelId })
    .from(gradeLevel)
    .orderBy(asc(gradeLevel.sequence), asc(gradeLevel.name));
}

export async function findGradeLevelByCode(tx: Tx, code: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: gradeLevel.id }).from(gradeLevel).where(eq(gradeLevel.code, code)).limit(1);
  return rows[0] ?? null;
}

export interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

export async function listSubjects(tx: Tx): Promise<SubjectRow[]> {
  return tx.select({ id: subject.id, name: subject.name, code: subject.code }).from(subject).where(isNull(subject.parentSubjectId)).orderBy(asc(subject.name));
}

export async function findSubjectByCode(tx: Tx, code: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: subject.id }).from(subject).where(eq(subject.code, code)).limit(1);
  return rows[0] ?? null;
}

export async function findOffering(tx: Tx, classGroupId: string, subjectId: string, termId: string): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: classOffering.id })
    .from(classOffering)
    .where(and(eq(classOffering.classGroupId, classGroupId), eq(classOffering.subjectId, subjectId), eq(classOffering.termId, termId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface SchoolPeriodRow {
  id: string;
  periodNo: number;
  label: string;
  /** `HH:mm`. */
  startsAt: string;
  endsAt: string;
}

/** The bell schedule of a school, in period order; times normalized to `HH:mm`. */
export async function listSchoolPeriods(tx: Tx, schoolId: string): Promise<SchoolPeriodRow[]> {
  const rows = await tx
    .select({ id: schoolPeriod.id, periodNo: schoolPeriod.periodNo, label: schoolPeriod.label, startsAt: schoolPeriod.startsAt, endsAt: schoolPeriod.endsAt })
    .from(schoolPeriod)
    .where(eq(schoolPeriod.schoolId, schoolId))
    .orderBy(asc(schoolPeriod.periodNo));
  return rows.map((r) => ({ ...r, startsAt: normalizeTime(r.startsAt), endsAt: normalizeTime(r.endsAt) }));
}
