// Table-driven tests for the pure authorization decision. Scenarios A–E mirror architecture doc 03:
//   A  Sara (student) with mother/father as guardians scoped to her student_profile
//   B  Karimi teaches ریاضی in two offerings
//   C  a counselor assigned to 40 students
//   D  a principal of ONE school (not the other one)
//   E  Mousavi wears three hats (vice principal @ boys school, teacher @ one offering, guardian of one student)
import { describe, expect, it } from "vitest";
import { canPure, organizationChain, type Assignment, type ScopeChain } from "@/modules/iam/can";

const ORG = "org-A";
const SCHOOL_G = "school-girls";
const SCHOOL_B = "school-boys";
const BRANCH_G = "branch-girls";
const BRANCH_B = "branch-boys";
const CG_10_1 = "cg-10-1";
const CG_10_2 = "cg-10-2";
const CG_11_3 = "cg-11-3";
const OFF_MATH_10_1 = "off-math-10-1";
const OFF_MATH_10_2 = "off-math-10-2";
const OFF_PHYS_10_1 = "off-phys-10-1";
const OFF_MATH_11_3 = "off-math-11-3";
const SARA = "student-sara";
const OTHER_STUDENT = "student-other";

const TEACHER_PERMS = [
  "workspace.work_item.read",
  "workspace.work_item.create",
  "workspace.work_item.update",
  "workspace.work_item.comment",
  "workspace.work_item.assign_class",
  "notif.notification.read",
  "iam.person.read",
];
const GUARDIAN_PERMS = ["workspace.work_item.read", "workspace.work_item.comment", "notif.notification.read"];
const STUDENT_PERMS = ["workspace.work_item.read", "workspace.work_item.update", "workspace.work_item.comment", "notif.notification.read"];
const VICE_PERMS = ["tenancy.structure.read", "iam.person.read", ...TEACHER_PERMS.filter((p) => p.startsWith("workspace."))];
const PRINCIPAL_PERMS = [...VICE_PERMS, "tenancy.structure.write", "iam.person.write", "iam.role_assignment.write"];
const COUNSELOR_PERMS = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.comment", "iam.person.read"];

const a = (roleCode: string, scopeType: Assignment["scopeType"], scopeId: string, permissions: string[]): Assignment => ({
  roleCode,
  roleId: `role-${roleCode}`,
  scopeType,
  scopeId,
  permissions,
});

const chainOffering = (offering: string, cg: string, branch: string, school: string): ScopeChain => [
  { scopeType: "class_offering", id: offering },
  { scopeType: "class_group", id: cg },
  { scopeType: "branch", id: branch },
  { scopeType: "school", id: school },
  { scopeType: "organization", id: ORG },
];
const chainStudent = (id: string): ScopeChain => [
  { scopeType: "student", id },
  { scopeType: "organization", id: ORG },
];
const chainSchool = (id: string): ScopeChain => [
  { scopeType: "school", id },
  { scopeType: "organization", id: ORG },
];
const chainBranch = (id: string, school: string): ScopeChain => [
  { scopeType: "branch", id },
  { scopeType: "school", id: school },
  { scopeType: "organization", id: ORG },
];

describe("canPure — scenario A: Sara, mother, father", () => {
  const sara = [a("student", "organization", ORG, STUDENT_PERMS)];
  const mother = [a("guardian_full", "student", SARA, GUARDIAN_PERMS)];
  const father = [a("guardian_full", "student", SARA, GUARDIAN_PERMS)];

  it("both guardians may read/comment on Sara's items, not on another student's", () => {
    for (const g of [mother, father]) {
      expect(canPure(g, chainStudent(SARA), "workspace.work_item.read")).toBe(true);
      expect(canPure(g, chainStudent(SARA), "workspace.work_item.comment")).toBe(true);
      expect(canPure(g, chainStudent(OTHER_STUDENT), "workspace.work_item.read")).toBe(false);
    }
  });
  it("guardian permissions never escalate: no update/create, no org-level access", () => {
    expect(canPure(mother, chainStudent(SARA), "workspace.work_item.update")).toBe(false);
    expect(canPure(mother, chainStudent(SARA), "workspace.work_item.create")).toBe(false);
    expect(canPure(mother, organizationChain(ORG), "workspace.work_item.read")).toBe(false);
  });
  it("Sara (org-scoped student role) reads her own workspace but cannot create", () => {
    expect(canPure(sara, organizationChain(ORG), "workspace.work_item.read")).toBe(true);
    expect(canPure(sara, organizationChain(ORG), "workspace.work_item.create")).toBe(false);
  });
});

describe("canPure — scenario B: Karimi teaches ریاضی in ۱۰/۱ and ۱۰/۲", () => {
  const karimi = [
    a("teacher", "class_offering", OFF_MATH_10_1, TEACHER_PERMS),
    a("teacher", "class_offering", OFF_MATH_10_2, TEACHER_PERMS),
  ];
  it("may create items in either of his offerings", () => {
    expect(canPure(karimi, chainOffering(OFF_MATH_10_1, CG_10_1, BRANCH_G, SCHOOL_G), "workspace.work_item.create")).toBe(true);
    expect(canPure(karimi, chainOffering(OFF_MATH_10_2, CG_10_2, BRANCH_G, SCHOOL_G), "workspace.work_item.assign_class")).toBe(true);
  });
  it("physics in the SAME class, or math in another class, is out of scope", () => {
    expect(canPure(karimi, chainOffering(OFF_PHYS_10_1, CG_10_1, BRANCH_G, SCHOOL_G), "workspace.work_item.create")).toBe(false);
    expect(canPure(karimi, chainOffering(OFF_MATH_11_3, CG_11_3, BRANCH_B, SCHOOL_B), "workspace.work_item.create")).toBe(false);
  });
  it("an offering-scoped role does not grant its permissions on the parent class_group or the school", () => {
    expect(canPure(karimi, [{ scopeType: "class_group", id: CG_10_1 }, { scopeType: "organization", id: ORG }], "iam.person.read")).toBe(false);
    expect(canPure(karimi, chainSchool(SCHOOL_G), "iam.person.read")).toBe(false);
  });
});

