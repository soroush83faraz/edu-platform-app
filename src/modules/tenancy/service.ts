// tenancy/service — the school structure: school (+ default branch), branch, academic year (+ terms), education
// level, grade level, subject, class group, class offering (→ main teacher through the academic service).
// Every function is `(tx, ctx, input)` inside the caller's tenant transaction; `organization_id` comes from ctx.
// Natural keys are pre-checked so the caller gets a Persian CONFLICT / field error instead of SQLSTATE 23505.
//
// `id?` on the create inputs exists for scripts/seed.ts (deterministic ids → re-runs update in place) and the
// importer; the admin actions never pass it (their Zod schemas are `.strict()` without `id`).
import { and, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { conflict, invalidReference, notFound, validation } from "@/lib/errors";
import { normalizeFa, toAsciiDigits } from "@/lib/normalize";
import { assignTeacher } from "@/modules/academic/service";
import {
  findBranchByName,
  findClassGroup,
  findClassGroupByName,
  findEducationLevelByCode,
  findGradeLevelByCode,
  findOffering,
  findSchoolByCode,
  findSchoolById,
  findSubjectByCode,
  findTermBySequence,
} from "./repo";
import { academicYear, branch, classGroup, classOffering, educationLevel, gradeLevel, school, subject, term } from "./schema";

export type ServiceCtx = AuditCtx & { orgId: string; personId: string };

const fieldError = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

/** `^[A-Za-z][A-Za-z0-9_-]{0,11}$` — the school code is also the prefix of generated usernames (`<code>-<number>`). */
export const SCHOOL_CODE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,11}$/;

export const MESSAGES = {
  /** Same text whether the id is unknown or belongs to another school — no cross-school existence oracle. */
  yearNotForBranch: "سال تحصیلی انتخاب‌شده برای این شعبه معتبر نیست.",
  termNotForClass: "نوبت انتخاب‌شده برای این کلاس معتبر نیست.",
  /** Case-insensitive: `G` and `g` would generate the same usernames. */
  schoolCodeTaken: "مدرسه‌ای با این کد (بدون توجه به بزرگی/کوچکی حروف) وجود دارد.",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// school + branch
// ---------------------------------------------------------------------------------------------------------------

export interface CreateSchoolInput {
  id?: string;
  branchId?: string;
  name: string;
  code: string;
  genderPolicy?: "girls" | "boys" | "mixed";
  isDefault?: boolean;
}

/** School + its default branch «مرکزی» in one go (every class needs a branch). */
export async function createSchool(tx: Tx, ctx: ServiceCtx, input: CreateSchoolInput): Promise<{ schoolId: string; branchId: string }> {
  const code = toAsciiDigits(input.code.trim());
  if (!SCHOOL_CODE_RE.test(code)) throw fieldError("code", "کد مدرسه باید با حرف انگلیسی شروع شود و حداکثر ۱۲ نویسهٴ انگلیسی/رقم باشد.");
  if (await findSchoolByCode(tx, code)) throw fieldError("code", MESSAGES.schoolCodeTaken);
  const [row] = await tx
    .insert(school)
    .values({
      ...(input.id ? { id: input.id } : {}),
      organizationId: ctx.orgId,
      name: normalizeFa(input.name),
      code,
      genderPolicy: input.genderPolicy ?? "mixed",
      isDefault: input.isDefault ?? false,
    })
    .returning({ id: school.id });
  const [br] = await tx
    .insert(branch)
    .values({ ...(input.branchId ? { id: input.branchId } : {}), organizationId: ctx.orgId, schoolId: row.id, name: "مرکزی", isDefault: true })
    .returning({ id: branch.id });
  await audit(ctx, "tenancy.school.created", { schema: "tenancy", table: "school", id: row.id }, null, { name: input.name, code, branchId: br.id }, tx);
  return { schoolId: row.id, branchId: br.id };
}

export interface UpdateSchoolInput {
  name?: string;
  genderPolicy?: "girls" | "boys" | "mixed";
  isDefault?: boolean;
}

export async function updateSchool(tx: Tx, ctx: ServiceCtx, schoolId: string, input: UpdateSchoolInput): Promise<void> {
  const before = await findSchoolById(tx, schoolId);
  if (!before) throw notFound();
  await tx
    .update(school)
    .set({
      ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}),
      ...(input.genderPolicy !== undefined ? { genderPolicy: input.genderPolicy } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    })
    .where(eq(school.id, schoolId));
  await audit(ctx, "tenancy.school.updated", { schema: "tenancy", table: "school", id: schoolId }, before, input, tx);
}

