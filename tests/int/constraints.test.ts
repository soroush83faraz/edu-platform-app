import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { classGroup, roleAssignment } from "@/db/schema";
import * as f from "./fixtures";
import { PG, Rollback, pgCode } from "./helpers";

const ctxA = { orgId: f.ORG_A };

describe("composite tenant FKs", () => {
  it("class_group whose branch belongs to another org is rejected (23503)", async () => {
    await expect(
      withTenant(ctxA, (tx) =>
        tx.insert(classGroup).values({
          organizationId: f.ORG_A,
          branchId: f.BRANCH_B, // exists, but (ORG_A, BRANCH_B) does not
          academicYearId: f.YEAR_A,
          gradeLevelId: f.GRADE_A,
          name: "اول الف",
        }),
      ),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.FOREIGN_KEY_VIOLATION);
  });

  it("the same class_group with A's own branch is accepted (rolled back)", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [row] = await tx
          .insert(classGroup)
          .values({
            organizationId: f.ORG_A,
            branchId: f.BRANCH_A,
            academicYearId: f.YEAR_A,
            gradeLevelId: f.GRADE_A,
            name: "اول الف",
          })
          .returning({ id: classGroup.id, status: classGroup.status });
        expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(row.status).toBe("active");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe("role_assignment exclusive-arc CHECK", () => {
  const base = { organizationId: f.ORG_A, personId: f.PERSON_A1, roleId: f.ROLE_A } as const;

  it("scope_type = 'school' without school_id is rejected (23514)", async () => {
    await expect(
      withTenant(ctxA, (tx) => tx.insert(roleAssignment).values({ ...base, scopeType: "school" })),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
  });

  it("scope_type = 'school' with both school_id and class_group_id is rejected (23514)", async () => {
    await expect(
      withTenant(ctxA, (tx) =>
        tx.insert(roleAssignment).values({
          ...base,
          scopeType: "school",
          schoolId: f.SCHOOL_A,
          classGroupId: "0199a000-0008-7000-8000-000000000001",
        }),
      ),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
  });

  it("scope_type = 'organization' with any scope column set is rejected (23514)", async () => {
    await expect(
      withTenant(ctxA, (tx) => tx.insert(roleAssignment).values({ ...base, scopeType: "organization", schoolId: f.SCHOOL_A })),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
  });

  it("valid school-scoped assignment: scope_id is generated from school_id (rolled back)", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [row] = await tx
          .insert(roleAssignment)
          .values({ ...base, scopeType: "school", schoolId: f.SCHOOL_A })
          .returning({ scopeId: roleAssignment.scopeId, validFrom: roleAssignment.validFrom });
        expect(row.scopeId).toBe(f.SCHOOL_A);
        expect(row.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("valid organization-scoped assignment: scope_id falls back to organization_id (rolled back)", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [row] = await tx
          .insert(roleAssignment)
          .values({ ...base, scopeType: "organization" })
          .returning({ scopeId: roleAssignment.scopeId });
        expect(row.scopeId).toBe(f.ORG_A);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
