// The structure resources of /admin: school → subject → class group → class offering. Each one maps a strict Zod
// input onto the tenancy services; lists read under RLS and filter by the caller's admin scope (school-owned rows) —
// the organization's درس‌ها are read-only for school-scoped admins (`orgOnly`). مقطع‌ها, پایه‌ها and سال‌های تحصیلی
// (+ نوبت‌ها) are a FIXED catalog since 2026-09-27 (src/modules/tenancy/fixed-catalog.ts, written by the catalog
// seed and by `ensureCatalogYears` when a school is created): they have no resource, no form and no route.
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/actions";
import { forbidden, notFound, validation } from "@/lib/errors";
import { formatNumberFa } from "@/lib/format";
import { assignTeacher, endTeacherAssignment } from "@/modules/academic/service";
import { classEnrollment, teacherAssignment } from "@/modules/academic/schema";
import { can, isOrganizationAdmin, type Assignment } from "@/modules/iam/can";
import { person, staffProfile } from "@/modules/iam/schema";
import { assertSchoolInScope, isInScope, requireStaffAssignable, staffAssignableSql, type AdminScope } from "@/modules/iam/service";
import { findClassGroup, listSchools, listTerms, schoolIdOfAcademicYear, schoolIdOfBranch, schoolIdOfClassOffering, schoolIdOfTerm } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering, educationLevel, gradeLevel, school, subject, term } from "@/modules/tenancy/schema";
import {
  createClassGroup,
  createClassOffering,
  createSchool,
  createSubject,
  deleteSubject,
  ensureCatalogYears,
  updateClassGroup,
  updateClassOffering,
  updateSchool,
  updateSubject,
} from "@/modules/tenancy/service";
import { seesSchoolCode } from "./school-code";
import { defineResource, type AnyResourceDef, type FormField, type ListOptions, type SelectOption } from "./defineResource";
import { adminSectionsFor, type AdminNavItem } from "./nav";

// ---------------------------------------------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------------------------------------------

const uuid = z.uuid("شناسه نامعتبر است.");
/** A reference picked in a `<select>` that may be empty («انتخاب کنید…» → `""`/null → undefined); the handler names the missing field. */
const optionalRef = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
/**
 * A reference picked in a REQUIRED `<select>` that is on the form in both modes: an empty choice («انتخاب کنید…»
 * sends `""`) is reported as «<label> را انتخاب کنید.» under that field instead of the generic «شناسه نامعتبر است.»
 * (QA round 2: a class saved without a grade). Create-only references keep `optionalRef` + a named message in `create`.
 */
const requiredRef = (label: string) => z.string(`${label} را انتخاب کنید.`).min(1, `${label} را انتخاب کنید.`).pipe(uuid);
/** The message a required reference reports when nothing is picked — one wording everywhere (also used by `create`). */
export const pickMessage = (label: string) => `${label} را انتخاب کنید.`;
const name = (label: string) => z.string().trim().min(1, `${label} را وارد کنید.`).max(120, `${label} حداکثر ۱۲۰ نویسه است.`);
const code = z.string().trim().min(1, "کد را وارد کنید.").max(20, "کد حداکثر ۲۰ نویسه است.");
/** Optional integer field (`null` = empty). Every failure has its own Persian message — nothing falls through to Zod's default text. */
const optionalInt = (min: number, max: number, label: string) =>
  z
    .number(`${label} باید عدد باشد.`)
    .int(`${label} باید عدد صحیح باشد.`)
    .min(min, `${label} دست‌کم ${formatNumberFa(min)} است.`)
    .max(max, `${label} حداکثر ${formatNumberFa(max)} است.`)
    .nullable()
    .optional();

/** `app.fa_norm(col) ILIKE %fa_norm(q)%` — the same normalization the person search uses. */
function faLike(column: SQL | { name: string }, q: string): SQL | undefined {
  const trimmed = q.trim();
  if (!trimmed) return undefined;
  return sql`app.fa_norm(${column}) ilike '%' || app.fa_norm(${trimmed}) || '%'`;
}

function scopeSchoolIds(scope: AdminScope): SQL | undefined {
  return scope.kind === "organization" ? undefined : inArray(school.id, scope.schoolIds);
}

function requireOrgScope(scope: AdminScope): void {
  if (scope.kind !== "organization") throw notFound();
}

export const RESOURCE_MESSAGES = {
  offeringCreateForbidden: "تعریف ارائهٴ درس جدید فقط با مدیر و معاون مدرسه یا مدیر سازمان است.",
  offeringStructureForbidden: "تغییر ساعت یا وضعیت ارائهٴ درس فقط با مدیر و معاون مدرسه یا مدیر سازمان است.",
  teacherAssignForbidden: "شما اجازهٴ تعیین دبیر در این مدرسه را ندارید.",
} as const;

