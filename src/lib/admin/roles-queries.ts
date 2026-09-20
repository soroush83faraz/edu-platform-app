// /admin/roles: the system role templates (read-only) and who holds a manual manager role in the caller's scope.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { defineQuery } from "@/lib/actions";
import { person, role, roleAssignment, rolePermission } from "@/modules/iam/schema";
import { getAdminScope } from "@/modules/iam/service";
import { school } from "@/modules/tenancy/schema";

export const rolesPageQuery = defineQuery({ permission: "iam.person.read", scope: "any" }, async (tx, _input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const templates = await tx
    .select({
      code: role.code,
      name: role.name,
      description: role.description,
      allowedScopeTypes: role.allowedScopeTypes,
      permissions: sql<number>`(select count(*)::int from ${rolePermission} rp where rp.role_id = ${role.id})`,
    })
    .from(role)
    .where(and(isNull(role.organizationId), eq(role.isSystem, true)))
    .orderBy(asc(role.code));
  const assignments = await tx
    .select({
      roleAssignmentId: roleAssignment.id,
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      roleCode: role.code,
      roleName: role.name,
      scopeType: roleAssignment.scopeType,
      schoolId: roleAssignment.schoolId,
      schoolName: school.name,
      validFrom: roleAssignment.validFrom,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .innerJoin(person, eq(person.id, roleAssignment.personId))
    .leftJoin(school, eq(school.id, roleAssignment.schoolId))
    .where(
      and(
        isNull(roleAssignment.revokedAt),
        eq(roleAssignment.sourceType, "manual"),
        sql`${roleAssignment.scopeType} in ('organization', 'school', 'branch')`,
        // School scope: only school-/branch-scoped assignments inside the caller's schools (organization roles never).
        scope.kind === "organization"
          ? undefined
          : sql`(${roleAssignment.schoolId} = any(${sql.param(scope.schoolIds, undefined)}::uuid[])
              or exists (select 1 from tenancy.branch b where b.id = ${roleAssignment.branchId} and b.school_id = any(${sql.param(scope.schoolIds, undefined)}::uuid[])))`,
      ),
    )
    .orderBy(asc(role.code), asc(person.lastName));
  return { scope, templates, assignments };
});
