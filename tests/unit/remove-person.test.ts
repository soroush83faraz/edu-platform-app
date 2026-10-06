// «حذف دانش‌آموز» / «حذف از کارکنان», the parts without a database: the action's strict input, the words of the
// confirm (it names the person and says what goes and what stays) and the importer's refusal of rows that name a
// removed person — a pure function over a hand-built reference, with a not-removed control. The removal itself, its
// guards and the shut doors are tests/int/admin-remove-person.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Row } from "@/modules/integ/importers/parse";
import type { SheetKey } from "@/modules/integ/importers/template";
import type { ImportReference, RefStudent } from "@/modules/integ/importers/validate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
// The server action pulls in the whole server stack (db, session); nothing here is submitted.
vi.mock("@/lib/admin/people-actions", () => ({ removePersonAction: async () => ({ ok: false, code: "INTERNAL", message: "" }) }));

const { RemovePersonCard, removalCopy } = await import("@/components/admin/RemovePersonCard");
const { RemovePersonInput } = await import("@/lib/admin/people-dto");
const { IMPORT_MESSAGES, validateImport } = await import("@/modules/integ/importers/validate");
const { PERSON_REMOVED_MESSAGE } = await import("@/modules/iam/messages");

const PERSON = "0199a000-0002-7000-8000-000000000001";

describe("RemovePersonInput", () => {
  it("takes a person and the list they leave — nothing else", () => {
    expect(RemovePersonInput.parse({ personId: PERSON, kind: "student" })).toEqual({ personId: PERSON, kind: "student" });
    expect(RemovePersonInput.parse({ personId: PERSON, kind: "staff" })).toEqual({ personId: PERSON, kind: "staff" });
    expect(RemovePersonInput.safeParse({ personId: PERSON, kind: "person" }).success).toBe(false);
    expect(RemovePersonInput.safeParse({ personId: "not-a-uuid", kind: "staff" }).success).toBe(false);
    // `.strict()`: no stray key reaches the service (an organization, a date, a "hard" flag…).
    expect(RemovePersonInput.safeParse({ personId: PERSON, kind: "staff", organizationId: PERSON }).success).toBe(false);
    expect(RemovePersonInput.safeParse({ personId: PERSON }).success).toBe(false);
  });
});

describe("the confirm's words", () => {
  it("names the person, says what is removed and what stays, and sends each kind back to its own list", () => {
    const student = removalCopy("student", "نگار صادقی");
    expect(student.label).toBe("حذف دانش‌آموز");
    expect(student.listHref).toBe("/admin/students");
    expect(student.confirm).toContain("نگار صادقی");
    expect(student.confirm).toContain("دیگر نمی‌تواند وارد سامانه شود");
    expect(student.confirm).toContain("سوابق تکالیف و حضور و غیاب");
    const staff = removalCopy("staff", "حسین محمدی");
    expect(staff.label).toBe("حذف از کارکنان");
    expect(staff.listHref).toBe("/admin/staff");
    expect(staff.confirm).toContain("حسین محمدی");
    expect(staff.confirm).toContain("نقش‌هایش پایان می‌یابد");
    // Persian only (house rule): no Latin letters in any visible string.
    for (const s of [student, staff]) for (const text of [s.label, s.summary, s.confirm, s.done]) expect(text, text).not.toMatch(/[A-Za-z]/);
  });

  it("the block shows the label and one line of consequences; the confirm stays closed until tapped", () => {
    const html = renderToStaticMarkup(createElement(RemovePersonCard, { personId: PERSON, name: "نگار صادقی", kind: "student" }));
    expect(html).toContain("حذف دانش‌آموز");
    expect(html).toContain(removalCopy("student", "نگار صادقی").summary);
    expect(html).not.toContain("انصراف");
  });
});

// ---- the importer: a hand-built reference (no database) ----
const PHONE = "+989127300060";
const BRANCH = "0199a000-0002-7000-8000-0000000000b1";
const GRADE = "0199a000-0005-7000-8000-0000000000b1";
const SUBJECT = "0199a000-0009-7000-8000-0000000000b1";