export interface CreateBranchInput {
  id?: string;
  schoolId: string;
  name: string;
  address?: string | null;
  isDefault?: boolean;
}

export async function createBranch(tx: Tx, ctx: ServiceCtx, input: CreateBranchInput): Promise<{ branchId: string }> {
  if (!(await findSchoolById(tx, input.schoolId))) throw invalidReference("مدرسه یافت نشد.");
  const name = normalizeFa(input.name);
  if (await findBranchByName(tx, input.schoolId, name)) throw fieldError("name", "شعبه‌ای با این نام در این مدرسه وجود دارد.");
  const [row] = await tx
    .insert(branch)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, schoolId: input.schoolId, name, address: input.address ?? null, isDefault: input.isDefault ?? false })
    .returning({ id: branch.id });
  await audit(ctx, "tenancy.branch.created", { schema: "tenancy", table: "branch", id: row.id }, null, { schoolId: input.schoolId, name }, tx);
  return { branchId: row.id };
}

export async function updateBranch(tx: Tx, ctx: ServiceCtx, branchId: string, input: { name?: string; address?: string | null; isDefault?: boolean }): Promise<void> {
  const [before] = await tx.select({ id: branch.id, name: branch.name, address: branch.address, isDefault: branch.isDefault }).from(branch).where(eq(branch.id, branchId)).limit(1);
  if (!before) throw notFound();
  await tx
    .update(branch)
    .set({
      ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    })
    .where(eq(branch.id, branchId));
  await audit(ctx, "tenancy.branch.updated", { schema: "tenancy", table: "branch", id: branchId }, before, input, tx);
}

// ---------------------------------------------------------------------------------------------------------------
// academic year + terms
// ---------------------------------------------------------------------------------------------------------------

export interface TermInput {
  id?: string;
  name: string;
  sequence: number;
  /** ISO `YYYY-MM-DD`. */
  startsOn: string;
  endsOn: string;
}

export interface CreateAcademicYearInput {
  id?: string;
  schoolId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent?: boolean;
  terms?: TermInput[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDateRange(startsOn: string, endsOn: string, field = "endsOn"): void {
  if (!ISO_DATE_RE.test(startsOn) || !ISO_DATE_RE.test(endsOn)) throw fieldError(field, "تاریخ نامعتبر است.");
  if (!(startsOn < endsOn)) throw fieldError(field, "تاریخ پایان باید بعد از تاریخ شروع باشد.");
}

/** `academic_year_current_uq` (one current year per school) surfaced as a Persian field error before the INSERT. */
async function assertNoOtherCurrentYear(tx: Tx, schoolId: string, exceptId?: string): Promise<void> {
  const rows = await tx
    .select({ id: academicYear.id, name: academicYear.name })
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, schoolId), eq(academicYear.isCurrent, true), exceptId ? ne(academicYear.id, exceptId) : undefined))
    .limit(1);
  if (rows[0]) throw fieldError("isCurrent", `سال «${rows[0].name}» هم‌اکنون سال جاری این مدرسه است؛ اول آن را از حالت جاری خارج کنید.`);
}

export async function createAcademicYear(tx: Tx, ctx: ServiceCtx, input: CreateAcademicYearInput): Promise<{ academicYearId: string; termIds: string[] }> {
  if (!(await findSchoolById(tx, input.schoolId))) throw invalidReference("مدرسه یافت نشد.");
  checkDateRange(input.startsOn, input.endsOn);
  if (input.isCurrent) await assertNoOtherCurrentYear(tx, input.schoolId);
  const [row] = await tx
    .insert(academicYear)
    .values({
      ...(input.id ? { id: input.id } : {}),
      organizationId: ctx.orgId,
      schoolId: input.schoolId,
      name: normalizeFa(input.name),
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: input.isCurrent ?? false,
    })
    .returning({ id: academicYear.id });
  const termIds: string[] = [];
  for (const t of input.terms ?? []) termIds.push((await upsertTerm(tx, ctx, { ...t, academicYearId: row.id })).termId);
  await audit(ctx, "tenancy.academic_year.created", { schema: "tenancy", table: "academic_year", id: row.id }, null, { schoolId: input.schoolId, name: input.name, termIds }, tx);
  return { academicYearId: row.id, termIds };
}

