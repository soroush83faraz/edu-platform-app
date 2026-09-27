// «تدریس» on a colleague's page (owner, 2026-09-27: «when the manager taps a staff member they should be able to make
// them teach a subject»). Rendered statically: the list (درس · کلاس · نقش) is there for every reader; «افزودن تدریس»
// and «پایان تدریس» only for a caller holding `academic.teacher_assignment.write`. The «درس» picker offers the class's
// offerings with their current main teacher and, where the caller may define offerings, the درس‌ها the class lacks
// in its current نوبت. The server re-checks everything (tests/int/admin-scope «T»).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PersonDetail } from "@/lib/admin/people";
import type { TeachingClassOption, TeachingFormOptions } from "@/lib/admin/teaching";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/lib/admin/people-actions", () => {
  const never = async () => ({ ok: false, code: "INTERNAL", message: "" });
  return { assignTeachingAction: never, endTeachingAction: never };
});
// The dialog reuses the resource form's `Field`, whose module also imports the resource action.
vi.mock("@/lib/admin/actions", () => ({ adminResourceMutate: async () => ({ ok: false, code: "INTERNAL", message: "" }) }));

const { TeachingCard, subjectPickOptions } = await import("@/components/admin/TeachingCard");
const { AssignTeachingInput } = await import("@/lib/admin/people-dto");

const PERSON = "0199a000-0002-7000-8000-000000000001";
const CLASS = "0199a000-000b-7000-8000-000000000001";
const TERM_1 = "0199a000-000a-7000-8000-000000000001";
const TERM_2 = "0199a000-000a-7000-8000-000000000002";
const MATH = "0199a000-0009-7000-8000-000000000001";
const PHYSICS = "0199a000-0009-7000-8000-000000000002";
const OFFERING = "0199a000-000c-7000-8000-000000000001";

const detail: PersonDetail = {
  id: PERSON,
  firstName: "بهرام",
  lastName: "شریفی",
  gender: "male",
  externalRef: null,
  status: "active",
  kind: "staff",
  student: null,
  staff: { staffProfileId: "0199a000-0003-7000-8000-000000000001", employeeNumber: null, employmentType: "full_time", schoolId: null },
  contactPhone: null,
  guardianPhone: null,
  account: null,
  enrollment: null,
  roles: [],
  teaching: [
    { teacherAssignmentId: "0199a000-0005-7000-8000-000000000001", classOfferingId: OFFERING, className: "۱۰/۱", subjectId: MATH, subjectName: "ریاضی", role: "main" },
    { teacherAssignmentId: "0199a000-0005-7000-8000-000000000002", classOfferingId: "0199a000-000c-7000-8000-000000000002", className: "۱۰/۲", subjectId: PHYSICS, subjectName: "فیزیک", role: "assistant" },
  ],
  schoolIds: [],
};

const cls: TeachingClassOption = {
  value: CLASS,
  label: "۱۰/۱ (دهم)",
  currentTermId: TERM_1,
  canCreateOffering: true,
  offerings: [{ id: OFFERING, subjectId: MATH, subjectName: "ریاضی", termId: TERM_1, termName: "نوبت اول", mainTeacher: { staffProfileId: "x", name: "مریم رضایی" } }],
};
const subjects = [
  { value: MATH, label: "ریاضی" },
  { value: PHYSICS, label: "فیزیک" },
];
const options: TeachingFormOptions = { classes: [cls], subjects };

const buttons = (html: string) => html.match(/<button/g)?.length ?? 0;

describe("«تدریس» section on a colleague's page", () => {
  it("with the teacher-assignment permission: the list (درس · کلاس · نقش), «پایان تدریس» per row and one «افزودن تدریس» action (outline)", () => {
    const html = renderToStaticMarkup(createElement(TeachingCard, { detail, canTeaching: true, options }));
    expect(html).toContain("تدریس");
    expect(html).toContain("ریاضی · <bdi>۱۰/۱</bdi>");
    expect(html).toContain("دبیر اصلی");
    expect(html).toContain("دبیر کمکی");
    expect(html.match(/پایان تدریس/g)?.length).toBe(2);
    expect(html).toContain("افزودن تدریس");
    expect(buttons(html)).toBe(3);
    // The dialog is closed: none of its pickers is on the page yet.
    expect(html).not.toContain("<select");
  });

  it("without the permission the same list is read-only — no «افزودن تدریس», no «پایان تدریس», no control at all", () => {
    const html = renderToStaticMarkup(createElement(TeachingCard, { detail, canTeaching: false, options: null }));
    expect(html).toContain("ریاضی · <bdi>۱۰/۱</bdi>");
    expect(html).not.toContain("افزودن تدریس");
    expect(html).not.toContain("پایان تدریس");
    expect(buttons(html)).toBe(0);
  });

  it("a colleague who teaches nothing: the empty state names it; the action is still offered to a permitted caller", () => {
    const html = renderToStaticMarkup(createElement(TeachingCard, { detail: { ...detail, teaching: [] }, canTeaching: true, options }));
    expect(html).toContain("هنوز درسی به این همکار سپرده نشده است.");
    expect(html).toContain("افزودن تدریس");
  });

  it("the «درس» picker: the class's offerings with their main teacher, then the درس‌ها it lacks in the current نوبت (only for a caller who may define offerings)", () => {
    expect(subjectPickOptions(cls, subjects)).toEqual([
      { value: `o:${OFFERING}`, label: "ریاضی (دبیر فعلی: مریم رضایی)", group: "درس‌های این کلاس" },
      { value: `s:${PHYSICS}`, label: "فیزیک (تازه)", group: "درس تازه برای این کلاس" },
    ]);
    expect(subjectPickOptions({ ...cls, canCreateOffering: false }, subjects).map((o) => o.value)).toEqual([`o:${OFFERING}`]);
    // Two نوبت‌ها: the نوبت is named; a درس offered only in the OTHER نوبت is still new for the current one.
    const twoTerms = { ...cls, offerings: [...cls.offerings, { id: "o2", subjectId: PHYSICS, subjectName: "فیزیک", termId: TERM_2, termName: "نوبت دوم", mainTeacher: null }] };
    expect(subjectPickOptions(twoTerms, subjects).map((o) => o.label)).toEqual(["ریاضی — نوبت اول (دبیر فعلی: مریم رضایی)", "فیزیک — نوبت دوم (بدون دبیر)", "فیزیک (تازه)"]);
    expect(subjectPickOptions(undefined, subjects)).toEqual([]);
  });

  it("the action's strict input: class required, role defaults to «دبیر اصلی», an empty درس pick reads as missing, no stray keys", () => {
    const ok = AssignTeachingInput.parse({ personId: PERSON, classGroupId: CLASS, classOfferingId: OFFERING });
    expect(ok).toMatchObject({ role: "main", replaceMain: false, classOfferingId: OFFERING });
    expect(AssignTeachingInput.parse({ personId: PERSON, classGroupId: CLASS, classOfferingId: "", subjectId: PHYSICS }).classOfferingId).toBeUndefined();
    const noClass = AssignTeachingInput.safeParse({ personId: PERSON, classGroupId: "" });
    expect(noClass.error?.issues[0].message).toBe("کلاس را انتخاب کنید.");
    expect(AssignTeachingInput.safeParse({ personId: PERSON, classGroupId: CLASS, role: "principal" }).success).toBe(false);
    expect(AssignTeachingInput.safeParse({ personId: PERSON, classGroupId: CLASS, organizationId: CLASS }).success).toBe(false);
  });
});
