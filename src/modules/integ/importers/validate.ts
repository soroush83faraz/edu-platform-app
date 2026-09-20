// Validation of a parsed workbook against the school it is imported into. `loadReference` reads what the file may
// refer to (grades, subjects, current year/term, existing classes, staff by phone, students by number, taken
// login identifiers) under RLS; `validateImport` is pure and produces per-row Persian errors with sheet/row/column
// plus the commit plan. Cross-row duplicates and cross-sheet references are checked here, before any write.
import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { normalizeFa, toAsciiDigits } from "@/lib/normalize";
import { organizationMembership, person, staffProfile, studentProfile, userAccount } from "@/modules/iam/schema";
import { STUDENT_NUMBER_RE } from "@/modules/iam/service";
import { findCurrentAcademicYear, findCurrentTerm, findSchoolByCode, listGradeLevels, listSubjects } from "@/modules/tenancy/repo";
import { branch, classGroup } from "@/modules/tenancy/schema";
import type { ParsedWorkbook, Row, RowError } from "./parse";
import { SHEET_BY_KEY, type SheetKey } from "./template";

export interface RefClass {
  id: string;
  name: string;
  branchId: string;
  gradeLevelId: string;
}

export interface RefStaff {
  personId: string;
  staffProfileId: string;
  firstName: string;
  lastName: string;
}

export interface RefStudent {
  personId: string;
  studentProfileId: string;
  firstName: string;
  lastName: string;
  externalRef: string | null;
  hasAccount: boolean;
  currentClassGroupId: string | null;
}

export interface ImportReference {
  school: { id: string; code: string; name: string };
  branches: Array<{ id: string; name: string; isDefault: boolean }>;
  academicYear: { id: string; name: string };
  term: { id: string; name: string };
  grades: Array<{ id: string; name: string; code: string }>;
  subjects: Array<{ id: string; name: string; code: string }>;
  /** Active classes of the current year of this school. */
  classes: RefClass[];
  staffByPhone: Map<string, RefStaff>;
  studentsByNumber: Map<string, RefStudent>;
  studentsByExternalRef: Map<string, RefStudent>;
  /** Login identifiers (phones/usernames) of the file that already exist anywhere (global table). */
  takenIdentifiers: Set<string>;
}