export interface UpdateAcademicYearInput {
  name?: string;
  startsOn?: string;
  endsOn?: string;
  isCurrent?: boolean;
}

export async function updateAcademicYear(tx: Tx, ctx: ServiceCtx, academicYearId: string, input: UpdateAcademicYearInput): Promise<void> {
  const [before] = await tx
    .select({ id: academicYear.id, schoolId: academicYear.schoolId, name: academicYear.name, startsOn: academicYear.startsOn, endsOn: academicYear.endsOn, isCurrent: academicYear.isCurrent })
    .from(academicYear)
    .where(eq(academicYear.id, academicYearId))
    .limit(1);
  if (!before) throw notFound();
  checkDateRange(input.startsOn ?? before.startsOn, input.endsOn ?? before.endsOn);
  if (input.isCurrent) await assertNoOtherCurrentYear(tx, before.schoolId, academicYearId);
  await tx
    .update(academicYear)
    .set({
      ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}),
      ...(input.startsOn !== undefined ? { startsOn: input.startsOn } : {}),
      ...(input.endsOn !== undefined ? { endsOn: input.endsOn } : {}),
      ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
    })
    .where(eq(academicYear.id, academicYearId));
  await audit(ctx, "tenancy.academic_year.updated", { schema: "tenancy", table: "academic_year", id: academicYearId }, before, input, tx);
}

/** Insert or update-in-place by `(academic_year_id, sequence)`. */
export async function upsertTerm(tx: Tx, ctx: ServiceCtx, input: TermInput & { academicYearId: string }): Promise<{ termId: string; created: boolean }> {
  checkDateRange(input.startsOn, input.endsOn);
  const name = normalizeFa(input.name);
  const existing = await findTermBySequence(tx, input.academicYearId, input.sequence);
  if (existing) {
    await tx.update(term).set({ name, startsOn: input.startsOn, endsOn: input.endsOn }).where(eq(term.id, existing.id));
    await audit(ctx, "tenancy.term.updated", { schema: "tenancy", table: "term", id: existing.id }, null, { name, startsOn: input.startsOn, endsOn: input.endsOn }, tx);
    return { termId: existing.id, created: false };
  }
  const [row] = await tx
    .insert(term)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, academicYearId: input.academicYearId, name, sequence: input.sequence, startsOn: input.startsOn, endsOn: input.endsOn })
    .returning({ id: term.id });
  await audit(ctx, "tenancy.term.created", { schema: "tenancy", table: "term", id: row.id }, null, { academicYearId: input.academicYearId, name, sequence: input.sequence }, tx);
  return { termId: row.id, created: true };
}

export async function deleteTerm(tx: Tx, ctx: ServiceCtx, termId: string): Promise<void> {
  const [before] = await tx.select({ id: term.id, name: term.name, academicYearId: term.academicYearId }).from(term).where(eq(term.id, termId)).limit(1);
  if (!before) throw notFound();
  const used = await tx.select({ id: classOffering.id }).from(classOffering).where(eq(classOffering.termId, termId)).limit(1);
  if (used[0]) throw conflict("این نوبت در ارائهٴ درس‌ها استفاده شده و حذف‌شدنی نیست.");
  await tx.delete(term).where(eq(term.id, termId));
  await audit(ctx, "tenancy.term.deleted", { schema: "tenancy", table: "term", id: termId }, before, null, tx);
}

// ---------------------------------------------------------------------------------------------------------------
// organization-level catalogs: education level, grade level, subject
// ---------------------------------------------------------------------------------------------------------------

const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