export const GENDER_LABELS: Record<string, string> = { girls: "دخترانه", boys: "پسرانه", mixed: "مختلط" };
const GENDER_OPTIONS: SelectOption[] = [
  { value: "girls", label: "دخترانه" },
  { value: "boys", label: "پسرانه" },
  { value: "mixed", label: "مختلط" },
];

function paginate(opts: ListOptions): { limit: number; offset: number } {
  return { limit: opts.pageSize, offset: (Math.max(1, opts.page) - 1) * opts.pageSize };
}

// ---------------------------------------------------------------------------------------------------------------
// school
// ---------------------------------------------------------------------------------------------------------------

interface SchoolRow {
  id: string;
  name: string;
  /** Only in an organization admin's rows (`seesSchoolCode`): a principal's list never carries it. */
  code?: string;
  genderPolicy: string | null;
  isDefault: boolean;
}

const SchoolInput = z
  .object({
    name: name("نام مدرسه"),
    code: code.optional(),
    genderPolicy: z.enum(["girls", "boys", "mixed"], "جنسیت را انتخاب کنید."),
    isDefault: z.boolean().default(false),
  })
  .strict();

/**
 * Owner's rule: ONLY the organization admin creates schools (`createNeedsOrgScope` — the action refuses a principal
 * with FORBIDDEN before the form data is read, the list page hides «مدرسهٴ جدید», and `create` below is NOT_FOUND
 * for a school scope as a second line). Principals edit their own schools' details (`update`, scope-checked).
 * There is no archive for schools in phase 1; when one is added it must be organization-only too.
 */
export const schoolResource = defineResource<SchoolRow, z.output<typeof SchoolInput>>({
  key: "schools",
  labelFa: "مدرسه",
  labelFaPlural: "مدرسه‌ها",
  descriptionFa: "روی هر مدرسه بزنید تا وارد صفحهٴ مدیریت همان مدرسه شوید.",
  orgDescriptionFa: "کد مدرسه پیشوند نام‌کاربری دانش‌آموزان بدون موبایل است. روی هر مدرسه بزنید تا وارد صفحهٴ مدیریت همان مدرسه شوید.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  createNeedsOrgScope: true,
  columns: [
    { key: "name", labelFa: "نام" },
    { key: "code", labelFa: "کد", render: (r) => <bdi dir="ltr">{r.code}</bdi>, mobileMeta: 1, orgOnly: true },
    { key: "genderPolicy", labelFa: "جنسیت", render: (r) => GENDER_LABELS[r.genderPolicy ?? ""] ?? "—", secondary: true, mobileMeta: 2 },
    { key: "isDefault", labelFa: "پیش‌فرض", render: (r) => (r.isDefault ? "✓" : ""), secondary: true, mobileMeta: 1 },
  ],
  schema: SchoolInput,
  formFields: [
    { name: "name", labelFa: "نام مدرسه", type: "text", required: true, placeholder: "دبیرستان دخترانهٴ دانش" },
    { name: "code", labelFa: "کد (انگلیسی)", type: "text", required: true, createOnly: true, ltr: true, placeholder: "G", hint: "با حرف انگلیسی شروع شود؛ بعداً تغییر نمی‌کند." },
    { name: "genderPolicy", labelFa: "جنسیت", type: "select", options: GENDER_OPTIONS, required: true },
    { name: "isDefault", labelFa: "مدرسهٴ پیش‌فرض سازمان", type: "toggle" },
  ],
  /** The school's own page: the management hub where its کلاس‌ها, کارکنان, دانش‌آموزان and زنگ‌بندی are managed. */
  rowHref: (r) => `/admin/schools/${r.id}`,
  /** The organization's درس‌ها live one step under «مدرسه‌ها» since «تنظیمات زیرساختی» is gone (owner, 2026-09-27). */
  links: [{ href: "/admin/subjects", labelFa: "درس‌ها", orgOnly: true }],
  async list(tx, _ctx, scope, opts) {
    const where = and(scopeSchoolIds(scope), faLike(school.name, opts.q));
    // The code is selected for the organization admin only — a principal's rows never carry it (owner, 2026-09-27).
    const rows: SchoolRow[] = await tx
      .select({ id: school.id, name: school.name, genderPolicy: school.genderPolicy, isDefault: school.isDefault, ...(seesSchoolCode(scope) ? { code: school.code } : {}) })
      .from(school)
      .where(where)
      .orderBy(desc(school.isDefault), asc(school.name))
      .limit(paginate(opts).limit)
      .offset(paginate(opts).offset);
    const [{ n }] = await tx.select({ n: count() }).from(school).where(where);
    return { rows, total: n };
  },
  async create(tx, ctx, scope, input) {
    requireOrgScope(scope);
    if (!input.code) throw validation({ fieldErrors: { code: ["کد مدرسه را وارد کنید."] } }, "کد مدرسه را وارد کنید.");
    const res = await createSchool(tx, ctx, { name: input.name, code: input.code, genderPolicy: input.genderPolicy, isDefault: input.isDefault });
    // Years are a fixed catalog now (no year form anywhere): the new school starts with ۱۴۰۵-۱۴۰۶ (current) and ۱۴۰۶-۱۴۰۷.
    await ensureCatalogYears(tx, ctx, res.schoolId);
    return { id: res.schoolId };
  },
  /** Explicit fields: `code` is never changed here — by anyone, and never by a crafted request from a principal. */
  async update(tx, ctx, scope, id, input) {
    assertSchoolInScope(scope, id);
    await updateSchool(tx, ctx, id, { name: input.name, genderPolicy: input.genderPolicy, isDefault: input.isDefault });
  },
});

