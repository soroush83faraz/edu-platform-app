// /admin/roles: the system role templates (read-only) and who holds a manual manager role in the caller's scope.
// `revocable` mirrors `revokeRoleAssignment`'s permission step for the «لغو» button (the server re-checks).
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { defineQuery } from "@/lib/actions";
import { person, role, roleAssignment, rolePermission } from "@/modules/iam/schema";
import { canManageRole, getAdminScope } from "@/modules/iam/service";
import { branch, school } from "@/modules/tenancy/schema";

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
    // `guardian_full` («ولی») is seeded for phase 2; no guardian logs in yet, so it is not listed.
    .where(and(isNull(role.organizationId), eq(role.isSystem, true), sql`${role.code} <> 'guardian_full'`))
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
      // The school the role lives under: the row's school, or the branch's school for branch-scoped roles.
      schoolId: sql<string | null>`coalesce(${roleAssignment.schoolId}, ${branch.schoolId})`,
      schoolName: sql<string | null>`coalesce(${school.name}, (select s2.name from tenancy.school s2 where s2.id = ${branch.schoolId}))`,
      validFrom: roleAssignment.validFrom,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .innerJoin(person, eq(person.id, roleAssignment.personId))
    .leftJoin(school, eq(school.id, roleAssignment.schoolId))
    .leftJoin(branch, eq(branch.id, roleAssignment.branchId))
    .where(
      and(
        isNull(roleAssignment.revokedAt),
        eq(roleAssignment.sourceType, "manual"),
        sql`${roleAssignment.scopeType} in ('organization', 'school', 'branch')`,
        // نقش مدیر سازمان از این فهرست حذف است: یکتاست و فقط با کد تعریف/حذف می‌شود، نه از رابط کاربری (owner).
        sql`${role.code} <> 'org_admin'`,
        // School scope: only school-/branch-scoped assignments inside the caller's schools (organization roles never).
        scope.kind === "organization"
          ? undefined
          : sql`(${roleAssignment.schoolId} = any(${sql.param(scope.schoolIds, undefined)}::uuid[])
              or exists (select 1 from tenancy.branch b where b.id = ${roleAssignment.branchId} and b.school_id = any(${sql.param(scope.schoolIds, undefined)}::uuid[])))`,
      ),
    )
    .orderBy(asc(role.code), asc(person.lastName));
  return { scope, templates, assignments: assignments.map((a) => ({ ...a, revocable: canManageRole(ctx.assignments, a.roleCode, a.schoolId) })) };
});