function cleanCode(code: string): string {
  const c = toAsciiDigits(code.trim()).toUpperCase();
  if (!CODE_RE.test(c)) throw fieldError("code", "کد فقط می‌تواند حرف انگلیسی، رقم، خط تیره و زیرخط باشد (حداکثر ۲۰ نویسه).");
  return c;
}

export interface CreateEducationLevelInput {
  id?: string;
  name: string;
  code: string;
  sequence: number;
}

export async function createEducationLevel(tx: Tx, ctx: ServiceCtx, input: CreateEducationLevelInput): Promise<{ educationLevelId: string }> {
  const code = cleanCode(input.code);
  if (await findEducationLevelByCode(tx, code)) throw fieldError("code", "مقطعی با این کد وجود دارد.");
  const [row] = await tx
    .insert(educationLevel)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, name: normalizeFa(input.name), code, sequence: input.sequence })
    .returning({ id: educationLevel.id });
  await audit(ctx, "tenancy.education_level.created", { schema: "tenancy", table: "education_level", id: row.id }, null, { name: input.name, code }, tx);
  return { educationLevelId: row.id };
}

export async function updateEducationLevel(tx: Tx, ctx: ServiceCtx, id: string, input: { name?: string; sequence?: number }): Promise<void> {
  const [before] = await tx.select({ id: educationLevel.id, name: educationLevel.name, sequence: educationLevel.sequence }).from(educationLevel).where(eq(educationLevel.id, id)).limit(1);
  if (!before) throw notFound();
  await tx
    .update(educationLevel)
    .set({ ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}), ...(input.sequence !== undefined ? { sequence: input.sequence } : {}) })
    .where(eq(educationLevel.id, id));
  await audit(ctx, "tenancy.education_level.updated", { schema: "tenancy", table: "education_level", id }, before, input, tx);
}

export interface CreateGradeLevelInput {
  id?: string;
  educationLevelId: string;
  name: string;
  code: string;
  sequence: number;
}

export async function createGradeLevel(tx: Tx, ctx: ServiceCtx, input: CreateGradeLevelInput): Promise<{ gradeLevelId: string }> {
  const code = cleanCode(input.code);
  if (await findGradeLevelByCode(tx, code)) throw fieldError("code", "پایه‌ای با این کد وجود دارد.");
  const level = await tx.select({ id: educationLevel.id }).from(educationLevel).where(eq(educationLevel.id, input.educationLevelId)).limit(1);
  if (!level[0]) throw invalidReference("مقطع یافت نشد.");
  const [row] = await tx
    .insert(gradeLevel)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, educationLevelId: input.educationLevelId, name: normalizeFa(input.name), code, sequence: input.sequence })
    .returning({ id: gradeLevel.id });
  await audit(ctx, "tenancy.grade_level.created", { schema: "tenancy", table: "grade_level", id: row.id }, null, { name: input.name, code, educationLevelId: input.educationLevelId }, tx);
  return { gradeLevelId: row.id };
}

export async function updateGradeLevel(tx: Tx, ctx: ServiceCtx, id: string, input: { name?: string; sequence?: number; educationLevelId?: string }): Promise<void> {
  const [before] = await tx
    .select({ id: gradeLevel.id, name: gradeLevel.name, sequence: gradeLevel.sequence, educationLevelId: gradeLevel.educationLevelId })
    .from(gradeLevel)
    .where(eq(gradeLevel.id, id))
    .limit(1);
  if (!before) throw notFound();
  await tx
    .update(gradeLevel)
    .set({
      ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}),
      ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
      ...(input.educationLevelId !== undefined ? { educationLevelId: input.educationLevelId } : {}),
    })
    .where(eq(gradeLevel.id, id));
  await audit(ctx, "tenancy.grade_level.updated", { schema: "tenancy", table: "grade_level", id }, before, input, tx);
}

export interface CreateSubjectInput {
  id?: string;
  name: string;
  code: string;
}

export async function createSubject(tx: Tx, ctx: ServiceCtx, input: CreateSubjectInput): Promise<{ subjectId: string }> {
  const code = cleanCode(input.code);
  if (await findSubjectByCode(tx, code)) throw fieldError("code", "درسی با این کد وجود دارد.");
  const [row] = await tx
    .insert(subject)
    .values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.orgId, name: normalizeFa(input.name), code })
    .returning({ id: subject.id });
  await audit(ctx, "tenancy.subject.created", { schema: "tenancy", table: "subject", id: row.id }, null, { name: input.name, code }, tx);
  return { subjectId: row.id };
}