// ---------------------------------------------------------------------------------------------------------------
// subject (organization catalog; the fixed مقطع/پایه/سال catalog has no resource — src/modules/tenancy/fixed-catalog.ts)
// ---------------------------------------------------------------------------------------------------------------

interface SubjectRow {
  id: string;
  name: string;
  code: string;
  offerings: number;
}

const SubjectInput = z.object({ name: name("نام درس"), code: code.optional() }).strict();

export const subjectResource = defineResource<SubjectRow, z.output<typeof SubjectInput>>({
  key: "subjects",
  labelFa: "درس",
  labelFaPlural: "درس‌ها",
  descriptionFa: "فهرست درس‌های سازمان؛ در هر کلاس، «ارائهٴ درس» یک درس را به یک نوبت و یک دبیر وصل می‌کند.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  orgOnly: true,
  /** Reached from «مدرسه‌ها» (its «درس‌ها» link), so that is its way back. */
  back: { href: "/admin/schools", labelFa: "مدرسه‌ها" },
  columns: [
    { key: "name", labelFa: "نام" },
    { key: "code", labelFa: "کد", render: (r) => <bdi dir="ltr">{r.code}</bdi>, secondary: true, mobileMeta: 2 },
    { key: "offerings", labelFa: "ارائه‌ها", render: (r) => `${formatNumberFa(r.offerings)} ارائه`, mobileMeta: 1 },
  ],
  schema: SubjectInput,
  formFields: [
    { name: "name", labelFa: "نام درس", type: "text", required: true, placeholder: "ریاضی" },
    { name: "code", labelFa: "کد (انگلیسی)", type: "text", required: true, createOnly: true, ltr: true, placeholder: "MATH" },
  ],
  async list(tx, _ctx, _scope, opts) {
    const where = and(isNull(subject.parentSubjectId), faLike(subject.name, opts.q));
    const rows = await tx
      .select({ id: subject.id, name: subject.name, code: subject.code, offerings: count(classOffering.id) })
      .from(subject)
      .leftJoin(classOffering, eq(classOffering.subjectId, subject.id))
      .where(where)
      .groupBy(subject.id)
      .orderBy(asc(subject.name))
      .limit(paginate(opts).limit)
      .offset(paginate(opts).offset);
    const [{ n }] = await tx.select({ n: count() }).from(subject).where(where);
    return { rows, total: n };
  },
  async create(tx, ctx, scope, input) {
    requireOrgScope(scope);
    if (!input.code) throw validation({ fieldErrors: { code: ["کد را وارد کنید."] } }, "کد را وارد کنید.");
    return { id: (await createSubject(tx, ctx, { name: input.name, code: input.code })).subjectId };
  },
  async update(tx, ctx, scope, id, input) {
    requireOrgScope(scope);
    await updateSubject(tx, ctx, id, { name: input.name });
  },
  archive: {
    labelFa: "حذف",
    confirmFa: "این درس حذف شود؟ (فقط وقتی در ارائهٴ درسی استفاده نشده)",
    async run(tx, ctx, scope, id) {
      requireOrgScope(scope);
      await deleteSubject(tx, ctx, id);
    },
  },
});

// ---------------------------------------------------------------------------------------------------------------
// class group
// ---------------------------------------------------------------------------------------------------------------

