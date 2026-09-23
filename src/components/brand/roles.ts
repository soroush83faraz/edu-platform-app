import type { Assignment } from "@/modules/iam/can";

/**
 * The hat the top-start emblem speaks for. Derived from the session's role assignments alone — the same data
 * `navRoleFor` / `getAdminScope` read, so the shell pays no extra query. Finer than `NavRole`: the owner wants
 * the emblem to say WHICH admin you are, not just «admin».
 */
export type RoleKey = "org_admin" | "principal" | "vice" | "teacher" | "student" | "guardian";

/** Highest first — a multi-hat person is introduced by `hats[0]` and the rest ride in the tooltip. */
export const ROLE_ORDER: readonly RoleKey[] = ["org_admin", "principal", "vice", "teacher", "student", "guardian"];

export const ROLE_LABELS: Record<RoleKey, string> = {
  org_admin: "مدیر سازمان",
  principal: "مدیر مدرسه",
  vice: "معاون",
  teacher: "دبیر",
  student: "دانش‌آموز",
  guardian: "ولی",
};

const ADMIN_ACCESS = "iam.admin.access";

/** What the rule needs from an assignment — a structural subset of `Assignment`, so this module stays free of DB imports. */
export type RoleHatSource = Pick<Assignment, "roleCode" | "scopeType" | "permissions">;

/**
 * Every hat the person wears, highest first. The admin hats are told apart the way the rest of the product does:
 * an ORGANIZATION-scoped `iam.admin.access` is «مدیر سازمان» (`isOrganizationAdmin`), `school_principal` — or any
 * other narrower assignment carrying admin access — is «مدیر مدرسه», and `vice_principal` is «معاون», which the
 * role matrix already keeps distinct. «ولی» has no assignments before phase 2; the code is here so the mapping is
 * complete and testable. Returns `[]` for an account with no hat (the nav shows «راهنما» in that case).
 */
export function roleHatsFor(assignments: readonly RoleHatSource[]): RoleKey[] {
  const hats = new Set<RoleKey>();
  for (const a of assignments) {
    const admin = a.permissions.includes(ADMIN_ACCESS);
    if (a.roleCode === "org_admin" || (admin && a.scopeType === "organization")) hats.add("org_admin");
    else if (a.roleCode === "school_principal") hats.add("principal");
    else if (a.roleCode === "vice_principal") hats.add("vice");
    else if (admin) hats.add("principal");
    if (a.roleCode === "teacher") hats.add("teacher");
    if (a.roleCode === "student") hats.add("student");
    if (a.roleCode === "guardian") hats.add("guardian");
  }
  return ROLE_ORDER.filter((key) => hats.has(key));
}

/** The one line that names the person's hats: «مدیر مدرسه · دبیر». */
export function roleHatsLabel(hats: readonly RoleKey[]): string {
  return hats.map((key) => ROLE_LABELS[key]).join(" · ");
}