export async function updateSubject(tx: Tx, ctx: ServiceCtx, id: string, input: { name?: string }): Promise<void> {
  const [before] = await tx.select({ id: subject.id, name: subject.name }).from(subject).where(eq(subject.id, id)).limit(1);
  if (!before) throw notFound();
  await tx
    .update(subject)
    .set({ ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}) })
    .where(eq(subject.id, id));
  await audit(ctx, "tenancy.subject.updated", { schema: "tenancy", table: "subject", id }, before, input, tx);
}

// ---------------------------------------------------------------------------------------------------------------
// class group + class offering
// ---------------------------------------------------------------------------------------------------------------

export interface CreateClassGroupInput {
  id?: string;
  branchId: string;
  academicYearId: string;
  gradeLevelId: string;
  name: string;
  capacity?: number | null;
}

/** Natural key `(academic_year_id, branch_id, name)`; the branch and the year must belong to the same school. */
export async function createClassGroup(tx: Tx, ctx: ServiceCtx, input: CreateClassGroupInput): Promise<{ classGroupId: string }> {
  const name = normalizeFa(input.name);
  const [br] = await tx.select({ schoolId: branch.schoolId }).from(branch).where(eq(branch.id, input.branchId)).limit(1);
  if (!br) throw invalidReference("شعبه یافت نشد.");
  // One message for "unknown year" and "year of another school": the id must not act as an existence oracle.
  const [yr] = await tx.select({ schoolId: academicYear.schoolId }).from(academicYear).where(eq(academicYear.id, input.academicYearId)).limit(1);
  if (!yr || br.schoolId !== yr.schoolId) throw fieldError("academicYearId", MESSAGES.yearNotForBranch);
  const [gr] = await tx.select({ id: gradeLevel.id }).from(gradeLevel).where(eq(gradeLevel.id, input.gradeLevelId)).limit(1);
  if (!gr) throw invalidReference("پایه یافت نشد.");
  if (await findClassGroupByName(tx, input.academicYearId, input.branchId, name)) throw fieldError("name", "کلاسی با این نام در این سال و شعبه وجود دارد.");
  const [row] = await tx
    .insert(classGroup)
    .values({
      ...(input.id ? { id: input.id } : {}),
      organizationId: ctx.orgId,
      branchId: input.branchId,
      academicYearId: input.academicYearId,
      gradeLevelId: input.gradeLevelId,
      name,
      capacity: input.capacity ?? null,
    })
    .returning({ id: classGroup.id });
  await audit(ctx, "tenancy.class_group.created", { schema: "tenancy", table: "class_group", id: row.id }, null, { ...input, id: row.id, name }, tx);
  return { classGroupId: row.id };
}

export interface UpdateClassGroupInput {
  name?: string;
  gradeLevelId?: string;
  capacity?: number | null;
  homeroomStaffId?: string | null;
  status?: "active" | "archived";
}