export interface ClassRow {
  id: string;
  name: string;
  branchId: string;
  academicYearId: string;
  gradeLevelId: string;
  schoolName: string;
  branchName: string;
  yearName: string;
  gradeName: string;
  /** How many branches the school has — the class header names the branch only when there is more than one. */
  schoolBranches: number;
  capacity: number | null;
  status: string;
  students: number;
}

const ClassInput = z
  .object({
    branchId: optionalRef,
    academicYearId: optionalRef,
    gradeLevelId: requiredRef("پایه"),
    name: name("نام کلاس"),
    capacity: optionalInt(1, 200, "ظرفیت"),
  })
  .strict();

/**
 * The pickers of the class form. A class belongs to a SCHOOL (the branch is an internal, always-one-per-school
 * detail — the UI never mentions it): the `schools` picker carries one option per school, labelled with the
 * school's name, and its VALUE is that school's default branch id (what `class_group.branch_id` stores). Years
 * carry the school as a group heading when the scope holds more than one school. A required picker left with a
 * single option is not a choice — `ResourceForm` hides it and sends the value.
 */
export async function classOptions(tx: Tx, scope: AdminScope): Promise<Record<string, SelectOption[]>> {
  const schools = (await listSchools(tx)).filter((s) => isInScope(scope, s.id));
  const ids = schools.map((s) => s.id);
  if (ids.length === 0) return { schools: [], years: [], grades: [] };
  const branches = await tx
    .select({ id: branch.id, schoolId: branch.schoolId, isDefault: branch.isDefault })
    .from(branch)
    .where(inArray(branch.schoolId, ids))
    .orderBy(desc(branch.isDefault), asc(branch.name));
  const years = await tx
    .select({ id: academicYear.id, name: academicYear.name, schoolId: academicYear.schoolId, isCurrent: academicYear.isCurrent })
    .from(academicYear)
    .where(inArray(academicYear.schoolId, ids))
    .orderBy(desc(academicYear.isCurrent), desc(academicYear.startsOn));
  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "";
  const many = schools.length > 1;
  const defaultBranchOf = (schoolId: string) => branches.find((b) => b.schoolId === schoolId && b.isDefault) ?? branches.find((b) => b.schoolId === schoolId);
  return {
    schools: schools.flatMap((s) => {
      const b = defaultBranchOf(s.id);
      return b ? [{ value: b.id, label: s.name }] : [];
    }),
    years: years.map((y) => ({ value: y.id, label: `${y.name}${y.isCurrent ? " (جاری)" : ""}`, group: many ? schoolName(y.schoolId) : undefined })),
    grades: await gradeOptions(tx),
  };
}

/**
 * The پایه picker (native `<select>`): the organization's پایه‌ها in school order — اول … دوازدهم — each under its
 * مقطع as an `<optgroup>` («دبستان», «متوسطهٴ اول», «متوسطهٴ دوم»). After the catalog seed these are exactly the
 * twelve fixed grades; an extra row an organization had before the catalog is kept (never deleted) and still
 * listed under its مقطع, so a class that uses it keeps a valid choice.
 */
export async function gradeOptions(tx: Tx): Promise<SelectOption[]> {
  const rows = await tx
    .select({ id: gradeLevel.id, name: gradeLevel.name, levelName: educationLevel.name })
    .from(gradeLevel)
    .innerJoin(educationLevel, eq(educationLevel.id, gradeLevel.educationLevelId))
    .orderBy(asc(educationLevel.sequence), asc(gradeLevel.sequence), asc(gradeLevel.name));
  return rows.map((g) => ({ value: g.id, label: g.name, group: g.levelName }));
}

/** The field that says WHICH SCHOOL a class lives in (its VALUE is the school's default branch id — `class_group.branch_id`). */
const CLASS_LOCATION_FIELD = {
  schools: { name: "branchId", labelFa: "مدرسه", type: "select", optionsKey: "schools", required: true, createOnly: true },
} as const satisfies Record<string, FormField>;

const CLASS_FIELDS: FormField[] = [
  { name: "academicYearId", labelFa: "سال تحصیلی", type: "select", optionsKey: "years", required: true, createOnly: true },
  { name: "gradeLevelId", labelFa: "پایه", type: "select", optionsKey: "grades", required: true },
  { name: "name", labelFa: "نام کلاس", type: "text", required: true, placeholder: "۱۰/۳" },
  { name: "capacity", labelFa: "ظرفیت", type: "number", numeric: true },
];

