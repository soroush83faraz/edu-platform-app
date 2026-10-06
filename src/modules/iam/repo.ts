// iam queries. Every function takes `tx`; whether that transaction is tenant-bound (`withTenant`) or global
// (`withoutTenant`) is stated per function — RLS makes the wrong choice return nothing, not the wrong rows.
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { organization, school } from "@/modules/tenancy/schema";
import type { Assignment } from "./can";
import type { ScopeType } from "./permissions";
import { authIdentity, organizationMembership, person, role, roleAssignment, rolePermission, userAccount, userSession } from "./schema";

export interface AccountRow {
  id: string;
  loginIdentifier: string;
  phoneE164: string | null;
  status: string;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/** The account columns every reader selects (shared with `findLiveSessionContext` in ./session). */
export const accountColumns = {
  id: userAccount.id,
  loginIdentifier: userAccount.loginIdentifier,
  phoneE164: userAccount.phoneE164,
  status: userAccount.status,
  mustChangePassword: userAccount.mustChangePassword,
  failedLoginCount: userAccount.failedLoginCount,
  lockedUntil: userAccount.lockedUntil,
};

/** Global. */
export async function findAccountByIdentifier(tx: Tx, loginIdentifier: string): Promise<AccountRow | null> {
  const rows = await tx.select(accountColumns).from(userAccount).where(eq(userAccount.loginIdentifier, loginIdentifier)).limit(1);
  return rows[0] ?? null;
}

/** Global. */
export async function findAccountById(tx: Tx, id: string): Promise<AccountRow | null> {
  const rows = await tx.select(accountColumns).from(userAccount).where(eq(userAccount.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Global. The argon2id PHC string of the password identity, or null when the account has none. */
export async function findPasswordHash(tx: Tx, userAccountId: string): Promise<string | null> {
  const rows = await tx
    .select({ secretHash: authIdentity.secretHash })
    .from(authIdentity)
    .where(and(eq(authIdentity.userAccountId, userAccountId), eq(authIdentity.provider, "password")))
    .limit(1);
  return rows[0]?.secretHash ?? null;
}

/** Global. */
export async function recordLoginFailure(tx: Tx, userAccountId: string, lock: { until?: Date; permanent?: boolean }): Promise<void> {
  await tx
    .update(userAccount)
    .set({
      failedLoginCount: sql`${userAccount.failedLoginCount} + 1`,
      ...(lock.until ? { lockedUntil: lock.until } : {}),
      ...(lock.permanent ? { status: "locked" } : {}),
    })
    .where(eq(userAccount.id, userAccountId));
}

/** Global. */
export async function recordLoginSuccess(tx: Tx, userAccountId: string): Promise<void> {
  await tx
    .update(userAccount)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` })
    .where(eq(userAccount.id, userAccountId));
}

/**
 * Global. Revokes every live session of an account — «خروج از همهٴ دستگاه‌ها», after a password change
 * (`exceptSessionId` keeps the current one) and when a person is removed (src/modules/iam/removal.ts). Lives here,
 * not in ./session, so Next-free callers (the services the seed runs under tsx) can reuse it; ./session re-exports it.
 */
export async function revokeAllForUser(tx: Tx, userAccountId: string, exceptSessionId?: string): Promise<number> {
  const rows = await tx
    .update(userSession)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(userSession.userAccountId, userAccountId),
        isNull(userSession.revokedAt),
        exceptSessionId ? sql`${userSession.id} <> ${exceptSessionId}` : undefined,
      ),
    )
    .returning({ id: userSession.id });
  return rows.length;
}

/** Global. Replaces the password hash and clears the forced-change flag in one go. */
export async function setPassword(tx: Tx, userAccountId: string, secretHash: string): Promise<void> {
  await tx
    .update(authIdentity)
    .set({ secretHash, initialPasswordEnc: null })
    .where(and(eq(authIdentity.userAccountId, userAccountId), eq(authIdentity.provider, "password")));
  await tx
    .update(userAccount)
    .set({ mustChangePassword: false, passwordChangedAt: sql`now()` })
    .where(eq(userAccount.id, userAccountId));
}

export interface MembershipRow {
  organizationId: string;
  personId: string;
  isDefaultOrg: boolean;
}

/**
 * Global transaction, login only. The caller must first bind the verified account with `tools.bindAccount(tx, id)`
 * (definePublicAction) so the additive `account_memberships` RLS policy exposes this account's memberships across
 * organizations; without it the query legitimately returns nothing. Lists the active ones — default organization
 * first, then oldest membership first.
 */
export async function listActiveMembershipsForAccount(tx: Tx, userAccountId: string): Promise<MembershipRow[]> {
  return tx
    .select({
      organizationId: organizationMembership.organizationId,
      personId: organizationMembership.personId,
      isDefaultOrg: organizationMembership.isDefaultOrg,
    })
    .from(organizationMembership)
    .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
    .where(and(eq(organizationMembership.userAccountId, userAccountId), eq(organizationMembership.status, "active"), eq(organization.status, "active")))
    .orderBy(desc(organizationMembership.isDefaultOrg), asc(organizationMembership.joinedAt));
}

/** Tenant-bound. */
export async function findActiveMembership(tx: Tx, userAccountId: string): Promise<MembershipRow | null> {
  const rows = await tx
    .select({
      organizationId: organizationMembership.organizationId,
      personId: organizationMembership.personId,
      isDefaultOrg: organizationMembership.isDefaultOrg,
    })
    .from(organizationMembership)
    .where(and(eq(organizationMembership.userAccountId, userAccountId), eq(organizationMembership.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Tenant-bound. The request context's tenant half in ONE statement (it runs on every request — `getRequestContext`):
 * the caller's active membership in the bound organization joined to its ACTIVE person row (no row when either is
 * missing, invisible under RLS or — defense in depth behind the disabled account and the `left` membership — the
 * person was removed), plus the organization's primary school name — the default school, else the oldest one; null
 * when the organization has no school yet.
 */
export async function findMemberContext(
  tx: Tx,
  userAccountId: string,
): Promise<{ personId: string; firstName: string; lastName: string; schoolName: string | null } | null> {
  const primarySchool = tx.select({ name: school.name }).from(school).orderBy(desc(school.isDefault), asc(school.createdAt)).limit(1);
  const rows = await tx
    .select({
      personId: organizationMembership.personId,
      firstName: person.firstName,
      lastName: person.lastName,
      schoolName: sql<string | null>`(${primarySchool})`,
    })
    .from(organizationMembership)
    .innerJoin(person, eq(person.id, organizationMembership.personId))
    .where(and(eq(organizationMembership.userAccountId, userAccountId), eq(organizationMembership.status, "active"), eq(person.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Tenant-bound. Valid (not revoked, inside valid_from/valid_to) assignments of a person, each with the
 * permission codes of its role. System role templates (organization_id NULL) are visible under RLS.
 */
export async function listValidAssignments(tx: Tx, personId: string): Promise<Assignment[]> {
  const rows = await tx
    .select({
      roleId: roleAssignment.roleId,
      roleCode: role.code,
      scopeType: roleAssignment.scopeType,
      scopeId: roleAssignment.scopeId,
      permissions: sql<string[]>`coalesce(array_agg(${rolePermission.permissionCode}) filter (where ${rolePermission.permissionCode} is not null), '{}')`,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .leftJoin(rolePermission, eq(rolePermission.roleId, role.id))
    .where(
      and(
        eq(roleAssignment.personId, personId),
        isNull(roleAssignment.revokedAt),
        or(isNull(roleAssignment.validFrom), sql`${roleAssignment.validFrom} <= current_date`),
        or(isNull(roleAssignment.validTo), sql`${roleAssignment.validTo} >= current_date`),
      ),
    )
    .groupBy(roleAssignment.id, roleAssignment.roleId, role.code, roleAssignment.scopeType, roleAssignment.scopeId);
  return rows.map((r) => ({
    roleId: r.roleId,
    roleCode: r.roleCode,
    scopeType: r.scopeType as ScopeType,
    scopeId: r.scopeId,
    permissions: r.permissions,
  }));
}
