// Owner, 2026-09-27: «معاون» (`vice_principal`) has EXACTLY the capabilities of «مدیر مدرسه» (`school_principal`),
// inside their own school. Read straight from the catalog the seed writes (scripts/catalog.ts SYSTEM_ROLES — `pnpm
// seed` makes `iam.role_permission` match it on every deploy), so neither role can drift from the other unnoticed.
// Then every pure decision that turns those permissions into reach — `canPure` over every permission and scope,
// `canManageRole` / `roleGrantOptions` (the role matrix), `resourceOpGate` (structure buttons), `homeTilesFor`
// (Home), `navRoleFor` — is run for a vice principal and a principal of the SAME school and must answer alike, and
// for ANOTHER school, the organization and a student it must answer «no» for both (negative cross-school cases).
// The database-backed half (services, NOT_FOUND vs FORBIDDEN, nothing written) is tests/int/admin-scope.test.ts.
import { describe, expect, it } from "vitest";
import { NON_MANAGER_PERMS, SYSTEM_ROLES } from "../../scripts/catalog";
import { roleHatsFor } from "@/components/brand/roles";
import { resourceOpGate, type AnyResourceDef, type ResourceOp } from "@/lib/admin/defineResource";
import { homeTilesFor, type TileHats } from "@/lib/modules-registry";
import { canAtAnyScope, canBroadly, canPure, isOrganizationAdmin, navRoleFor, organizationChain, type Assignment, type ScopeChain } from "@/modules/iam/can";
import { IMPLICIT_PERMISSIONS, PERMISSION_CODES, type Permission } from "@/modules/iam/permissions";
import { ASSIGNABLE_ROLES, canManageRole, roleGrantOptions, type AdminScope } from "@/modules/iam/service";

const ORG = "org-A";
const SCHOOL_A = "school-A";
const SCHOOL_B = "school-B";
const BRANCH_A = "branch-A";
const BRANCH_B = "branch-B";

const role = (code: string) => {
  const r = SYSTEM_ROLES.find((x) => x.code === code);
  if (!r) throw new Error(`catalog has no ${code}`);
  return r;
};
const sorted = (xs: readonly string[]) => [...xs].sort();

const PRINCIPAL = role("school_principal").permissions;
const VICE = role("vice_principal").permissions;
const at = (roleCode: string, scopeType: Assignment["scopeType"], scopeId: string): Assignment[] => [{ roleCode, roleId: `r-${roleCode}`, scopeType, scopeId, permissions: role(roleCode).permissions }];
const principalA = at("school_principal", "school", SCHOOL_A);
const viceA = at("vice_principal", "school", SCHOOL_A);

const schoolChain = (school: string): ScopeChain => [{ scopeType: "school", id: school }, { scopeType: "organization", id: ORG }];
const branchChain = (branch: string, school: string): ScopeChain => [{ scopeType: "branch", id: branch }, ...schoolChain(school)];
const offeringChain = (branch: string, school: string): ScopeChain => [{ scopeType: "class_offering", id: `off-${school}` }, { scopeType: "class_group", id: `cg-${school}` }, ...branchChain(branch, school)];
const OWN_CHAINS: Record<string, ScopeChain> = { "school A": schoolChain(SCHOOL_A), "branch A": branchChain(BRANCH_A, SCHOOL_A), "offering A": offeringChain(BRANCH_A, SCHOOL_A) };
const FOREIGN_CHAINS: Record<string, ScopeChain> = {
  "school B": schoolChain(SCHOOL_B),
  "branch B": branchChain(BRANCH_B, SCHOOL_B),
  "offering B": offeringChain(BRANCH_B, SCHOOL_B),
  organization: organizationChain(ORG),
  student: [{ scopeType: "student", id: "sp-1" }, { scopeType: "organization", id: ORG }],
};
const ROLE_PERMS: Permission[] = PERMISSION_CODES.filter((p) => !IMPLICIT_PERMISSIONS.includes(p));
/** What a manager role can carry: everything but the counselor's own writes and the teacher's report (2026-10-13). */
const MANAGER_PERMS: Permission[] = ROLE_PERMS.filter((p) => !NON_MANAGER_PERMS.includes(p));