export const classResource = defineResource<ClassRow, z.output<typeof ClassInput>>({
  key: "classes",
  labelFa: "کلاس",
  labelFaPlural: "کلاس‌ها",
  descriptionFa: "کلاس = پایه + نام در یک سال تحصیلی از یک مدرسه. روی هر کلاس: دانش‌آموزان و ارائهٴ درس‌ها.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  columns: [
    { key: "name", labelFa: "کلاس" },
    { key: "gradeName", labelFa: "پایه", mobileMeta: 1 },
    // Only the school: the branch is one per school in phase 1 («— کارگر» repeated on every row said nothing).
    { key: "schoolName", labelFa: "مدرسه", secondary: true, mobileMeta: 2 },
    { key: "yearName", labelFa: "سال", secondary: true, mobileMeta: 2 },
    { key: "students", labelFa: "دانش‌آموز", render: (r) => `${formatNumberFa(r.students)} دانش‌آموز`, mobileMeta: 1 },
    { key: "status", labelFa: "وضعیت", render: (r) => (r.status === "active" ? "فعال" : "بایگانی"), secondary: true },
  ],
  schema: ClassInput,
  formFields: [CLASS_LOCATION_FIELD.schools, ...CLASS_FIELDS],
  formFieldsFor: () => [CLASS_LOCATION_FIELD.schools, ...CLASS_FIELDS],
  formValues: (r) => ({ branchId: r.branchId, academicYearId: r.academicYearId, gradeLevelId: r.gradeLevelId, name: r.name, capacity: r.capacity }),
  rowHref: (r) => `/admin/classes/${r.id}`,
  loadOptions: (tx, _ctx, scope) => classOptions(tx, scope),
  list: (tx, _ctx, scope, opts) => listClassRows(tx, scope, opts),
  async create(tx, ctx, scope, input) {
    if (!input.branchId || !input.academicYearId) {
      const fieldErrors: Record<string, string[]> = {};
      if (!input.branchId) fieldErrors.branchId = [pickMessage("مدرسه")];
      if (!input.academicYearId) fieldErrors.academicYearId = [pickMessage("سال تحصیلی")];
      throw validation({ fieldErrors }, fieldErrors.branchId?.[0] ?? fieldErrors.academicYearId[0]);
    }
    assertSchoolInScope(scope, await schoolIdOfBranch(tx, input.branchId));
    // The year is checked against the scope as well: an unknown id and another school's year look the same (NOT_FOUND).
    assertSchoolInScope(scope, await schoolIdOfAcademicYear(tx, input.academicYearId));
    const res = await createClassGroup(tx, ctx, { branchId: input.branchId, academicYearId: input.academicYearId, gradeLevelId: input.gradeLevelId, name: input.name, capacity: input.capacity ?? null });
    return { id: res.classGroupId };
  },
  async update(tx, ctx, scope, id, input) {
    const cg = await findClassGroup(tx, id);
    if (!cg) throw notFound();
    assertSchoolInScope(scope, cg.schoolId);
    await updateClassGroup(tx, ctx, id, { name: input.name, gradeLevelId: input.gradeLevelId, capacity: input.capacity ?? null });
  },
  archive: {
    labelFa: "بایگانی",
    confirmFa: "این کلاس بایگانی شود؟ ثبت‌نام‌های فعال آن باید قبلاً به کلاس دیگری منتقل شده باشند.",
    async run(tx, ctx, scope, id) {
      const cg = await findClassGroup(tx, id);
      if (!cg) throw notFound();
      assertSchoolInScope(scope, cg.schoolId);
      const [{ n }] = await tx.select({ n: count() }).from(classEnrollment).where(and(eq(classEnrollment.classGroupId, id), eq(classEnrollment.status, "active")));
      if (n > 0) throw validation(undefined, `این کلاس ${formatNumberFa(n)} دانش‌آموز فعال دارد؛ اول آن‌ها را منتقل کنید.`);
      await updateClassGroup(tx, ctx, id, { status: "archived" });
    },
  },
});