export async function updateClassGroup(tx: Tx, ctx: ServiceCtx, classGroupId: string, input: UpdateClassGroupInput): Promise<void> {
  const before = await findClassGroup(tx, classGroupId);
  if (!before) throw notFound();
  if (input.name !== undefined) {
    const name = normalizeFa(input.name);
    const dup = await findClassGroupByName(tx, before.academicYearId, before.branchId, name);
    if (dup && dup.id !== classGroupId) throw fieldError("name", "کلاسی با این نام در این سال و شعبه وجود دارد.");
  }
  await tx
    .update(classGroup)
    .set({
      ...(input.name !== undefined ? { name: normalizeFa(input.name) } : {}),
      ...(input.gradeLevelId !== undefined ? { gradeLevelId: input.gradeLevelId } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.homeroomStaffId !== undefined ? { homeroomStaffId: input.homeroomStaffId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .where(eq(classGroup.id, classGroupId));
  await audit(ctx, "tenancy.class_group.updated", { schema: "tenancy", table: "class_group", id: classGroupId }, before, input, tx);
}

export interface CreateClassOfferingInput {
  id?: string;
  classGroupId: string;
  subjectId: string;
  termId: string;
  weeklyHours?: number | null;
  /** Main teacher — goes through `assignTeacher` (teacher_assignment + derived `teacher` role). */
  mainTeacherStaffProfileId?: string | null;
  status?: "planned" | "active" | "closed";
}

export interface CreateClassOfferingResult {
  classOfferingId: string;
  teacherAssignmentId: string | null;
}

/** Natural key `(class_group_id, subject_id, term_id)`; the term must belong to the class's academic year. */
export async function createClassOffering(tx: Tx, ctx: ServiceCtx, input: CreateClassOfferingInput): Promise<CreateClassOfferingResult> {
  const cg = await findClassGroup(tx, input.classGroupId);
  if (!cg) throw invalidReference("کلاس یافت نشد.");
  // One message for "unknown term" and "term of another year/school" (no existence oracle).
  const [t] = await tx.select({ academicYearId: term.academicYearId }).from(term).where(eq(term.id, input.termId)).limit(1);
  if (!t || t.academicYearId !== cg.academicYearId) throw fieldError("termId", MESSAGES.termNotForClass);
  const [s] = await tx.select({ id: subject.id }).from(subject).where(eq(subject.id, input.subjectId)).limit(1);
  if (!s) throw invalidReference("درس یافت نشد.");
  if (await findOffering(tx, input.classGroupId, input.subjectId, input.termId)) throw fieldError("subjectId", "این درس در این نوبت برای این کلاس ثبت شده است.");
  const [row] = await tx
    .insert(classOffering)
    .values({
      ...(input.id ? { id: input.id } : {}),
      organizationId: ctx.orgId,
      classGroupId: input.classGroupId,
      subjectId: input.subjectId,
      termId: input.termId,
      weeklyHours: input.weeklyHours != null ? String(input.weeklyHours) : null,
      status: input.status ?? "active",
    })
    .returning({ id: classOffering.id });
  await audit(
    ctx,
    "tenancy.class_offering.created",
    { schema: "tenancy", table: "class_offering", id: row.id },
    null,
    { classGroupId: input.classGroupId, subjectId: input.subjectId, termId: input.termId },
    tx,
  );
  let teacherAssignmentId: string | null = null;
  if (input.mainTeacherStaffProfileId) {
    const res = await assignTeacher(tx, ctx, { staffProfileId: input.mainTeacherStaffProfileId, classOfferingId: row.id, role: "main" });
    teacherAssignmentId = res.teacherAssignmentId;
  }
  return { classOfferingId: row.id, teacherAssignmentId };
}

export async function updateClassOffering(tx: Tx, ctx: ServiceCtx, classOfferingId: string, input: { weeklyHours?: number | null; status?: "planned" | "active" | "closed" }): Promise<void> {
  const [before] = await tx
    .select({ id: classOffering.id, weeklyHours: classOffering.weeklyHours, status: classOffering.status })
    .from(classOffering)
    .where(eq(classOffering.id, classOfferingId))
    .limit(1);
  if (!before) throw notFound();
  await tx
    .update(classOffering)
    .set({
      ...(input.weeklyHours !== undefined ? { weeklyHours: input.weeklyHours != null ? String(input.weeklyHours) : null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .where(eq(classOffering.id, classOfferingId));
  await audit(ctx, "tenancy.class_offering.updated", { schema: "tenancy", table: "class_offering", id: classOfferingId }, before, input, tx);
}

/** Row counts used by the seed CLI and tests (tenant-bound tx). */
export async function structureCounts(tx: Tx): Promise<Record<string, number>> {
  const one = async (table: string): Promise<number> => {
    const res = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
    return res.rows[0].n;
  };
  return {
    school: await one("tenancy.school"),
    branch: await one("tenancy.branch"),
    academicYear: await one("tenancy.academic_year"),
    term: await one("tenancy.term"),
    gradeLevel: await one("tenancy.grade_level"),
    subject: await one("tenancy.subject"),
    classGroup: await one("tenancy.class_group"),
    classOffering: await one("tenancy.class_offering"),
  };
}