describe("the catalog: a vice principal is a principal of their school", () => {
  it("vice_principal and school_principal carry the same permission set — every MANAGER permission (the counselor's writes and the teacher's report excepted)", () => {
    expect(sorted(VICE)).toEqual(sorted(PRINCIPAL));
    expect(sorted(PRINCIPAL)).toEqual(sorted(MANAGER_PERMS));
    expect(new Set(VICE).size).toBe(VICE.length);
    // «مشاوره» (owner, 2026-10-13): both READ the file and receive referrals; neither writes in the counselor's name.
    for (const p of ["counseling.case.read", "counseling.referral.receive"] as Permission[]) expect(PRINCIPAL).toContain(p);
    for (const p of NON_MANAGER_PERMS) {
      expect(PRINCIPAL, p).not.toContain(p);
      expect(role("org_admin").permissions, p).not.toContain(p);
    }
  });

  it("both stay SCHOOL roles: never organization-scoped; the organization admin alone is", () => {
    expect(role("school_principal").allowedScopeTypes).toEqual(["school"]);
    expect(role("vice_principal").allowedScopeTypes).toContain("school");
    for (const code of ["school_principal", "vice_principal"]) expect(role(code).allowedScopeTypes).not.toContain("organization");
    expect(role("org_admin").allowedScopeTypes).toEqual(["organization"]);
  });

  it("nobody else was widened: teacher, student and guardian hold no admin, role, account, structure or import permission", () => {
    const managerOnly: Permission[] = ["iam.admin.access", "iam.role_assignment.write", "iam.person.write", "iam.account.reset_password", "iam.account.unlock", "tenancy.structure.write", "integ.import.write", "academic.enrollment.write", "academic.teacher_assignment.write"];
    for (const code of ["teacher", "student", "guardian_full"]) {
      expect(role(code).permissions.filter((p) => managerOnly.includes(p)), code).toEqual([]);
    }
  });
});

describe("canPure over the whole catalog: same answer for the vice principal and the principal of school A", () => {
  it("inside school A (the school, its branch, a class offering) both hold EVERY manager permission — and none of the counselor's or teacher's own", () => {
    for (const [name, chain] of Object.entries(OWN_CHAINS)) {
      for (const p of MANAGER_PERMS) {
        expect(canPure(viceA, chain, p), `vice · ${name} · ${p}`).toBe(true);
        expect(canPure(principalA, chain, p), `principal · ${name} · ${p}`).toBe(true);
      }
      for (const p of NON_MANAGER_PERMS) {
        expect(canPure(viceA, chain, p), `vice · ${name} · ${p}`).toBe(false);
        expect(canPure(principalA, chain, p), `principal · ${name} · ${p}`).toBe(false);
      }
    }
  });

  it("NEGATIVE: school B, its branch and classes, the organization level and a student chain — NO permission for either", () => {
    for (const [name, chain] of Object.entries(FOREIGN_CHAINS)) {
      for (const p of ROLE_PERMS) {
        expect(canPure(viceA, chain, p), `vice · ${name} · ${p}`).toBe(false);
        expect(canPure(principalA, chain, p), `principal · ${name} · ${p}`).toBe(false);
      }
    }
  });

  it("the broad/any-scope checks agree too, and neither is ever an organization admin", () => {
    for (const p of ROLE_PERMS) {
      expect(canAtAnyScope(viceA, p)).toBe(canAtAnyScope(principalA, p));
      expect(canBroadly(viceA, p)).toBe(canBroadly(principalA, p));
    }
    expect(isOrganizationAdmin(viceA)).toBe(false);
    expect(isOrganizationAdmin(principalA)).toBe(false);
    expect(navRoleFor(viceA)).toBe("admin");
    expect(navRoleFor(principalA)).toBe("admin");
  });

  it("the title is the only difference: the emblem still says «معاون» (a label, not a capability)", () => {
    expect(roleHatsFor(viceA)).toEqual(["vice"]);
    expect(roleHatsFor(principalA)).toEqual(["principal"]);
  });
});