export async function listClassRows(tx: Tx, scope: AdminScope, opts: Partial<ListOptions> & { schoolId?: string; includeArchived?: boolean; ids?: string[] }): Promise<{ rows: ClassRow[]; total: number }> {
  const where = and(
    scopeSchoolIds(scope),
    opts.schoolId ? eq(school.id, opts.schoolId) : undefined,
    opts.includeArchived ? undefined : eq(classGroup.status, "active"),
    opts.ids ? inArray(classGroup.id, opts.ids) : undefined,
    faLike(classGroup.name, opts.q ?? ""),
  );
  const base = tx
    .select({
      id: classGroup.id,
      name: classGroup.name,
      branchId: classGroup.branchId,
      academicYearId: classGroup.academicYearId,
      gradeLevelId: classGroup.gradeLevelId,
      schoolName: school.name,
      branchName: branch.name,
      yearName: academicYear.name,
      gradeName: gradeLevel.name,
      schoolBranches: sql<number>`(select count(*)::int from tenancy.branch b2 where b2.school_id = ${school.id})`,
      capacity: classGroup.capacity,
      status: classGroup.status,
      students: sql<number>`(select count(*)::int from academic.class_enrollment ce where ce.class_group_id = ${classGroup.id} and ce.status = 'active')`,
    })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .innerJoin(school, eq(school.id, branch.schoolId))
    .innerJoin(academicYear, eq(academicYear.id, classGroup.academicYearId))
    .innerJoin(gradeLevel, eq(gradeLevel.id, classGroup.gradeLevelId))
    .where(where)
    .orderBy(asc(school.name), desc(academicYear.isCurrent), asc(gradeLevel.sequence), asc(classGroup.name));
  const rows = opts.pageSize ? await base.limit(opts.pageSize).offset((Math.max(1, opts.page ?? 1) - 1) * opts.pageSize) : await base;
  const [{ n }] = await tx
    .select({ n: count() })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .innerJoin(school, eq(school.id, branch.schoolId))
    .where(where);
  return { rows, total: n };
}

// ---------------------------------------------------------------------------------------------------------------
// class offering (nested under a class: /admin/classes/[id]/offerings → resource key `offerings`, parent = class)
// ---------------------------------------------------------------------------------------------------------------

export interface OfferingRow {
  id: string;
  subjectId: string;
  subjectName: string;
  termId: string;
  termName: string;
  weeklyHours: string | null;
  status: string;
  mainTeacherStaffProfileId: string | null;
  teacherName: string | null;
}

/**
 * `subjectId` / `termId` are `createOnly` form fields: the edit form never sends them (natural keys), so they are
 * optional here and `create` demands them itself (a required-on-update key was the QA-round-1 blocker: the form
 * dropped them, the strict schema failed on fields nobody could see, and «ذخیره» did nothing).
 */
const OfferingInput = z
  .object({
    classGroupId: uuid,
    subjectId: optionalRef,
    termId: optionalRef,
    mainTeacherStaffProfileId: uuid.nullable().optional(),
    weeklyHours: z.number("ساعت در هفته باید عدد باشد.").min(0, "ساعت در هفته نمی‌تواند منفی باشد.").max(40, "ساعت هفتگی حداکثر ۴۰ است.").nullable().optional(),
    status: z.enum(["planned", "active", "closed"], "وضعیت را انتخاب کنید."),
  })
  .strict();

const OFFERING_FIELD_MESSAGES = { subjectId: pickMessage("درس"), termId: pickMessage("نوبت") } as const;

const OFFERING_STATUS: Record<string, string> = { active: "فعال", planned: "برنامه‌ریزی‌شده", closed: "پایان‌یافته" };

/**
 * Staff a caller may pick as a teacher: everyone for an organization admin; for a school-scoped admin only staff
 * anchored in (or already teaching at) their schools — `staffAssignableSql`, the same predicate the mutation checks.
 */
export async function staffOptions(tx: Tx, scope: AdminScope): Promise<SelectOption[]> {
  const rows = await tx
    .select({ id: staffProfile.id, firstName: person.firstName, lastName: person.lastName })
    .from(staffProfile)
    .innerJoin(person, eq(person.id, staffProfile.personId))
    .where(and(eq(person.status, "active"), isNull(staffProfile.leftOn), staffAssignableSql(scope, "iam.staff_profile.id", "iam.staff_profile.person_id")))
    .orderBy(asc(person.lastName), asc(person.firstName));
  return rows.map((r) => ({ value: r.id, label: `${r.firstName} ${r.lastName}` }));
}

/**
 * Two permissions on one form (owner's matrix, docs/admin.md): defining an offering (`create`) and changing its
 * hours/status are STRUCTURE (`tenancy.structure.write` — organization admin, principal, vice principal); setting,
 * changing or removing the main teacher of an EXISTING offering is `academic.teacher_assignment.write`. Every seeded
 * manager holds both (the vice principal matches the principal since 2026-09-27); the split still stands for a
 * holder of the teacher permission alone. Both are checked at the offering's school with `can()`, after the scope
 * rule (NOT_FOUND first).
 */
