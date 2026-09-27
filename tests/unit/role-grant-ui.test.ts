// Owner, 2026-09-27: on the staff pages a colleague's roles are DISPLAY-ONLY — nobody changes a role «وسط کار» from
// /admin/staff, the school hub's staff rows or the person page; «مدیر مدرسه» / «معاون» are granted and revoked on
// /admin/roles alone. Rendered statically and inspected as strings: the staff row, the person page's roles card and
// the new-colleague form carry no role control at all (no select, no «لغو», no «افزودن»), while the one grant door
// — «معاون جدید» / «نقش جدید» on /admin/roles — offers exactly the caller's options (`grantRoleForm`).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PersonDetail, StaffListRow } from "@/lib/admin/people";
import type { SelectOption } from "@/lib/admin/defineResource";
import type { RoleGrantOptions } from "@/modules/iam/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
// The server actions pull in the whole server stack (db, session); nothing here is submitted.
vi.mock("@/lib/admin/people-actions", () => {
  const never = async () => ({ ok: false, code: "INTERNAL", message: "" });
  return { assignRoleAction: never, revokeRoleAction: never, endTeachingAction: never, assignTeachingAction: never, createAccountAction: never, placeStudentAction: never, resetPasswordAction: never, unlockAccountAction: never, createStaffAction: never, updateStaffAction: never };
});
vi.mock("@/lib/admin/actions", () => ({ adminResourceMutate: async () => ({ ok: false, code: "INTERNAL", message: "" }) }));

const { AssignRoleInput, CreateStaffInput } = await import("@/lib/admin/people-dto");
const { StaffRow } = await import("@/components/admin/PeopleRows");
const { RolesCard } = await import("@/components/admin/PersonPanels");
const { StaffForm } = await import("@/components/admin/StaffForm");
const { GrantRoleButton } = await import("@/components/admin/GrantRoleButton");
const { grantRoleForm, missingPicks } = await import("@/components/admin/grant-role-form");

const SCHOOL_A = "0199a000-0001-7000-8000-00000000000a";
const SCHOOL_B = "0199a000-0001-7000-8000-00000000000b";
const PERSON = "0199a000-0002-7000-8000-000000000001";

/** No control of any kind: the markup is text, chips and links only. */
const CONTROLS = ["<select", "<button", "<input", "<form", "<textarea"];

const staffRow: StaffListRow = {
  personId: PERSON,
  firstName: "سارا",
  lastName: "کاظمی",
  employeeNumber: null,
  loginIdentifier: "+989127200004",
  mustChangePassword: false,
  accountStatus: "active",
  roles: ["معاون — دبیرستان دوم"],
  teaching: 2,
};

const detail: PersonDetail = {
  id: PERSON,
  firstName: "سارا",
  lastName: "کاظمی",
  gender: "female",
  externalRef: null,
  status: "active",
  kind: "staff",
  student: null,
  staff: { staffProfileId: "0199a000-0003-7000-8000-000000000001", employeeNumber: null, employmentType: "full_time", schoolId: SCHOOL_A },
  contactPhone: "+989127200004",
  guardianPhone: null,
  account: null,
  enrollment: null,
  roles: [
    { roleAssignmentId: "0199a000-0004-7000-8000-000000000001", roleCode: "vice_principal", roleName: "معاون", scopeType: "school", schoolId: SCHOOL_A, schoolName: "دبیرستان دوم", sourceType: "manual" },
    { roleAssignmentId: "0199a000-0004-7000-8000-000000000002", roleCode: "school_principal", roleName: "مدیر مدرسه", scopeType: "school", schoolId: SCHOOL_B, schoolName: "دبیرستان سوم", sourceType: "manual" },
  ],
  teaching: [{ teacherAssignmentId: "0199a000-0005-7000-8000-000000000001", classOfferingId: "0199a000-0006-7000-8000-000000000001", className: "۱۰/۱", subjectId: "0199a000-0007-7000-8000-000000000001", subjectName: "ریاضی", role: "main" }],
  schoolIds: [SCHOOL_A],
};

/** Every capability a school manager holds — the card must STILL offer no role control. */
const allCaps = { canReset: true, canUnlock: true, canWritePerson: true, canEnroll: true, canRoles: true, canTeaching: true };

