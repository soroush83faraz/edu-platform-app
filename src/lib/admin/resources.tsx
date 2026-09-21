// The structure resources of /admin, in onboarding order: school → branch → academic year (+ terms) → education
// level → grade level → subject → class group → class offering. Each one maps a strict Zod input onto the
// tenancy services; lists read under RLS and filter by the caller's admin scope (school-owned rows) — org-level
// catalogs are read-only for school-scoped admins (`orgOnly`).
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/actions";
import { forbidden, notFound, validation } from "@/lib/errors";
import { formatNumberFa, isoDateToJalali, jalaliToIsoDate } from "@/lib/format";
import { assignTeacher, endTeacherAssignment } from "@/modules/academic/service";
import { classEnrollment, teacherAssignment } from "@/modules/academic/schema";
import { can } from "@/modules/iam/can";
import { person, staffProfile } from "@/modules/iam/schema";
import { assertSchoolInScope, isInScope, requireStaffAssignable, staffAssignableSql, type AdminScope } from "@/modules/iam/service";
import { findClassGroup, listSchools, listTerms, schoolIdOfAcademicYear, schoolIdOfBranch, schoolIdOfClassOffering, schoolIdOfTerm } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering, educationLevel, gradeLevel, school, subject, term } from "@/modules/tenancy/schema";
import {
  createAcademicYear,
  createBranch,
  createClassGroup,
  createClassOffering,
  createEducationLevel,
  createGradeLevel,
  createSchool,
  createSubject,
  deleteTerm,
  updateAcademicYear,
  updateBranch,
  updateClassGroup,
  updateClassOffering,
  updateEducationLevel,
  updateGradeLevel,
  updateSchool,
  updateSubject,
  upsertTerm,
} from "@/modules/tenancy/service";
import { defineResource, type AnyResourceDef, type ListOptions, type SelectOption } from "./defineResource";

// ---------------------------------------------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------------------------------------------