export const offeringResource = defineResource<OfferingRow, z.output<typeof OfferingInput>>({
  key: "offerings",
  labelFa: "ارائهٴ درس",
  labelFaPlural: "ارائهٴ درس‌ها",
  descriptionFa: "درس × نوبت × دبیر اصلی. تخصیص دبیر همین‌جا نقش «معلم» را برای همان کلاس‌درس می‌سازد.",
  permission: { read: "tenancy.structure.read", write: "academic.teacher_assignment.write", create: "tenancy.structure.write" },
  parentParam: { name: "class", field: "classGroupId", labelFa: "کلاس", backHref: (parent) => `/admin/classes/${parent}` },
  columns: [
    { key: "subjectName", labelFa: "درس" },
    { key: "termName", labelFa: "نوبت", secondary: true, mobileMeta: 2 },
    { key: "teacherName", labelFa: "دبیر", render: (r) => r.teacherName ?? <span className="text-warning-text">بدون دبیر</span>, mobileMeta: 1 },
    { key: "weeklyHours", labelFa: "ساعت/هفته", render: (r) => (r.weeklyHours ? `${formatNumberFa(Number(r.weeklyHours))} ساعت در هفته` : "—"), secondary: true, mobileMeta: 2 },
    { key: "status", labelFa: "وضعیت", render: (r) => OFFERING_STATUS[r.status] ?? r.status, secondary: true },
  ],
  schema: OfferingInput,
  formFields: [
    { name: "subjectId", labelFa: "درس", type: "select", optionsKey: "subjects", required: true, createOnly: true },
    { name: "termId", labelFa: "نوبت", type: "select", optionsKey: "terms", required: true, createOnly: true },
    { name: "mainTeacherStaffProfileId", labelFa: "دبیر اصلی", type: "select", optionsKey: "staff", hint: "می‌توانید بعداً تعیین یا تغییر دهید." },
    { name: "weeklyHours", labelFa: "ساعت در هفته", type: "number", numeric: true },
    { name: "status", labelFa: "وضعیت", type: "select", required: true, options: Object.entries(OFFERING_STATUS).map(([value, label]) => ({ value, label })) },
  ],
  formValues: (r) => ({ subjectId: r.subjectId, termId: r.termId, mainTeacherStaffProfileId: r.mainTeacherStaffProfileId, weeklyHours: r.weeklyHours ? Number(r.weeklyHours) : null, status: r.status }),
  async loadOptions(tx, _ctx, scope, parent) {
    if (!parent) return { subjects: [], terms: [], staff: [] };
    const cg = await findClassGroup(tx, parent);
    if (!cg) throw notFound();
    assertSchoolInScope(scope, cg.schoolId);
    const subjects = await tx.select({ id: subject.id, name: subject.name }).from(subject).where(isNull(subject.parentSubjectId)).orderBy(asc(subject.name));
    const terms = await listTerms(tx, cg.academicYearId);
    return {
      subjects: subjects.map((s) => ({ value: s.id, label: s.name })),
      terms: terms.map((t) => ({ value: t.id, label: t.name })),
      staff: await staffOptions(tx, scope),
    };
  },
  list: (tx, _ctx, scope, opts) => listOfferingRows(tx, scope, opts.parent ?? ""),
  async create(tx, ctx, scope, input) {
    const cg = await findClassGroup(tx, input.classGroupId);
    if (!cg) throw notFound();
    assertSchoolInScope(scope, cg.schoolId);
    // Structure: a holder of teacher_assignment.write alone may not define offerings — FORBIDDEN for a class they can see.
    if (!(await can(tx, ctx, "tenancy.structure.write", { scopeType: "school", id: cg.schoolId }))) throw forbidden(RESOURCE_MESSAGES.offeringCreateForbidden);
    const missing = (["subjectId", "termId"] as const).filter((k) => !input[k]);
    if (missing.length > 0 || !input.subjectId || !input.termId) {
      throw validation({ fieldErrors: Object.fromEntries(missing.map((k) => [k, [OFFERING_FIELD_MESSAGES[k]]])) }, OFFERING_FIELD_MESSAGES[missing[0] ?? "subjectId"]);
    }
    // Unknown term and another school's term are both NOT_FOUND (no existence oracle); the service then checks the year.
    assertSchoolInScope(scope, await schoolIdOfTerm(tx, input.termId));
    // A school admin may only hand a class to staff anchored in / already teaching at their schools (scope widening).
    if (input.mainTeacherStaffProfileId) await requireStaffAssignable(tx, scope, input.mainTeacherStaffProfileId);
    const res = await createClassOffering(tx, ctx, {
      classGroupId: input.classGroupId,
      subjectId: input.subjectId,
      termId: input.termId,
      weeklyHours: input.weeklyHours ?? null,
      mainTeacherStaffProfileId: input.mainTeacherStaffProfileId ?? null,
      status: input.status,
    });
    return { id: res.classOfferingId };
  },
  async update(tx, ctx, scope, id, input) {
    const schoolId = await schoolIdOfClassOffering(tx, id);
    assertSchoolInScope(scope, schoolId);
    if (!schoolId) throw notFound();
    const school = { scopeType: "school", id: schoolId } as const;
    const [before] = await tx.select({ weeklyHours: classOffering.weeklyHours, status: classOffering.status }).from(classOffering).where(eq(classOffering.id, id)).limit(1);
    if (!before) throw notFound();
    // The form always resubmits hours + status; only a CHANGE to them is a structure edit (a teacher-only editor leaves them as they are).
    const weeklyHours = input.weeklyHours ?? null;
    if (weeklyHours !== (before.weeklyHours === null ? null : Number(before.weeklyHours)) || input.status !== before.status) {
      if (!(await can(tx, ctx, "tenancy.structure.write", school))) throw forbidden(RESOURCE_MESSAGES.offeringStructureForbidden);
      await updateClassOffering(tx, ctx, id, { weeklyHours, status: input.status });
    }
    const [current] = await tx
      .select({ id: teacherAssignment.id, staffProfileId: teacherAssignment.staffProfileId })
      .from(teacherAssignment)
      .where(and(eq(teacherAssignment.classOfferingId, id), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)))
      .limit(1);
    const next = input.mainTeacherStaffProfileId ?? null;
    if ((current?.staffProfileId ?? null) === next) return;
    if (!(await can(tx, ctx, "academic.teacher_assignment.write", school))) throw forbidden(RESOURCE_MESSAGES.teacherAssignForbidden);
    // A school admin may only hand a class to staff anchored in / already teaching at their schools (scope widening).
    if (next) await requireStaffAssignable(tx, scope, next);
    if (current) await endTeacherAssignment(tx, ctx, { teacherAssignmentId: current.id });
    if (next) await assignTeacher(tx, ctx, { staffProfileId: next, classOfferingId: id, role: "main" });
  },
});