function reference(removed: boolean): ImportReference {
  const student: RefStudent = {
    personId: "0199a000-0006-7000-8000-0000000000b1",
    studentProfileId: "0199a000-000d-7000-8000-0000000000b1",
    firstName: "حنانه",
    lastName: "طاهری",
    externalRef: null,
    hasAccount: false,
    currentClassGroupId: null,
    removed,
  };
  return {
    school: { id: "0199a000-0001-7000-8000-0000000000b1", code: "S1", name: "دبستان" },
    branches: [{ id: BRANCH, name: "مرکزی", isDefault: true }],
    academicYear: { id: "0199a000-0003-7000-8000-0000000000b1", name: "۱۴۰۵-۱۴۰۶" },
    term: { id: "0199a000-000a-7000-8000-0000000000b1", name: "نوبت اول" },
    grades: [{ id: GRADE, name: "اول", code: "G1" }],
    subjects: [{ id: SUBJECT, name: "ریاضی", code: "MATH" }],
    classes: [{ id: "0199a000-000b-7000-8000-0000000000b1", name: "اول 1", branchId: BRANCH, gradeLevelId: GRADE }],
    staffByPhone: new Map([[PHONE, { personId: "0199a000-0006-7000-8000-0000000000b2", staffProfileId: "0199a000-000e-7000-8000-0000000000b2", firstName: "یوسف", lastName: "کامرانی", removed }]]),
    studentsByNumber: new Map([["R-500", student]]),
    studentsByExternalRef: new Map(),
    foreignStudentNumbers: new Set(),
    foreignExternalRefs: new Set(),
    takenIdentifiers: new Set([PHONE]),
  };
}

const row = (sheet: SheetKey, rowNumber: number, values: Record<string, string>): Row => ({ sheet, rowNumber, raw: values, values });
const workbook = (sheets: { staff?: Row[]; teaching?: Row[]; students?: Row[] }) => ({
  sheets: { classes: [], staff: sheets.staff ?? [], teaching: sheets.teaching ?? [], students: sheets.students ?? [] },
  errors: [],
  ignoredSheets: [],
});
/** By phone: the staff sheet, a teaching row and a student row naming the two people of `reference`. */
const byPhone = workbook({
  staff: [row("staff", 2, { first_name: "یوسف", last_name: "کامرانی", phone: PHONE })],
  teaching: [row("teaching", 2, { teacher_phone: PHONE, class_name: "اول 1", subject: "ریاضی" })],
  students: [row("students", 2, { first_name: "حنانه", last_name: "طاهری", student_number: "R-500", grade: "اول", class_name: "اول 1" })],
});
/** A v0 file names the teacher instead of the phone (no staff sheet): a removed colleague's name resolves to nobody. */
const byName = workbook({ teaching: [row("teaching", 2, { teacher_name: "یوسف کامرانی", class_name: "اول 1", subject: "ریاضی" })] });
const issuesOf = (v: ReturnType<typeof validateImport>, sheet: SheetKey) => v.rows.find((r) => r.sheet === sheet)?.issues ?? [];

describe("the importer and removed people", () => {
  it("a row naming a removed colleague or student is an error and nothing is planned for them", () => {
    expect(IMPORT_MESSAGES.personRemoved).toBe(PERSON_REMOVED_MESSAGE);
    const v = validateImport(byPhone, reference(true), { createSubjects: false });
    expect(v.ok).toBe(false);
    expect(v.plan.staff).toEqual([]);
    expect(v.plan.teaching).toEqual([]);
    expect(v.plan.students).toEqual([]);
    expect(issuesOf(v, "staff")).toContainEqual({ column: "phone", message: PERSON_REMOVED_MESSAGE, level: "error" });
    expect(issuesOf(v, "teaching")).toContainEqual({ column: "teacher_phone", message: PERSON_REMOVED_MESSAGE, level: "error" });
    expect(issuesOf(v, "students")).toContainEqual({ column: "student_number", message: PERSON_REMOVED_MESSAGE, level: "error" });
    const named = validateImport(byName, reference(true), { createSubjects: false });
    expect(named.plan.teaching).toEqual([]);
    expect(issuesOf(named, "teaching").map((i) => i.level)).toContain("error");
  });

  it("control: the same people, not removed, are recognised (warnings) and planned as before", () => {
    const v = validateImport(byPhone, reference(false), { createSubjects: false });
    expect(v.ok).toBe(true);
    expect(v.plan.staff.map((s) => s.existing?.staffProfileId)).toEqual(["0199a000-000e-7000-8000-0000000000b2"]);
    expect(v.plan.teaching.map((t) => t.teacherPhone)).toEqual([PHONE]);
    expect(v.plan.students.map((s) => s.existing?.studentProfileId)).toEqual(["0199a000-000d-7000-8000-0000000000b1"]);
    for (const r of v.rows) expect(r.issues.map((i) => i.message)).not.toContain(PERSON_REMOVED_MESSAGE);
    const named = validateImport(byName, reference(false), { createSubjects: false });
    expect(named.ok).toBe(true);
    expect(named.plan.teaching.map((t) => t.teacherPhone)).toEqual([PHONE]);
  });
});