const uuid = z.uuid("شناسه نامعتبر است.");
/** A reference picked in a `<select>` that may be empty («انتخاب کنید…» → `""`/null → undefined); the handler names the missing field. */
const optionalRef = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
const name = (label: string) => z.string().trim().min(1, `${label} را وارد کنید.`).max(120, `${label} حداکثر ۱۲۰ نویسه است.`);
const code = z.string().trim().min(1, "کد را وارد کنید.").max(20, "کد حداکثر ۲۰ نویسه است.");
const jalaliDate = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} را وارد کنید.`)
    .transform((v, c) => {
      const iso = jalaliToIsoDate(v);
      if (!iso) {
        c.addIssue({ code: "custom", message: "تاریخ نامعتبر است؛ مثال: ۱۴۰۵/۰۷/۰۱" });
        return z.NEVER;
      }
      return iso;
    });
const sequence = z.number("ترتیب باید عدد باشد.").int("ترتیب باید عدد صحیح باشد.").min(1, "ترتیب از ۱ شروع می‌شود.").max(99, "ترتیب حداکثر ۹۹ است.");
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
  offeringCreateForbidden: "تعریف ارائهٴ درس جدید فقط با مدیر مدرسه یا مدیر سازمان است.",
  offeringStructureForbidden: "تغییر ساعت یا وضعیت ارائهٴ درس فقط با مدیر مدرسه یا مدیر سازمان است.",
  teacherAssignForbidden: "شما اجازهٴ تعیین دبیر در این مدرسه را ندارید.",
} as const;

const GENDER_LABELS: Record<string, string> = { girls: "دخترانه", boys: "پسرانه", mixed: "مختلط" };
const GENDER_OPTIONS: SelectOption[] = [
  { value: "girls", label: "دخترانه" },
  { value: "boys", label: "پسرانه" },
  { value: "mixed", label: "مختلط" },
];

function paginate(opts: ListOptions): { limit: number; offset: number } {
  return { limit: opts.pageSize, offset: (Math.max(1, opts.page) - 1) * opts.pageSize };
}

async function schoolOptions(tx: Tx, scope: AdminScope): Promise<SelectOption[]> {
  const rows = await listSchools(tx);
  return rows.filter((s) => isInScope(scope, s.id)).map((s) => ({ value: s.id, label: s.name }));
}

// ---------------------------------------------------------------------------------------------------------------
// school
// ---------------------------------------------------------------------------------------------------------------

interface SchoolRow {
  id: string;
  name: string;
  code: string;
  genderPolicy: string | null;
  isDefault: boolean;
  branches: number;
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
  descriptionFa: "هر مدرسه یک شعبهٴ پیش‌فرض «مرکزی» دارد؛ کد مدرسه پیشوند نام‌کاربری دانش‌آموزان بدون موبایل است.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  createNeedsOrgScope: true,
  columns: [
    { key: "name", labelFa: "نام" },
    { key: "code", labelFa: "کد", render: (r) => <bdi dir="ltr">{r.code}</bdi> },
    { key: "genderPolicy", labelFa: "جنسیت", render: (r) => GENDER_LABELS[r.genderPolicy ?? ""] ?? "—", secondary: true },
    { key: "branches", labelFa: "شعبه", render: (r) => formatNumberFa(r.branches), secondary: true },
    { key: "isDefault", labelFa: "پیش‌فرض", render: (r) => (r.isDefault ? "✓" : ""), secondary: true },
  ],
  schema: SchoolInput,
  formFields: [
    { name: "name", labelFa: "نام مدرسه", type: "text", required: true, placeholder: "دبیرستان دخترانهٴ دانش" },
    { name: "code", labelFa: "کد (انگلیسی)", type: "text", required: true, createOnly: true, ltr: true, placeholder: "G", hint: "با حرف انگلیسی شروع شود؛ بعداً تغییر نمی‌کند." },
    { name: "genderPolicy", labelFa: "جنسیت", type: "select", options: GENDER_OPTIONS, required: true },
    { name: "isDefault", labelFa: "مدرسهٴ پیش‌فرض سازمان", type: "toggle" },
  ],
  links: [{ href: "/admin/branches", labelFa: "شعبه‌ها" }],
  async list(tx, _ctx, scope, opts) {
    const where = and(scopeSchoolIds(scope), faLike(school.name, opts.q));
    const rows = await tx
      .select({ id: school.id, name: school.name, code: school.code, genderPolicy: school.genderPolicy, isDefault: school.isDefault, branches: count(branch.id) })
      .from(school)
      .leftJoin(branch, eq(branch.schoolId, school.id))
      .where(where)
      .groupBy(school.id)
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
    return { id: res.schoolId };
  },
  async update(tx, ctx, scope, id, input) {
    assertSchoolInScope(scope, id);
    await updateSchool(tx, ctx, id, { name: input.name, genderPolicy: input.genderPolicy, isDefault: input.isDefault });
  },
});

// ---------------------------------------------------------------------------------------------------------------
// branch
// ---------------------------------------------------------------------------------------------------------------

interface BranchRow {
  id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  address: string | null;
  isDefault: boolean;
}

const BranchInput = z
  .object({
    schoolId: optionalRef,
    name: name("نام شعبه"),
    address: z.string().trim().max(300, "نشانی حداکثر ۳۰۰ نویسه است.").nullable().optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const branchResource = defineResource<BranchRow, z.output<typeof BranchInput>>({
  key: "branches",
  labelFa: "شعبه",
  labelFaPlural: "شعبه‌ها",
  descriptionFa: "فقط اگر مدرسه بیش از یک ساختمان/شعبه دارد؛ وگرنه شعبهٴ «مرکزی» کافی است.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  columns: [
    { key: "name", labelFa: "نام" },
    { key: "schoolName", labelFa: "مدرسه" },
    { key: "address", labelFa: "نشانی", render: (r) => r.address ?? "—", secondary: true },
    { key: "isDefault", labelFa: "پیش‌فرض", render: (r) => (r.isDefault ? "✓" : ""), secondary: true },
  ],
  schema: BranchInput,
  formFields: [
    { name: "schoolId", labelFa: "مدرسه", type: "select", optionsKey: "schools", required: true, createOnly: true },
    { name: "name", labelFa: "نام شعبه", type: "text", required: true },
    { name: "address", labelFa: "نشانی", type: "text" },
    { name: "isDefault", labelFa: "شعبهٴ پیش‌فرض مدرسه", type: "toggle" },
  ],
  async loadOptions(tx, _ctx, scope) {
    return { schools: await schoolOptions(tx, scope) };
  },
  async list(tx, _ctx, scope, opts) {
    const where = and(scopeSchoolIds(scope), faLike(branch.name, opts.q));
    const rows = await tx
      .select({ id: branch.id, name: branch.name, schoolId: branch.schoolId, schoolName: school.name, address: branch.address, isDefault: branch.isDefault })
      .from(branch)
      .innerJoin(school, eq(school.id, branch.schoolId))
      .where(where)
      .orderBy(asc(school.name), desc(branch.isDefault), asc(branch.name))
      .limit(paginate(opts).limit)
      .offset(paginate(opts).offset);
    const [{ n }] = await tx.select({ n: count() }).from(branch).innerJoin(school, eq(school.id, branch.schoolId)).where(where);
    return { rows, total: n };
  },
  async create(tx, ctx, scope, input) {
    if (!input.schoolId) throw validation({ fieldErrors: { schoolId: ["مدرسه را انتخاب کنید."] } }, "مدرسه را انتخاب کنید.");
    assertSchoolInScope(scope, input.schoolId);
    const res = await createBranch(tx, ctx, { schoolId: input.schoolId, name: input.name, address: input.address ?? null, isDefault: input.isDefault });
    return { id: res.branchId };
  },
  async update(tx, ctx, scope, id, input) {
    assertSchoolInScope(scope, await schoolIdOfBranch(tx, id));
    await updateBranch(tx, ctx, id, { name: input.name, address: input.address ?? null, isDefault: input.isDefault });
  },
});

// ---------------------------------------------------------------------------------------------------------------
// academic year
// ---------------------------------------------------------------------------------------------------------------

interface YearRow {
  id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  terms: number;
}

const YearInput = z
  .object({
    schoolId: optionalRef,
    name: name("نام سال تحصیلی"),
    startsOn: jalaliDate("تاریخ شروع"),
    endsOn: jalaliDate("تاریخ پایان"),
    isCurrent: z.boolean().default(false),
    /** Create-only convenience: two standard terms (نوبت اول/دوم) split at the midpoint. */
    withTerms: z.boolean().default(true),
  })
  .strict();

function midpoint(startsOn: string, endsOn: string): string {
  const a = new Date(`${startsOn}T00:00:00Z`).getTime();
  const b = new Date(`${endsOn}T00:00:00Z`).getTime();
  return new Date(Math.round((a + b) / 2)).toISOString().slice(0, 10);
}

function nextDay(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

export const yearResource = defineResource<YearRow, z.output<typeof YearInput>>({
  key: "years",
  labelFa: "سال تحصیلی",
  labelFaPlural: "سال‌های تحصیلی",
  descriptionFa: "هر مدرسه یک سال «جاری» دارد؛ نوبت‌ها (ترم‌ها) زیر هر سال تعریف می‌شوند.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  columns: [
    { key: "name", labelFa: "سال" },
    { key: "schoolName", labelFa: "مدرسه" },
    { key: "startsOn", labelFa: "شروع", render: (r) => <span className="tabular">{isoDateToJalali(r.startsOn)}</span>, secondary: true },
    { key: "endsOn", labelFa: "پایان", render: (r) => <span className="tabular">{isoDateToJalali(r.endsOn)}</span>, secondary: true },
    { key: "terms", labelFa: "نوبت‌ها", render: (r) => formatNumberFa(r.terms) },
    { key: "isCurrent", labelFa: "جاری", render: (r) => (r.isCurrent ? "✓" : "") },
  ],
  schema: YearInput,
  formFields: [
    { name: "schoolId", labelFa: "مدرسه", type: "select", optionsKey: "schools", required: true, createOnly: true },
    { name: "name", labelFa: "نام سال", type: "text", required: true, placeholder: "۱۴۰۵-۱۴۰۶" },
    { name: "startsOn", labelFa: "تاریخ شروع", type: "jalali_date", required: true, placeholder: "۱۴۰۵/۰۷/۰۱" },
    { name: "endsOn", labelFa: "تاریخ پایان", type: "jalali_date", required: true, placeholder: "۱۴۰۶/۰۳/۳۱" },
    { name: "isCurrent", labelFa: "سال جاری این مدرسه", type: "toggle" },
    { name: "withTerms", labelFa: "دو نوبت استاندارد بساز (نوبت اول/دوم)", type: "toggle", createOnly: true },
  ],
  formValues: (r) => ({ schoolId: r.schoolId, name: r.name, startsOn: isoDateToJalali(r.startsOn), endsOn: isoDateToJalali(r.endsOn), isCurrent: r.isCurrent, withTerms: true }),
  rowHref: (r) => `/admin/terms?year=${r.id}`,
  async loadOptions(tx, _ctx, scope) {
    return { schools: await schoolOptions(tx, scope) };
  },
  async list(tx, _ctx, scope, opts) {
    const where = and(scopeSchoolIds(scope), faLike(academicYear.name, opts.q));
    const rows = await tx
      .select({
        id: academicYear.id,
        name: academicYear.name,
        schoolId: academicYear.schoolId,
        schoolName: school.name,
        startsOn: academicYear.startsOn,
        endsOn: academicYear.endsOn,
        isCurrent: academicYear.isCurrent,
        terms: count(term.id),
      })
      .from(academicYear)
      .innerJoin(school, eq(school.id, academicYear.schoolId))
      .leftJoin(term, eq(term.academicYearId, academicYear.id))
      .where(where)
      .groupBy(academicYear.id, school.name)
      .orderBy(asc(school.name), desc(academicYear.isCurrent), desc(academicYear.startsOn))
      .limit(paginate(opts).limit)
      .offset(paginate(opts).offset);
    const [{ n }] = await tx.select({ n: count() }).from(academicYear).innerJoin(school, eq(school.id, academicYear.schoolId)).where(where);
    return { rows, total: n };
  },
  async create(tx, ctx, scope, input) {
    if (!input.schoolId) throw validation({ fieldErrors: { schoolId: ["مدرسه را انتخاب کنید."] } }, "مدرسه را انتخاب کنید.");
    assertSchoolInScope(scope, input.schoolId);
    const mid = midpoint(input.startsOn, input.endsOn);
    const res = await createAcademicYear(tx, ctx, {
      schoolId: input.schoolId,
      name: input.name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: input.isCurrent,
      terms: input.withTerms
        ? [
            { name: "نوبت اول", sequence: 1, startsOn: input.startsOn, endsOn: mid },
            { name: "نوبت دوم", sequence: 2, startsOn: nextDay(mid), endsOn: input.endsOn },
          ]
        : [],
    });
    return { id: res.academicYearId };
  },
  async update(tx, ctx, scope, id, input) {
    assertSchoolInScope(scope, await schoolIdOfAcademicYear(tx, id));
    await updateAcademicYear(tx, ctx, id, { name: input.name, startsOn: input.startsOn, endsOn: input.endsOn, isCurrent: input.isCurrent });
  },
});

// ---------------------------------------------------------------------------------------------------------------
// term (nested under a year: /admin/terms?year=<id>)
// ---------------------------------------------------------------------------------------------------------------

interface TermRow {
  id: string;
  name: string;
  sequence: number;
  startsOn: string;
  endsOn: string;
  offerings: number;
}

const TermInputSchema = z
  .object({
    academicYearId: uuid,
    name: name("نام نوبت"),
    sequence,
    startsOn: jalaliDate("تاریخ شروع"),
    endsOn: jalaliDate("تاریخ پایان"),
  })
  .strict();

export const termResource = defineResource<TermRow, z.output<typeof TermInputSchema>>({
  key: "terms",
  labelFa: "نوبت",
  labelFaPlural: "نوبت‌ها",
  descriptionFa: "نوبت‌های (ترم‌های) یک سال تحصیلی. هر ارائهٴ درس به یک نوبت وصل است.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  parentParam: { name: "year", field: "academicYearId", labelFa: "سال تحصیلی", backHref: () => "/admin/years" },
  columns: [
    { key: "sequence", labelFa: "ترتیب", render: (r) => formatNumberFa(r.sequence) },
    { key: "name", labelFa: "نام" },
    { key: "startsOn", labelFa: "شروع", render: (r) => <span className="tabular">{isoDateToJalali(r.startsOn)}</span> },
    { key: "endsOn", labelFa: "پایان", render: (r) => <span className="tabular">{isoDateToJalali(r.endsOn)}</span> },
    { key: "offerings", labelFa: "ارائه‌ها", render: (r) => formatNumberFa(r.offerings), secondary: true },
  ],
  schema: TermInputSchema,
  formFields: [
    { name: "name", labelFa: "نام نوبت", type: "text", required: true, placeholder: "نوبت اول" },
    { name: "sequence", labelFa: "ترتیب", type: "number", required: true, numeric: true },
    { name: "startsOn", labelFa: "تاریخ شروع", type: "jalali_date", required: true, placeholder: "۱۴۰۵/۰۷/۰۱" },
    { name: "endsOn", labelFa: "تاریخ پایان", type: "jalali_date", required: true, placeholder: "۱۴۰۵/۱۰/۳۰" },
  ],
  formValues: (r) => ({ name: r.name, sequence: r.sequence, startsOn: isoDateToJalali(r.startsOn), endsOn: isoDateToJalali(r.endsOn) }),
  async list(tx, _ctx, scope, opts) {
    if (!opts.parent) return { rows: [], total: 0 };
    assertSchoolInScope(scope, await schoolIdOfAcademicYear(tx, opts.parent));
    const rows = await tx
      .select({ id: term.id, name: term.name, sequence: term.sequence, startsOn: term.startsOn, endsOn: term.endsOn, offerings: count(classOffering.id) })
      .from(term)
      .leftJoin(classOffering, eq(classOffering.termId, term.id))
      .where(eq(term.academicYearId, opts.parent))
      .groupBy(term.id)
      .orderBy(asc(term.sequence));
    return { rows, total: rows.length };
  },
  async create(tx, ctx, scope, input) {
    assertSchoolInScope(scope, await schoolIdOfAcademicYear(tx, input.academicYearId));
    const res = await upsertTerm(tx, ctx, { academicYearId: input.academicYearId, name: input.name, sequence: input.sequence, startsOn: input.startsOn, endsOn: input.endsOn });
    return { id: res.termId };
  },
  async update(tx, ctx, scope, id, input) {
    assertSchoolInScope(scope, await schoolIdOfAcademicYear(tx, input.academicYearId));
    const [row] = await tx.select({ id: term.id, sequence: term.sequence }).from(term).where(and(eq(term.id, id), eq(term.academicYearId, input.academicYearId))).limit(1);
    if (!row) throw notFound();
    if (row.sequence !== input.sequence) {
      const clash = await tx.select({ id: term.id }).from(term).where(and(eq(term.academicYearId, input.academicYearId), eq(term.sequence, input.sequence))).limit(1);
      if (clash[0]) throw validation({ fieldErrors: { sequence: ["نوبتی با این ترتیب وجود دارد."] } }, "نوبتی با این ترتیب وجود دارد.");
      await tx.update(term).set({ sequence: input.sequence }).where(eq(term.id, id));
    }
    await upsertTerm(tx, ctx, { academicYearId: input.academicYearId, name: input.name, sequence: input.sequence, startsOn: input.startsOn, endsOn: input.endsOn });
  },
  archive: {
    labelFa: "حذف",
    confirmFa: "این نوبت حذف شود؟ (فقط وقتی ارائهٴ درسی به آن وصل نیست)",
    async run(tx, ctx, scope, id) {
      const [row] = await tx.select({ academicYearId: term.academicYearId }).from(term).where(eq(term.id, id)).limit(1);
      if (!row) throw notFound();
      assertSchoolInScope(scope, await schoolIdOfAcademicYear(tx, row.academicYearId));
      await deleteTerm(tx, ctx, id);
    },
  },
});

// ---------------------------------------------------------------------------------------------------------------
// education level / grade level / subject (organization catalogs)
// ---------------------------------------------------------------------------------------------------------------

interface LevelRow {
  id: string;
  name: string;
  code: string;
  sequence: number;
  grades: number;
}

const LevelInput = z.object({ name: name("نام مقطع"), code: code.optional(), sequence }).strict();

export const levelResource = defineResource<LevelRow, z.output<typeof LevelInput>>({
  key: "levels",
  labelFa: "مقطع",
  labelFaPlural: "مقطع‌ها",
  descriptionFa: "مثل ابتدایی، متوسطهٴ اول، متوسطهٴ دوم. در سطح سازمان تعریف می‌شود.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  orgOnly: true,
  columns: [
    { key: "sequence", labelFa: "ترتیب", render: (r) => formatNumberFa(r.sequence) },
    { key: "name", labelFa: "نام" },
    { key: "code", labelFa: "کد", render: (r) => <bdi dir="ltr">{r.code}</bdi>, secondary: true },
    { key: "grades", labelFa: "پایه‌ها", render: (r) => formatNumberFa(r.grades) },
  ],
  schema: LevelInput,
  formFields: [
    { name: "name", labelFa: "نام مقطع", type: "text", required: true, placeholder: "متوسطهٴ دوم" },
    { name: "code", labelFa: "کد (انگلیسی)", type: "text", required: true, createOnly: true, ltr: true, placeholder: "SEC2" },
    { name: "sequence", labelFa: "ترتیب", type: "number", required: true, numeric: true },
  ],
  async list(tx, _ctx, _scope, opts) {
    const where = faLike(educationLevel.name, opts.q);
    const rows = await tx
      .select({ id: educationLevel.id, name: educationLevel.name, code: educationLevel.code, sequence: educationLevel.sequence, grades: count(gradeLevel.id) })
      .from(educationLevel)
      .leftJoin(gradeLevel, eq(gradeLevel.educationLevelId, educationLevel.id))
      .where(where)
      .groupBy(educationLevel.id)
      .orderBy(asc(educationLevel.sequence));
    return { rows, total: rows.length };
  },
  async create(tx, ctx, scope, input) {
    requireOrgScope(scope);
    if (!input.code) throw validation({ fieldErrors: { code: ["کد را وارد کنید."] } }, "کد را وارد کنید.");
    return { id: (await createEducationLevel(tx, ctx, { name: input.name, code: input.code, sequence: input.sequence })).educationLevelId };
  },
  async update(tx, ctx, scope, id, input) {
    requireOrgScope(scope);
    await updateEducationLevel(tx, ctx, id, { name: input.name, sequence: input.sequence });
  },
});

interface GradeRow {
  id: string;
  name: string;
  code: string;
  sequence: number;
  educationLevelId: string;
  levelName: string;
  classes: number;
}

const GradeInput = z.object({ educationLevelId: uuid, name: name("نام پایه"), code: code.optional(), sequence }).strict();

export const gradeResource = defineResource<GradeRow, z.output<typeof GradeInput>>({
  key: "grades",
  labelFa: "پایه",
  labelFaPlural: "پایه‌ها",
  descriptionFa: "مثل دهم، یازدهم، دوازدهم. هر کلاس به یک پایه وصل است.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  orgOnly: true,
  columns: [
    { key: "sequence", labelFa: "ترتیب", render: (r) => formatNumberFa(r.sequence) },
    { key: "name", labelFa: "نام" },
    { key: "levelName", labelFa: "مقطع", secondary: true },
    { key: "code", labelFa: "کد", render: (r) => <bdi dir="ltr">{r.code}</bdi>, secondary: true },
    { key: "classes", labelFa: "کلاس‌ها", render: (r) => formatNumberFa(r.classes) },
  ],
  schema: GradeInput,
  formFields: [
    { name: "educationLevelId", labelFa: "مقطع", type: "select", optionsKey: "levels", required: true },
    { name: "name", labelFa: "نام پایه", type: "text", required: true, placeholder: "دهم" },
    { name: "code", labelFa: "کد (انگلیسی)", type: "text", required: true, createOnly: true, ltr: true, placeholder: "G10" },
    { name: "sequence", labelFa: "ترتیب", type: "number", required: true, numeric: true },
  ],
  async loadOptions(tx) {
    const rows = await tx.select({ id: educationLevel.id, name: educationLevel.name }).from(educationLevel).orderBy(asc(educationLevel.sequence));
    return { levels: rows.map((r) => ({ value: r.id, label: r.name })) };
  },
  async list(tx, _ctx, _scope, opts) {
    const rows = await tx
      .select({
        id: gradeLevel.id,
        name: gradeLevel.name,
        code: gradeLevel.code,
        sequence: gradeLevel.sequence,
        educationLevelId: gradeLevel.educationLevelId,
        levelName: educationLevel.name,
        classes: count(classGroup.id),
      })
      .from(gradeLevel)
      .innerJoin(educationLevel, eq(educationLevel.id, gradeLevel.educationLevelId))
      .leftJoin(classGroup, eq(classGroup.gradeLevelId, gradeLevel.id))
      .where(faLike(gradeLevel.name, opts.q))
      .groupBy(gradeLevel.id, educationLevel.name, educationLevel.sequence)
      .orderBy(asc(educationLevel.sequence), asc(gradeLevel.sequence));
    return { rows, total: rows.length };
  },
  async create(tx, ctx, scope, input) {
    requireOrgScope(scope);
    if (!input.code) throw validation({ fieldErrors: { code: ["کد را وارد کنید."] } }, "کد را وارد کنید.");
    return { id: (await createGradeLevel(tx, ctx, { educationLevelId: input.educationLevelId, name: input.name, code: input.code, sequence: input.sequence })).gradeLevelId };
  },
  async update(tx, ctx, scope, id, input) {
    requireOrgScope(scope);
    await updateGradeLevel(tx, ctx, id, { name: input.name, sequence: input.sequence, educationLevelId: input.educationLevelId });
  },
});

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
  columns: [
    { key: "name", labelFa: "نام" },
    { key: "code", labelFa: "کد", render: (r) => <bdi dir="ltr">{r.code}</bdi>, secondary: true },
    { key: "offerings", labelFa: "ارائه‌ها", render: (r) => formatNumberFa(r.offerings) },
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
  capacity: number | null;
  status: string;
  students: number;
}

const ClassInput = z
  .object({
    branchId: optionalRef,
    academicYearId: optionalRef,
    gradeLevelId: uuid,
    name: name("نام کلاس"),
    capacity: optionalInt(1, 200, "ظرفیت"),
  })
  .strict();

/** `(branch, academic year)` pairs of the schools in scope, labelled «مدرسه — شعبه» / «مدرسه — سال». */
async function classOptions(tx: Tx, scope: AdminScope): Promise<Record<string, SelectOption[]>> {
  const schools = (await listSchools(tx)).filter((s) => isInScope(scope, s.id));
  const ids = schools.map((s) => s.id);
  if (ids.length === 0) return { branches: [], years: [], grades: [] };
  const branches = await tx
    .select({ id: branch.id, name: branch.name, schoolId: branch.schoolId, isDefault: branch.isDefault })
    .from(branch)
    .where(inArray(branch.schoolId, ids))
    .orderBy(desc(branch.isDefault), asc(branch.name));
  const years = await tx
    .select({ id: academicYear.id, name: academicYear.name, schoolId: academicYear.schoolId, isCurrent: academicYear.isCurrent })
    .from(academicYear)
    .where(inArray(academicYear.schoolId, ids))
    .orderBy(desc(academicYear.isCurrent), desc(academicYear.startsOn));
  const grades = await tx.select({ id: gradeLevel.id, name: gradeLevel.name }).from(gradeLevel).orderBy(asc(gradeLevel.sequence));
  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "";
  const many = schools.length > 1;
  return {
    branches: branches.map((b) => ({ value: b.id, label: many ? `${schoolName(b.schoolId)} — ${b.name}` : b.name, group: many ? schoolName(b.schoolId) : undefined })),
    years: years.map((y) => ({ value: y.id, label: `${many ? `${schoolName(y.schoolId)} — ` : ""}${y.name}${y.isCurrent ? " (جاری)" : ""}`, group: many ? schoolName(y.schoolId) : undefined })),
    grades: grades.map((g) => ({ value: g.id, label: g.name })),
  };
}

export const classResource = defineResource<ClassRow, z.output<typeof ClassInput>>({
  key: "classes",
  labelFa: "کلاس",
  labelFaPlural: "کلاس‌ها",
  descriptionFa: "کلاس = پایه + نام در یک سال تحصیلی و شعبه. روی هر کلاس: دانش‌آموزان، ارائهٴ درس‌ها و چاپ اعتبارنامه.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  columns: [
    { key: "name", labelFa: "کلاس" },
    { key: "gradeName", labelFa: "پایه" },
    // Only the school: the branch is one per school in phase 1 («— کارگر» repeated on every row said nothing).
    { key: "schoolName", labelFa: "مدرسه", secondary: true },
    { key: "yearName", labelFa: "سال", secondary: true },
    { key: "students", labelFa: "دانش‌آموز", render: (r) => formatNumberFa(r.students) },
    { key: "status", labelFa: "وضعیت", render: (r) => (r.status === "active" ? "فعال" : "بایگانی"), secondary: true },
  ],
  schema: ClassInput,
  formFields: [
    { name: "branchId", labelFa: "مدرسه / شعبه", type: "select", optionsKey: "branches", required: true, createOnly: true },
    { name: "academicYearId", labelFa: "سال تحصیلی", type: "select", optionsKey: "years", required: true, createOnly: true },
    { name: "gradeLevelId", labelFa: "پایه", type: "select", optionsKey: "grades", required: true },
    { name: "name", labelFa: "نام کلاس", type: "text", required: true, placeholder: "۱۰/۳" },
    { name: "capacity", labelFa: "ظرفیت", type: "number", numeric: true },
  ],
  formValues: (r) => ({ branchId: r.branchId, academicYearId: r.academicYearId, gradeLevelId: r.gradeLevelId, name: r.name, capacity: r.capacity }),
  rowHref: (r) => `/admin/classes/${r.id}`,
  loadOptions: (tx, _ctx, scope) => classOptions(tx, scope),
  list: (tx, _ctx, scope, opts) => listClassRows(tx, scope, opts),
  async create(tx, ctx, scope, input) {
    if (!input.branchId || !input.academicYearId) {
      throw validation({ fieldErrors: { [input.branchId ? "academicYearId" : "branchId"]: ["انتخاب کنید."] } }, "مدرسه/شعبه و سال تحصیلی را انتخاب کنید.");
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

const OFFERING_FIELD_MESSAGES = { subjectId: "درس را انتخاب کنید.", termId: "نوبت را انتخاب کنید." } as const;

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
 * hours/status are STRUCTURE (`tenancy.structure.write` — principal, organization admin); setting, changing or
 * removing the main teacher of an EXISTING offering is `academic.teacher_assignment.write` (the vice principal
 * holds it too). Both are checked at the offering's school with `can()`, after the scope rule (NOT_FOUND first).
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
    { key: "termName", labelFa: "نوبت", secondary: true },
    { key: "teacherName", labelFa: "دبیر", render: (r) => r.teacherName ?? <span className="text-warning-text">بدون دبیر</span> },
    { key: "weeklyHours", labelFa: "ساعت/هفته", render: (r) => (r.weeklyHours ? formatNumberFa(Number(r.weeklyHours)) : "—"), secondary: true },
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
    // Structure: a vice principal (teacher_assignment.write only) may not define offerings — FORBIDDEN for a class they can see.
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
    // The form always resubmits hours + status; only a CHANGE to them is a structure edit (a vice principal leaves them as they are).
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
  [schoolResource, branchResource, yearResource, termResource, levelResource, gradeResource, subjectResource, classResource, offeringResource].map((r) => [r.key, r]),
);

export const RESOURCE_KEYS = Object.keys(RESOURCES) as [string, ...string[]];

/** Admin sub-navigation, in onboarding order. */
export const ADMIN_NAV: Array<{ href: string; labelFa: string }> = [
  { href: "/admin", labelFa: "نمای کلی" },
  { href: "/admin/schools", labelFa: "مدرسه‌ها" },
  { href: "/admin/years", labelFa: "سال‌ها" },
  { href: "/admin/levels", labelFa: "مقطع‌ها" },
  { href: "/admin/grades", labelFa: "پایه‌ها" },
  { href: "/admin/subjects", labelFa: "درس‌ها" },
  { href: "/admin/classes", labelFa: "کلاس‌ها" },
  { href: "/admin/students", labelFa: "دانش‌آموزان" },
  { href: "/admin/staff", labelFa: "کارکنان" },
  { href: "/admin/roles", labelFa: "نقش‌ها" },
  { href: "/admin/onboarding", labelFa: "راه‌اندازی" },
];