export async function listOfferingRows(tx: Tx, scope: AdminScope, classGroupId: string): Promise<{ rows: OfferingRow[]; total: number }> {
  if (!classGroupId) return { rows: [], total: 0 };
  const cg = await findClassGroup(tx, classGroupId);
  if (!cg) throw notFound();
  assertSchoolInScope(scope, cg.schoolId);
  const rows = await tx
    .select({
      id: classOffering.id,
      subjectId: classOffering.subjectId,
      subjectName: subject.name,
      termId: classOffering.termId,
      termName: term.name,
      weeklyHours: classOffering.weeklyHours,
      status: classOffering.status,
      mainTeacherStaffProfileId: teacherAssignment.staffProfileId,
      teacherName: sql<string | null>`case when ${person.id} is null then null else ${person.firstName} || ' ' || ${person.lastName} end`,
    })
    .from(classOffering)
    .innerJoin(subject, eq(subject.id, classOffering.subjectId))
    .innerJoin(term, eq(term.id, classOffering.termId))
    .leftJoin(teacherAssignment, and(eq(teacherAssignment.classOfferingId, classOffering.id), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)))
    .leftJoin(staffProfile, eq(staffProfile.id, teacherAssignment.staffProfileId))
    .leftJoin(person, eq(person.id, staffProfile.personId))
    .where(eq(classOffering.classGroupId, classGroupId))
    .orderBy(asc(term.sequence), asc(subject.name));
  return { rows, total: rows.length };
}

// ---------------------------------------------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------------------------------------------

export const RESOURCES: Record<string, AnyResourceDef> = Object.fromEntries(
  [schoolResource, subjectResource, classResource, offeringResource].map((r) => [r.key, r]),
);

export const RESOURCE_KEYS = Object.keys(RESOURCES) as [string, ...string[]];

/** The admin sections live in `./nav` (pure, shared with the client nav); `ADMIN_NAV` keeps the old name for callers and tests. */
export { ADMIN_SECTIONS as ADMIN_NAV, type AdminNavItem } from "./nav";

/** The sub-navigation a caller sees: school-scoped admins (principal, vice principal) lose the organization-only entries. */
export function adminNavFor(assignments: readonly Assignment[]): AdminNavItem[] {
  return adminSectionsFor({ org: isOrganizationAdmin(assignments) });
}