describe("the role matrix (UI mirror of assignRole / revokeRoleAssignment)", () => {
  const schools = [
    { value: SCHOOL_A, label: "مدرسهٴ الف" },
    { value: SCHOOL_B, label: "مدرسهٴ ب" },
  ];
  const orgAdmin = at("org_admin", "organization", ORG);

  it("canManageRole: the vice principal answers exactly like the principal, for every role and every school", () => {
    for (const code of [...ASSIGNABLE_ROLES, "student", "teacher", "guardian_full"]) {
      for (const schoolId of [SCHOOL_A, SCHOOL_B, null]) {
        expect(canManageRole(viceA, code, schoolId), `${code} @ ${schoolId}`).toBe(canManageRole(principalA, code, schoolId));
      }
    }
  });

  it("a school manager appoints/revokes vice principals of THEIR school only — never a principal, never an organization admin, never at school B", () => {
    for (const manager of [viceA, principalA]) {
      expect(canManageRole(manager, "vice_principal", SCHOOL_A)).toBe(true);
      expect(canManageRole(manager, "vice_principal", SCHOOL_B)).toBe(false);
      expect(canManageRole(manager, "vice_principal", null)).toBe(false);
      expect(canManageRole(manager, "school_principal", SCHOOL_A)).toBe(false);
      expect(canManageRole(manager, "school_principal", SCHOOL_B)).toBe(false);
      expect(canManageRole(manager, "org_admin", null)).toBe(false);
      // «مشاور» (2026-10-13) is granted by the very people who grant «معاون», at the same schools.
      expect(canManageRole(manager, "counselor", SCHOOL_A)).toBe(true);
      expect(canManageRole(manager, "counselor", SCHOOL_B)).toBe(false);
      expect(canManageRole(manager, "counselor", null)).toBe(false);
      expect(roleGrantOptions(manager, schools)).toEqual({ roles: ["vice_principal", "counselor"], schools: [schools[0]] });
    }
    // The organization admin still appoints principals, vice principals and counselors everywhere; «مدیر سازمان» nobody.
    expect(roleGrantOptions(orgAdmin, schools)).toEqual({ roles: ["school_principal", "vice_principal", "counselor"], schools });
    expect(canManageRole(orgAdmin, "counselor", SCHOOL_B)).toBe(true);
    expect(canManageRole(orgAdmin, "org_admin", null)).toBe(false);
  });

  it("a vice principal held at a BRANCH (an allowed scope type no screen grants) manages nothing and reaches no school but its own", () => {
    const viceAtBranch = at("vice_principal", "branch", BRANCH_A);
    for (const code of [...ASSIGNABLE_ROLES]) for (const schoolId of [SCHOOL_A, SCHOOL_B, null]) expect(canManageRole(viceAtBranch, code, schoolId)).toBe(false);
    expect(roleGrantOptions(viceAtBranch, schools)).toEqual({ roles: [], schools: [] });
    for (const p of ROLE_PERMS) {
      expect(canPure(viceAtBranch, schoolChain(SCHOOL_B), p)).toBe(false);
      expect(canPure(viceAtBranch, branchChain(BRANCH_B, SCHOOL_B), p)).toBe(false);
    }
  });
});

