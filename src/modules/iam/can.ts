// Authorization = "does any of the caller's role assignments carry `permission` at a scope that contains the
// target?". `canPure` is the decision (unit-tested, no I/O); `resolveScopeChain` turns a target reference into
// its ancestor chain with ONE query under RLS (so a ref from another tenant simply resolves to nothing);
// `can` glues them. Module code never touches the DB boundary directly — it receives `tx`.
import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { branch, classGroup, classOffering, school } from "@/modules/tenancy/schema";
import { studentProfile } from "./schema";
import { IMPLICIT_PERMISSIONS, type Permission, type ScopeRef, type ScopeType } from "./permissions";

export interface Assignment {
  roleCode: string;
  roleId: string;
  scopeType: ScopeType;
  /** `role_assignment.scope_id` (generated): the scoped entity, or the organization id for org-wide roles. */
  scopeId: string | null;
  permissions: readonly string[];
}

export interface ScopeNode {
  scopeType: ScopeType;
  id: string;
}

/** The target itself followed by its ancestors, always ending with `{ organization, orgId }`. */
export type ScopeChain = readonly ScopeNode[];

/**
 * True when some assignment grants `permission` and its scope is the target or one of the target's ancestors.
 * `organization`-scoped assignments match every chain (chains are always inside the caller's organization).
 * Revocation / validity windows are NOT decided here — the assignments passed in must already be the valid ones.
 */
export function canPure(assignments: readonly Assignment[], chain: ScopeChain, permission: Permission): boolean {
  if (chain.length === 0) return false;
  for (const a of assignments) {
    if (!a.permissions.includes(permission)) continue;
    if (a.scopeType === "organization") return true;
    if (a.scopeId === null) continue;
    for (const node of chain) {
      if (node.scopeType === a.scopeType && node.id === a.scopeId) return true;
    }
  }
  return false;
}

export function organizationChain(orgId: string): ScopeChain {
  return [{ scopeType: "organization", id: orgId }];
}

/**
 * class_offering → class_group → branch → school → organization
 * class_group → branch → school → organization · branch → school → organization · school → organization
 * student → organization (family joins the chain in phase 2) · family → organization (no table yet).
 * Returns null when the referenced row is not visible in this tenant (unknown id or another organization).
 */
export async function resolveScopeChain(tx: Tx, orgId: string, ref: ScopeRef): Promise<ScopeChain | null> {
  const org: ScopeNode = { scopeType: "organization", id: orgId };
  switch (ref.scopeType) {
    case "class_offering": {
      const rows = await tx
        .select({ classGroupId: classOffering.classGroupId, branchId: classGroup.branchId, schoolId: branch.schoolId })
        .from(classOffering)
        .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
        .innerJoin(branch, eq(branch.id, classGroup.branchId))
        .where(eq(classOffering.id, ref.id))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return [
        { scopeType: "class_offering", id: ref.id },
        { scopeType: "class_group", id: r.classGroupId },
        { scopeType: "branch", id: r.branchId },
        { scopeType: "school", id: r.schoolId },
        org,
      ];
    }
    case "class_group": {
      const rows = await tx
        .select({ branchId: classGroup.branchId, schoolId: branch.schoolId })
        .from(classGroup)
        .innerJoin(branch, eq(branch.id, classGroup.branchId))
        .where(eq(classGroup.id, ref.id))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return [
        { scopeType: "class_group", id: ref.id },
        { scopeType: "branch", id: r.branchId },
        { scopeType: "school", id: r.schoolId },
        org,
      ];
    }
    case "branch": {
      const rows = await tx.select({ schoolId: branch.schoolId }).from(branch).where(eq(branch.id, ref.id)).limit(1);
      const r = rows[0];
      if (!r) return null;
      return [{ scopeType: "branch", id: ref.id }, { scopeType: "school", id: r.schoolId }, org];
    }
    case "school": {
      const rows = await tx.select({ id: school.id }).from(school).where(eq(school.id, ref.id)).limit(1);
      if (!rows[0]) return null;
      return [{ scopeType: "school", id: ref.id }, org];
    }
    case "student": {
      const rows = await tx.select({ id: studentProfile.id }).from(studentProfile).where(eq(studentProfile.id, ref.id)).limit(1);
      if (!rows[0]) return null;
      return [{ scopeType: "student", id: ref.id }, org];
    }
    case "family":
      // No family table before phase 2: an assignment scoped to this family id is the only thing that can match.
      return [{ scopeType: "family", id: ref.id }, org];
  }
}

export interface CanContext {
  orgId: string;
  assignments: readonly Assignment[];
}

/** `ref` undefined = organization-level check. Runs inside the caller's `withTenant` transaction. */
export async function can(tx: Tx, ctx: CanContext, permission: Permission, ref?: ScopeRef): Promise<boolean> {
  if (IMPLICIT_PERMISSIONS.includes(permission)) return true;
  const chain = ref ? await resolveScopeChain(tx, ctx.orgId, ref) : organizationChain(ctx.orgId);
  if (!chain) return false;
  return canPure(ctx.assignments, chain, permission);
}

/**
 * "Does the caller hold `permission` at ANY scope?" — the check for personal-inbox operations (my کارتابل, my
 * notifications, items I can already see). The row filter (`inbox_entry.person_id = ctx.personId`,
 * `canViewWorkItem`) is the real boundary there; a teacher's offering-scoped or a student's profile-scoped role
 * must not fail an organization-level check. Never use it for operations that target a scope (assign to a class).
 */
export function canAtAnyScope(assignments: readonly Assignment[], permission: Permission): boolean {
  if (IMPLICIT_PERMISSIONS.includes(permission)) return true;
  return assignments.some((a) => a.permissions.includes(permission));
}

/** Scope types that see "everything below them" — an admin/principal/vice-principal hat, never a teacher's or student's. */
export const BROAD_SCOPE_TYPES: readonly ScopeType[] = ["organization", "school", "branch"];

/** Holds `permission` through a broad (organization/school/branch) assignment — phase-1 "sees all items of the org". */
export function canBroadly(assignments: readonly Assignment[], permission: Permission): boolean {
  return assignments.some((a) => BROAD_SCOPE_TYPES.includes(a.scopeType) && a.permissions.includes(permission));
}

/**
 * The organization admin hat: an ORGANIZATION-scoped assignment carrying `iam.admin.access` — the pure half of
 * `getAdminScope` (`{ kind: "organization" }`), for surfaces that must not query: the Home tile registry, the admin
 * sub-navigation and the «بیشتر» rows hide the organization-only entries («راه‌اندازی مدرسه») from principals and
 * vice principals with it. Pages still decide from the database-derived scope (`adminOverviewQuery().scope`).
 */
export function isOrganizationAdmin(assignments: readonly Assignment[]): boolean {
  return assignments.some((a) => a.scopeType === "organization" && a.permissions.includes("iam.admin.access"));
}