describe("staff pages: roles are display-only", () => {
  it("the staff row (/admin/staff and the school hub) names the roles as text and carries no control", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(StaffRow, { row: staffRow })));
    expect(html).toContain("معاون — دبیرستان دوم");
    for (const c of CONTROLS) expect(html, c).not.toContain(c);
  });

  it("the person page's roles card shows every manager role as a chip — no picker, no «افزودن», no «لغو» — even for a caller who may manage roles", () => {
    const html = renderToStaticMarkup(createElement(RolesCard, { detail, caps: allCaps }));
    expect(html).toContain("معاون — دبیرستان دوم");
    expect(html).toContain("مدیر مدرسه — دبیرستان سوم");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("افزودن");
    expect(html).not.toMatch(/>\s*لغو\s*</); // no «لغو» control (the hint below only SAYS where roles are revoked)
    // The one pointer to where roles ARE changed, for a caller who can change them.
    expect(html).toContain('href="/admin/roles"');
    // Teaching is not a manager role: it has its own section (tests/unit/teaching-card.test.ts), none of it here.
    expect(html).not.toContain("پایان تدریس");
    expect(html).not.toContain("<button");
  });

  it("without the role permission the card points nowhere, and without the teaching permission it is pure text", () => {
    const html = renderToStaticMarkup(createElement(RolesCard, { detail, caps: { ...allCaps, canRoles: false, canTeaching: false } }));
    expect(html).not.toContain("/admin/roles");
    for (const c of CONTROLS) expect(html, c).not.toContain(c);
  });

  it("the new-colleague form asks for no manager role (roles are given afterwards, on /admin/roles)", () => {
    // Two schools, so the «مدرسهٴ اصلی» picker IS rendered — the only select on the form besides جنسیت / نوع همکاری.
    const html = renderToStaticMarkup(createElement(StaffForm, { schools: [{ value: SCHOOL_A, label: "دبیرستان دوم" }, { value: SCHOOL_B, label: "دبیرستان سوم" }] }));
    expect(html).toContain("ثبت همکار");
    expect(html).toContain("مدرسهٴ اصلی");
    expect(html).not.toContain("نقش مدیریتی");
    expect(html).not.toContain("افزودن نقش");
    expect(html).not.toContain('aria-label="نقش"');
    expect(html).not.toContain("مدرسهٴ نقش");
    expect(html.match(/<select/g)?.length).toBe(3);
  });

  it("the server agrees: the new-colleague action's strict input REFUSES a `roles` key — a hand-made request cannot grant a role through the staff page", () => {
    const colleague = { firstName: "حسین", lastName: "محمدی", phone: "09127200010", schoolId: SCHOOL_A };
    expect(CreateStaffInput.safeParse(colleague).success).toBe(true);
    const withRole = CreateStaffInput.safeParse({ ...colleague, roles: [{ roleCode: "vice_principal", schoolId: SCHOOL_A }] });
    expect(withRole.success).toBe(false);
    expect(withRole.error?.issues.map((i) => i.code)).toContain("unrecognized_keys");
    // The one request path that grants a manager role (/admin/roles): its enum admits only the manual manager codes (a
    // derived `teacher` never), and the service still refuses `org_admin` to everyone (tests/int/admin-scope N1/V).
    expect(AssignRoleInput.safeParse({ personId: PERSON, roleCode: "vice_principal", schoolId: SCHOOL_A }).success).toBe(true);
    expect(AssignRoleInput.safeParse({ personId: PERSON, roleCode: "teacher", schoolId: SCHOOL_A }).success).toBe(false);
  });
});

describe("/admin/roles: the one grant door («معاون جدید» / «نقش جدید»)", () => {
  const schools: SelectOption[] = [
    { value: SCHOOL_A, label: "دبیرستان دوم" },
    { value: SCHOOL_B, label: "دبیرستان سوم" },
  ];
  const people: SelectOption[] = [
    { value: PERSON, label: "سارا کاظمی" },
    { value: "0199a000-0002-7000-8000-000000000002", label: "حسین محمدی" },
  ];
  const names = (form: ReturnType<typeof grantRoleForm>) => form.shown.map((f) => f.name);

  it("a school manager of ONE school (principal or vice principal): «معاون جدید», only the colleague is asked — role and school are settled", () => {
    const grant: RoleGrantOptions<SelectOption> = { roles: ["vice_principal"], schools: [schools[0]] };
    const form = grantRoleForm(grant, people);
    expect(form.title).toBe("معاون جدید");
    expect(names(form)).toEqual(["personId"]);
    expect(form.initial).toEqual({ roleCode: "vice_principal", schoolId: SCHOOL_A });
    expect(form.options.roles).toEqual([{ value: "vice_principal", label: "معاون" }]);
    // Nothing chosen yet → the colleague is the missing pick, in the codebase's «… را انتخاب کنید.» wording.
    expect(missingPicks(form, form.initial)).toEqual({ personId: "همکار را انتخاب کنید." });
    expect(missingPicks(form, { ...form.initial, personId: PERSON })).toEqual({});
  });

  it("a school manager of TWO schools picks the school too — only among their own schools", () => {
    const form = grantRoleForm({ roles: ["vice_principal"], schools }, people);
    expect(names(form)).toEqual(["personId", "schoolId"]);
    expect(form.options.schools).toEqual(schools);
  });

  it("the organization admin: «نقش جدید» with the role picker (principal or vice principal) — «مدیر سازمان» is never an option", () => {
    const form = grantRoleForm({ roles: ["school_principal", "vice_principal"], schools }, people);
    expect(form.title).toBe("نقش جدید");
    expect(names(form)).toEqual(["personId", "roleCode", "schoolId"]);
    expect(form.options.roles.map((o) => o.value)).toEqual(["school_principal", "vice_principal"]);
    expect(form.options.roles.map((o) => o.value)).not.toContain("org_admin");
  });

  it("closed, the page shows one primary button named after what it grants; the dialog renders nothing until it opens", () => {
    const html = renderToStaticMarkup(createElement(GrantRoleButton, { roleGrant: { roles: ["vice_principal"], schools: [schools[0]] }, candidates: people }));
    expect(html).toContain("معاون جدید");
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).not.toContain("سارا کاظمی");
  });
});