/** Matching key for names/codes: Persian letters, ASCII digits, ZWNJ → space, case-insensitive. */
export const normKey = (s: string) => normalizeFa(toAsciiDigits(s)).replace(/‌/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const norm = normKey;

/** Everything the validator needs, read once. NOT_FOUND when the school code is unknown or has no current year. */
export async function loadReference(tx: Tx, schoolCode: string, parsed: ParsedWorkbook): Promise<ImportReference> {
  const school = await findSchoolByCode(tx, schoolCode);
  if (!school) throw notFound(`مدرسه‌ای با کد «${schoolCode}» در این سازمان نیست.`);
  const year = await findCurrentAcademicYear(tx, school.id);
  if (!year) throw notFound(`مدرسهٴ «${school.name}» سال تحصیلی جاری ندارد؛ اول آن را در بخش مدیریت تعریف کنید.`);
  const term = await findCurrentTerm(tx, year.id);
  if (!term) throw notFound(`سال «${year.name}» نوبتی ندارد؛ اول نوبت‌ها را تعریف کنید.`);
  const branches = await tx.select({ id: branch.id, name: branch.name, isDefault: branch.isDefault }).from(branch).where(eq(branch.schoolId, school.id));
  const grades = await listGradeLevels(tx);
  const subjects = await listSubjects(tx);
  const classes = await tx
    .select({ id: classGroup.id, name: classGroup.name, branchId: classGroup.branchId, gradeLevelId: classGroup.gradeLevelId })
    .from(classGroup)
    .where(and(eq(classGroup.academicYearId, year.id), eq(classGroup.status, "active"), inArray(classGroup.branchId, branches.map((b) => b.id))));

  const phones = new Set<string>();
  for (const r of [...parsed.sheets.staff, ...parsed.sheets.teaching]) {
    const p = r.values.teacher_phone ?? r.values.phone;
    if (p?.startsWith("+")) phones.add(p);
  }
  for (const r of parsed.sheets.students) if (r.values.phone?.startsWith("+")) phones.add(r.values.phone);

  const staffByPhone = new Map<string, RefStaff>();
  if (phones.size > 0) {
    const rows = await tx
      .select({ personId: person.id, staffProfileId: staffProfile.id, firstName: person.firstName, lastName: person.lastName, phone: userAccount.loginIdentifier })
      .from(staffProfile)
      .innerJoin(person, eq(person.id, staffProfile.personId))
      .innerJoin(organizationMembership, eq(organizationMembership.personId, person.id))
      .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
      .where(inArray(userAccount.loginIdentifier, [...phones]));
    for (const r of rows) staffByPhone.set(r.phone, r);
  }

  const numbers = parsed.sheets.students.map((r) => r.values.student_number).filter(Boolean);
  const refs = parsed.sheets.students.map((r) => r.values.external_ref).filter(Boolean);
  const studentsByNumber = new Map<string, RefStudent>();
  const studentsByExternalRef = new Map<string, RefStudent>();
  if (numbers.length > 0 || refs.length > 0) {
    const rows = await tx
      .select({
        personId: person.id,
        studentProfileId: studentProfile.id,
        firstName: person.firstName,
        lastName: person.lastName,
        externalRef: person.externalRef,
        studentNumber: studentProfile.studentNumber,
        hasAccount: sql<boolean>`exists (select 1 from iam.organization_membership m where m.person_id = ${person.id})`,
        currentClassGroupId: sql<string | null>`(select ce.class_group_id from academic.class_enrollment ce where ce.student_profile_id = ${studentProfile.id} and ce.status = 'active' limit 1)`,
      })
      .from(studentProfile)
      .innerJoin(person, eq(person.id, studentProfile.personId))
      .where(or(numbers.length > 0 ? inArray(studentProfile.studentNumber, numbers) : undefined, refs.length > 0 ? inArray(person.externalRef, refs) : undefined));
    for (const r of rows) {
      const s: RefStudent = { personId: r.personId, studentProfileId: r.studentProfileId, firstName: r.firstName, lastName: r.lastName, externalRef: r.externalRef, hasAccount: r.hasAccount, currentClassGroupId: r.currentClassGroupId };
      studentsByNumber.set(r.studentNumber, s);
      if (r.externalRef) studentsByExternalRef.set(r.externalRef, s);
    }
  }

  // Login identifiers already taken anywhere (phones of the file + generated usernames of students without one).
  const candidates = new Set<string>(phones);
  for (const r of parsed.sheets.students) if (!r.values.phone && r.values.student_number) candidates.add(`${school.code.toLowerCase()}-${r.values.student_number.toLowerCase()}`);
  const takenIdentifiers = new Set<string>();
  if (candidates.size > 0) {
    const rows = await tx.select({ id: userAccount.loginIdentifier }).from(userAccount).where(inArray(userAccount.loginIdentifier, [...candidates]));
    for (const r of rows) takenIdentifiers.add(r.id);
  }
  return { school: { id: school.id, code: school.code, name: school.name }, branches, academicYear: year, term, grades, subjects, classes, staffByPhone, studentsByNumber, studentsByExternalRef, takenIdentifiers };
}

// ---------------------------------------------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------------------------------------------

export interface RowIssue {
  column: string | null;
  message: string;
  level: "error" | "warning";
}

export interface ValidatedRow {
  sheet: SheetKey;
  rowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, unknown>;
  status: "ok" | "warning" | "error";
  issues: RowIssue[];
}

export interface PlanClass {
  rowNumber: number;
  name: string;
  gradeLevelId: string;
  branchId: string;
  existing: RefClass | null;
}

export interface PlanStaff {
  rowNumber: number;
  firstName: string;
  lastName: string;
  phone: string;
  employeeNumber: string | null;
  existing: RefStaff | null;
}

export interface PlanTeaching {
  rowNumber: number;
  teacherPhone: string;
  className: string;
  branchId: string;
  subjectId: string | null;
  /** Subject to create first (org admins with --create-subjects). */
  newSubject: { name: string; code: string } | null;
}

export interface PlanStudent {
  rowNumber: number;
  firstName: string;
  lastName: string;
  studentNumber: string;
  phone: string | null;
  guardianPhone: string | null;
  externalRef: string | null;
  className: string;
  branchId: string;
  gradeLevelId: string;
  existing: RefStudent | null;
}

export interface ImportPlan {
  classes: PlanClass[];
  staff: PlanStaff[];
  teaching: PlanTeaching[];
  students: PlanStudent[];
  newSubjects: Array<{ name: string; code: string }>;
}

export interface SheetSummary {
  rows: number;
  ok: number;
  warning: number;
  error: number;
}

export interface ValidationResult {
  rows: ValidatedRow[];
  plan: ImportPlan;
  summary: Record<SheetKey, SheetSummary>;
  /** File-level problems from the parser (missing sheets/columns, bad phones). */
  fileErrors: RowError[];
  /** No blocking error anywhere → the file can be committed. */
  ok: boolean;
  errorCount: number;
}

export interface ValidateOptions {
  /** Unknown subjects are created (organization-scoped admins only) instead of rejected. */
  createSubjects: boolean;
}

/** Deterministic subject code for a subject created from its Persian name: `X-<8 hex>`. */
export function autoSubjectCode(name: string): string {
  return `X-${createHash("sha1").update(norm(name)).digest("hex").slice(0, 8).toUpperCase()}`;
}

export function validateImport(parsed: ParsedWorkbook, ref: ImportReference, opts: ValidateOptions): ValidationResult {
  const rows: ValidatedRow[] = [];
  const plan: ImportPlan = { classes: [], staff: [], teaching: [], students: [], newSubjects: [] };
  const defaultBranch = ref.branches.find((b) => b.isDefault) ?? ref.branches[0];
  const gradeByKey = new Map<string, (typeof ref.grades)[number]>();
  for (const g of ref.grades) {
    gradeByKey.set(norm(g.name), g);
    gradeByKey.set(norm(g.code), g);
  }
  const subjectByKey = new Map<string, (typeof ref.subjects)[number]>();
  for (const s of ref.subjects) {
    subjectByKey.set(norm(s.name), s);
    subjectByKey.set(norm(s.code), s);
  }
  const branchByKey = new Map<string, (typeof ref.branches)[number]>();
  for (const b of ref.branches) branchByKey.set(norm(b.name), b);
  /** `${branchId}|${norm(name)}` → class (DB or file). */
  const classByKey = new Map<string, { branchId: string; gradeLevelId: string; name: string; fromFile: boolean }>();
  for (const c of ref.classes) classByKey.set(`${c.branchId}|${norm(c.name)}`, { branchId: c.branchId, gradeLevelId: c.gradeLevelId, name: c.name, fromFile: false });
  const staffPhones = new Set<string>(ref.staffByPhone.keys());
  const staffNameByKey = new Map<string, string[]>(); // norm(full name) → phones
  const addStaffName = (first: string, last: string, phone: string) => {
    const k = norm(`${first} ${last}`);
    staffNameByKey.set(k, [...(staffNameByKey.get(k) ?? []), phone]);
  };
  for (const [phone, s] of ref.staffByPhone) addStaffName(s.firstName, s.lastName, phone);

  const parserIssues = new Map<string, RowIssue[]>();
  for (const e of parsed.errors) {
    if (e.sheet && e.rowNumber && e.rowNumber > 1) {
      const k = `${e.sheet}:${e.rowNumber}`;
      parserIssues.set(k, [...(parserIssues.get(k) ?? []), { column: e.column, message: e.message, level: e.level }]);
    }
  }

  const finish = (row: Row, normalized: Record<string, unknown>, issues: RowIssue[]): boolean => {
    const all = [...(parserIssues.get(`${row.sheet}:${row.rowNumber}`) ?? []), ...issues];
    const status: ValidatedRow["status"] = all.some((i) => i.level === "error") ? "error" : all.length > 0 ? "warning" : "ok";
    rows.push({ sheet: row.sheet, rowNumber: row.rowNumber, raw: row.raw, normalized, status, issues: all });
    return status !== "error";
  };
  const required = (row: Row, issues: RowIssue[]): void => {
    for (const c of SHEET_BY_KEY[row.sheet].columns) {
      if (c.required && !(row.values[c.key] ?? "").trim()) issues.push({ column: c.key, message: `«${c.labelFa}» خالی است.`, level: "error" });
    }
  };

  // ---- classes ----
  const seenClass = new Set<string>();
  for (const row of parsed.sheets.classes) {
    const issues: RowIssue[] = [];
    required(row, issues);
    const v = row.values;
    const grade = gradeByKey.get(norm(v.grade ?? ""));
    if (v.grade && !grade) issues.push({ column: "grade", message: `پایهٴ «${v.grade}» در سامانه تعریف نشده است.`, level: "error" });
    const br = v.branch ? branchByKey.get(norm(v.branch)) : defaultBranch;
    if (v.branch && !br) issues.push({ column: "branch", message: `شعبهٴ «${v.branch}» در این مدرسه نیست.`, level: "error" });
    const name = v.class_name ?? "";
    const key = br ? `${br.id}|${norm(name)}` : null;
    if (key && seenClass.has(key)) issues.push({ column: "class_name", message: `کلاس «${name}» در این شیت تکراری است.`, level: "error" });
    if (key) seenClass.add(key);
    const existing = key ? ref.classes.find((c) => `${c.branchId}|${norm(c.name)}` === key) ?? null : null;
    if (existing && grade && existing.gradeLevelId !== grade.id) {
      issues.push({ column: "grade", message: `کلاس «${name}» در سامانه با پایهٴ دیگری ثبت شده؛ پایه به‌روز می‌شود.`, level: "warning" });
    } else if (existing) {
      issues.push({ column: null, message: "کلاس از قبل وجود دارد؛ فقط به‌روز می‌شود.", level: "warning" });
    }
    const ok = finish(row, { name, gradeLevelId: grade?.id ?? null, branchId: br?.id ?? null, existingId: existing?.id ?? null }, issues);
    if (ok && grade && br && key) {
      classByKey.set(key, { branchId: br.id, gradeLevelId: grade.id, name, fromFile: true });
      plan.classes.push({ rowNumber: row.rowNumber, name, gradeLevelId: grade.id, branchId: br.id, existing });
    }
  }

  // ---- staff ----
  const seenPhone = new Set<string>();
  for (const row of parsed.sheets.staff) {
    const issues: RowIssue[] = [];
    required(row, issues);
    const v = row.values;
    const phone = v.phone?.startsWith("+") ? v.phone : null;
    if (phone && seenPhone.has(phone)) issues.push({ column: "phone", message: "این موبایل در شیت دبیران تکراری است.", level: "error" });
    if (phone) seenPhone.add(phone);
    const existing = phone ? ref.staffByPhone.get(phone) ?? null : null;
    if (phone && !existing && ref.takenIdentifiers.has(phone)) issues.push({ column: "phone", message: "این شماره قبلاً ثبت شده است.", level: "error" });
    if (existing) issues.push({ column: null, message: `دبیر با این موبایل از قبل هست (${existing.firstName} ${existing.lastName})؛ دوباره ساخته نمی‌شود.`, level: "warning" });
    const ok = finish(row, { firstName: v.first_name, lastName: v.last_name, phone, employeeNumber: v.employee_number || null, existingPersonId: existing?.personId ?? null }, issues);
    if (ok && phone) {
      staffPhones.add(phone);
      addStaffName(v.first_name, v.last_name, phone);
      plan.staff.push({ rowNumber: row.rowNumber, firstName: v.first_name, lastName: v.last_name, phone, employeeNumber: v.employee_number || null, existing });
    }
  }

  // ---- teaching ----
  const seenTeaching = new Set<string>();
  const newSubjects = new Map<string, { name: string; code: string }>();
  for (const row of parsed.sheets.teaching) {
    const issues: RowIssue[] = [];
    const v = row.values;
    let phone = v.teacher_phone?.startsWith("+") ? v.teacher_phone : null;
    const teacherName = [v.teacher_name, v.teacher_last_name].filter(Boolean).join(" ").trim();
    if (!phone && teacherName) {
      // v0 files carry the teacher's name instead of the phone: resolve when it is unambiguous.
      const phones = staffNameByKey.get(norm(teacherName)) ?? [];
      if (phones.length === 1) phone = phones[0];
      else issues.push({ column: "teacher_phone", message: phones.length === 0 ? `دبیر «${teacherName}» در شیت دبیران یا سامانه پیدا نشد.` : `نام «${teacherName}» بین چند دبیر مشترک است؛ موبایل را بنویسید.`, level: "error" });
    } else if (!phone) {
      issues.push({ column: "teacher_phone", message: "«موبایل دبیر» خالی است.", level: "error" });
    } else if (!staffPhones.has(phone)) {
      issues.push({ column: "teacher_phone", message: `دبیری با موبایل «${row.raw.teacher_phone?.trim() ?? phone}» در شیت دبیران یا سامانه نیست.`, level: "error" });
    }
    if (!v.class_name) issues.push({ column: "class_name", message: "«کلاس» خالی است.", level: "error" });
    if (!v.subject) issues.push({ column: "subject", message: "«درس» خالی است.", level: "error" });
    // Class: any branch of the school (file classes first, then DB).
    const classMatches = [...classByKey.entries()].filter(([k]) => k.endsWith(`|${norm(v.class_name ?? "")}`));
    if (v.class_name && classMatches.length === 0) issues.push({ column: "class_name", message: `کلاس «${v.class_name}» در شیت کلاس‌ها یا سامانه نیست.`, level: "error" });
    if (classMatches.length > 1) issues.push({ column: "class_name", message: `کلاس «${v.class_name}» در چند شعبه هست؛ فایل نمی‌تواند شعبه را مشخص کند.`, level: "error" });
    const cls = classMatches.length === 1 ? classMatches[0][1] : null;
    let subjectId: string | null = null;
    let newSubject: { name: string; code: string } | null = null;
    if (v.subject) {
      const sub = subjectByKey.get(norm(v.subject));
      if (sub) subjectId = sub.id;
      else if (opts.createSubjects) {
        newSubject = newSubjects.get(norm(v.subject)) ?? { name: v.subject, code: autoSubjectCode(v.subject) };
        newSubjects.set(norm(v.subject), newSubject);
        issues.push({ column: "subject", message: `درس «${v.subject}» در سامانه نیست و ساخته می‌شود (${newSubject.code}).`, level: "warning" });
      } else issues.push({ column: "subject", message: `درس «${v.subject}» در سامانه تعریف نشده است (با --create-subjects ساخته می‌شود).`, level: "error" });
    }
    const dupKey = `${phone}|${norm(v.class_name ?? "")}|${norm(v.subject ?? "")}`;
    if (phone && seenTeaching.has(dupKey)) issues.push({ column: null, message: "این ردیف در شیت تکراری است.", level: "error" });
    seenTeaching.add(dupKey);
    const ok = finish(row, { teacherPhone: phone, className: v.class_name, subject: v.subject, subjectId, newSubjectCode: newSubject?.code ?? null }, issues);
    if (ok && phone && cls) plan.teaching.push({ rowNumber: row.rowNumber, teacherPhone: phone, className: cls.name, branchId: cls.branchId, subjectId, newSubject });
  }
  plan.newSubjects = [...newSubjects.values()];

  // ---- students ----
  const seenNumber = new Set<string>();
  const seenStudentPhone = new Set<string>();
  const seenRef = new Set<string>();
  for (const row of parsed.sheets.students) {
    const issues: RowIssue[] = [];
    required(row, issues);
    const v = row.values;
    const number = v.student_number ?? "";
    if (number && !STUDENT_NUMBER_RE.test(number)) issues.push({ column: "student_number", message: "شمارهٴ دانش‌آموزی فقط رقم، حرف انگلیسی و خط تیره (حداکثر ۲۰ نویسه).", level: "error" });
    if (number && seenNumber.has(number)) issues.push({ column: "student_number", message: `شمارهٴ دانش‌آموزی «${number}» در شیت تکراری است.`, level: "error" });
    seenNumber.add(number);
    const phone = v.phone?.startsWith("+") ? v.phone : null;
    const guardianPhone = v.guardian_phone?.startsWith("+") ? v.guardian_phone : null;
    if (phone && seenStudentPhone.has(phone)) issues.push({ column: "phone", message: "این موبایل برای دانش‌آموز دیگری در همین شیت ثبت شده.", level: "error" });
    if (phone) seenStudentPhone.add(phone);
    if (phone && guardianPhone && phone === guardianPhone) issues.push({ column: "guardian_phone", message: "شمارهٴ ولی با موبایل دانش‌آموز یکی است.", level: "warning" });
    const externalRef = v.external_ref || null;
    if (externalRef && seenRef.has(externalRef)) issues.push({ column: "external_ref", message: "کد یکتا در شیت تکراری است.", level: "error" });
    if (externalRef) seenRef.add(externalRef);
    const grade = gradeByKey.get(norm(v.grade ?? ""));
    if (v.grade && !grade) issues.push({ column: "grade", message: `پایهٴ «${v.grade}» در سامانه تعریف نشده است.`, level: "error" });
    const classMatches = [...classByKey.entries()].filter(([k]) => k.endsWith(`|${norm(v.class_name ?? "")}`));
    if (v.class_name && classMatches.length === 0) issues.push({ column: "class_name", message: `کلاس «${v.class_name}» در شیت کلاس‌ها یا سامانه نیست.`, level: "error" });
    if (classMatches.length > 1) issues.push({ column: "class_name", message: `کلاس «${v.class_name}» در چند شعبه هست.`, level: "error" });
    const cls = classMatches.length === 1 ? classMatches[0][1] : null;
    if (cls && grade && cls.gradeLevelId !== grade.id) issues.push({ column: "grade", message: `پایهٴ دانش‌آموز با پایهٴ کلاس «${cls.name}» یکی نیست.`, level: "error" });
    const existing = ref.studentsByNumber.get(number) ?? (externalRef ? ref.studentsByExternalRef.get(externalRef) ?? null : null);
    if (existing && externalRef && existing.externalRef && existing.externalRef !== externalRef) {
      issues.push({ column: "external_ref", message: "کد یکتا با کد ثبت‌شدهٴ این دانش‌آموز فرق دارد؛ کد سامانه نگه داشته می‌شود.", level: "warning" });
    }
    if (existing) issues.push({ column: null, message: `دانش‌آموز با این شماره از قبل هست (${existing.firstName} ${existing.lastName})؛ نام و کلاس به‌روز می‌شود، حساب دوباره ساخته نمی‌شود.`, level: "warning" });
    if (!existing) {
      const identifier = phone ?? `${ref.school.code.toLowerCase()}-${number.toLowerCase()}`;
      if (ref.takenIdentifiers.has(identifier) || (phone && staffPhones.has(phone))) issues.push({ column: phone ? "phone" : "student_number", message: "این شماره قبلاً ثبت شده است.", level: "error" });
    }
    const ok = finish(row, { firstName: v.first_name, lastName: v.last_name, studentNumber: number, phone, guardianPhone, externalRef, className: v.class_name, gradeLevelId: grade?.id ?? null, existingPersonId: existing?.personId ?? null }, issues);
    if (ok && cls && grade) {
      plan.students.push({ rowNumber: row.rowNumber, firstName: v.first_name, lastName: v.last_name, studentNumber: number, phone, guardianPhone, externalRef, className: cls.name, branchId: cls.branchId, gradeLevelId: grade.id, existing });
    }
  }

  const summary = {} as Record<SheetKey, SheetSummary>;
  for (const k of ["classes", "students", "staff", "teaching"] as SheetKey[]) {
    const rs = rows.filter((r) => r.sheet === k);
    summary[k] = { rows: rs.length, ok: rs.filter((r) => r.status === "ok").length, warning: rs.filter((r) => r.status === "warning").length, error: rs.filter((r) => r.status === "error").length };
  }
  const fileBlocking = parsed.errors.filter((e) => e.level === "error" && !(e.rowNumber && e.rowNumber > 1));
  const errorCount = rows.filter((r) => r.status === "error").length + fileBlocking.length;
  return { rows, plan, summary, fileErrors: parsed.errors, ok: errorCount === 0, errorCount };
}