describe("canPure — scenario C: counselor with 40 students", () => {
  const students = Array.from({ length: 40 }, (_, i) => `student-${i + 1}`);
  const counselor = students.map((s) => a("counselor", "student", s, COUNSELOR_PERMS));
  it("reaches every assigned student and none other", () => {
    for (const s of students) expect(canPure(counselor, chainStudent(s), "workspace.work_item.create")).toBe(true);
    expect(canPure(counselor, chainStudent("student-41"), "workspace.work_item.create")).toBe(false);
    expect(canPure(counselor, chainStudent(SARA), "iam.person.read")).toBe(false);
  });
});

describe("canPure — scenario D: principal of one school", () => {
  const rezaei = [a("school_principal", "school", SCHOOL_G, PRINCIPAL_PERMS)];
  it("covers everything under the girls school through the chain", () => {
    expect(canPure(rezaei, chainSchool(SCHOOL_G), "tenancy.structure.write")).toBe(true);
    expect(canPure(rezaei, chainBranch(BRANCH_G, SCHOOL_G), "iam.person.write")).toBe(true);
    expect(canPure(rezaei, chainOffering(OFF_MATH_10_1, CG_10_1, BRANCH_G, SCHOOL_G), "workspace.work_item.read")).toBe(true);
  });
  it("has nothing in the boys school and nothing at organization level", () => {
    expect(canPure(rezaei, chainSchool(SCHOOL_B), "tenancy.structure.read")).toBe(false);
    expect(canPure(rezaei, chainOffering(OFF_MATH_11_3, CG_11_3, BRANCH_B, SCHOOL_B), "workspace.work_item.read")).toBe(false);
    expect(canPure(rezaei, organizationChain(ORG), "tenancy.structure.read")).toBe(false);
    expect(canPure(rezaei, chainSchool(SCHOOL_G), "iam.admin.access")).toBe(false);
  });
});

describe("canPure — scenario E: Mousavi, three hats", () => {
  const mousavi = [
    a("vice_principal", "school", SCHOOL_B, VICE_PERMS),
    a("teacher", "class_offering", OFF_MATH_10_1, TEACHER_PERMS),
    a("guardian_full", "student", SARA, GUARDIAN_PERMS),
  ];
  it("each hat works only in its own scope", () => {
    expect(canPure(mousavi, chainBranch(BRANCH_B, SCHOOL_B), "iam.person.read")).toBe(true); // vice principal
    expect(canPure(mousavi, chainOffering(OFF_MATH_10_1, CG_10_1, BRANCH_G, SCHOOL_G), "workspace.work_item.create")).toBe(true); // teacher
    expect(canPure(mousavi, chainStudent(SARA), "workspace.work_item.comment")).toBe(true); // guardian
  });
  it("hats do not blend: teacher perms don't leak into the girls school, guardian perms don't grant create", () => {
    expect(canPure(mousavi, chainSchool(SCHOOL_G), "iam.person.read")).toBe(false);
    expect(canPure(mousavi, chainStudent(SARA), "workspace.work_item.create")).toBe(false);
    expect(canPure(mousavi, chainSchool(SCHOOL_B), "tenancy.structure.write")).toBe(false);
  });
});

describe("canPure — negatives and edge cases", () => {
  it("no assignments → false; empty chain → false", () => {
    expect(canPure([], organizationChain(ORG), "workspace.work_item.read")).toBe(false);
    expect(canPure([a("org_admin", "organization", ORG, ["iam.admin.access"])], [], "iam.admin.access")).toBe(false);
  });
  it("permission missing from the role → false even at organization scope", () => {
    const admin = [a("org_admin", "organization", ORG, ["iam.admin.access", "iam.person.read"])];
    expect(canPure(admin, chainSchool(SCHOOL_G), "iam.person.read")).toBe(true);
    expect(canPure(admin, chainSchool(SCHOOL_G), "integ.import.write")).toBe(false);
  });
  it("organization-scoped assignment matches every chain", () => {
    const admin = [a("org_admin", "organization", ORG, ["workspace.work_item.read"])];
    expect(canPure(admin, chainStudent(SARA), "workspace.work_item.read")).toBe(true);
    expect(canPure(admin, chainOffering(OFF_MATH_11_3, CG_11_3, BRANCH_B, SCHOOL_B), "workspace.work_item.read")).toBe(true);
  });
  it("same id with a different scope type does not match (ids are compared together with their type)", () => {
    const weird = [a("teacher", "class_group", OFF_MATH_10_1, TEACHER_PERMS)];
    expect(canPure(weird, chainOffering(OFF_MATH_10_1, CG_10_1, BRANCH_G, SCHOOL_G), "workspace.work_item.read")).toBe(false);
  });
  it("null scopeId on a non-organization assignment never matches", () => {
    const broken: Assignment[] = [{ roleCode: "teacher", roleId: "r", scopeType: "school", scopeId: null, permissions: TEACHER_PERMS }];
    expect(canPure(broken, chainSchool(SCHOOL_G), "workspace.work_item.read")).toBe(false);
  });
});