describe("the admin surfaces read permissions, so the vice principal sees the principal's", () => {
  const schoolScope: AdminScope = { kind: "school", schoolIds: [SCHOOL_A] };
  const def = (over: Partial<AnyResourceDef>): AnyResourceDef => ({ key: "x", labelFa: "مدرسه", labelFaPlural: "x", permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" }, columns: [], schema: undefined as never, formFields: [], list: undefined as never, create: undefined as never, update: undefined as never, ...over });
  const resources = {
    classes: def({}),
    schools: def({ createNeedsOrgScope: true }),
    subjects: def({ orgOnly: true }),
    offerings: def({ permission: { read: "tenancy.structure.read", write: "academic.teacher_assignment.write", create: "tenancy.structure.write" } }),
  };

  it("resourceOpGate: every resource × op gives the vice principal the principal's verdict — schools/درس‌ها stay organization-only for both", () => {
    for (const [name, r] of Object.entries(resources)) {
      for (const op of ["create", "update", "archive"] as ResourceOp[]) {
        expect(resourceOpGate(r, op, viceA, schoolScope), `${name} ${op}`).toEqual(resourceOpGate(r, op, principalA, schoolScope));
      }
    }
    expect(resourceOpGate(resources.offerings, "create", viceA, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(resources.classes, "create", viceA, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(resources.schools, "update", viceA, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(resources.schools, "create", viceA, schoolScope).ok).toBe(false);
    expect(resourceOpGate(resources.subjects, "update", viceA, schoolScope).ok).toBe(false);
  });

  it("Home: a vice principal of ONE school gets the principal's tiles, «زنگ‌بندی» of that school included", () => {
    const hats: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school", singleSchoolId: SCHOOL_A };
    const has = (perms: readonly string[]) => (p: Permission) => perms.includes(p);
    const vice = homeTilesFor(hats, has(VICE));
    expect(vice).toEqual(homeTilesFor(hats, has(PRINCIPAL)));
    expect(vice.map((t) => t.code)).toEqual(["inbox", "admin-attendance", "schools", "periods"]);
    expect(vice.find((t) => t.code === "periods")?.href).toBe(`/admin/schools/${SCHOOL_A}/periods`);
  });
});

describe("«مشاور» (counselor, owner 2026-10-13): a school role that reads and writes the counseling file — and nothing broad", () => {
  const counselorA = at("counselor", "school", SCHOOL_A);
  const COUNSELOR = role("counselor").permissions;

  it("school-scoped only; the file's read and the counselor's own writes; NO workspace permission (a school-scoped one would be BROAD)", () => {
    expect(role("counselor").allowedScopeTypes).toEqual(["school"]);
    for (const p of ["counseling.case.read", "counseling.note.write", "counseling.referral.create"] as Permission[]) expect(COUNSELOR).toContain(p);
    expect(COUNSELOR.filter((p) => p.startsWith("workspace."))).toEqual([]);
    expect(COUNSELOR).not.toContain("iam.admin.access");
    expect(COUNSELOR).not.toContain("counseling.referral.receive");
    for (const p of PERMISSION_CODES.filter((x) => x.startsWith("workspace."))) expect(canBroadly(counselorA, p), p).toBe(false);
    expect(isOrganizationAdmin(counselorA)).toBe(false);
    expect(navRoleFor(counselorA)).toBe(null);
    expect(roleHatsFor(counselorA)).toEqual(["counselor"]);
  });

  it("their school's chains only: school B, the organization level and a student chain get nothing", () => {
    for (const p of COUNSELOR) {
      for (const [name, chain] of Object.entries(OWN_CHAINS)) expect(canPure(counselorA, chain, p), `${name} · ${p}`).toBe(true);
      for (const [name, chain] of Object.entries(FOREIGN_CHAINS)) expect(canPure(counselorA, chain, p), `${name} · ${p}`).toBe(false);
    }
  });

  it("teachers report to the counselor but read no file; students and guardians hold no counseling permission at all", () => {
    expect(role("teacher").permissions).toContain("counseling.teacher_report.write");
    for (const p of ["counseling.case.read", "counseling.note.write", "counseling.referral.create", "counseling.referral.receive"] as Permission[]) {
      expect(role("teacher").permissions, p).not.toContain(p);
    }
    for (const code of ["student", "guardian_full"]) expect(role(code).permissions.filter((p) => p.startsWith("counseling.")), code).toEqual([]);
  });
});
