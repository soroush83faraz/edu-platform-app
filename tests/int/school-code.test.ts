// Owner, 2026-09-27: «کد مدرسه» is the organization admin's alone. Against the database: the schools list selects
// the code for the organization scope only (a principal's rows do not carry the field at all), the real
// `schoolResource` table rendered for each caller shows / hides it, and an update through `mutateResource` (the body
// of `adminResourceMutate`) that smuggles a `code` into the payload — from a principal, a vice principal, or the
// organization admin — changes the name and never the code.
// Everything runs in withTenant transactions that end with Rollback; nothing is committed.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import type { ResourceCtx } from "@/lib/admin/defineResource";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { SYSTEM_ROLES } from "../../scripts/catalog";
import * as f from "./fixtures";
import { Rollback } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
// The client form's server action (session stack); the table is only rendered here.
vi.mock("@/lib/admin/actions", () => ({ adminResourceMutate: async () => ({ ok: false, code: "INTERNAL", message: "" }) }));

const { resourceViewFor } = await import("@/lib/admin/defineResource");
const { mutateResource } = await import("@/lib/admin/mutate");
const { schoolResource } = await import("@/lib/admin/resources");
const { ResourceTable } = await import("@/components/admin/ResourceTable");
const { getAdminScope } = await import("@/modules/iam/service");
const { findSchoolById } = await import("@/modules/tenancy/repo");

const catalogPerms = (code: string): string[] => [...(SYSTEM_ROLES.find((r) => r.code === code)?.permissions ?? [])];
const orgAdminOf: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: PERMISSIONS.map((p) => p.code) };
const principalOf = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: catalogPerms("school_principal") });
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: catalogPerms("vice_principal") });
const ctxOf = (...assignments: Assignment[]): ResourceCtx => ({ orgId: f.ORG_A, personId: f.PERSON_A2, userId: "00000000-0000-7000-8000-000000000000", requestId: "int-school-code", ip: "127.0.0.1", userAgent: null, assignments });

const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const rolledBack = (fn: (tx: Tx) => Promise<void>) => expect(withTenant(tenant, fn)).rejects.toBeInstanceOf(Rollback);

describe("school code: organization admin only (DB)", () => {
  it("the schools list selects the code for the organization admin only, and the rendered table shows it to them alone", async () => {
    await rolledBack(async (tx) => {
      const code = (await findSchoolById(tx, f.SCHOOL_A))!.code;
      const opts = { q: "", page: 1, pageSize: 50 };
      for (const [who, ctx, sees] of [
        ["org admin", ctxOf(orgAdminOf), true],
        ["principal", ctxOf(principalOf(f.SCHOOL_A)), false],
        ["vice principal", ctxOf(viceOf(f.SCHOOL_A)), false],
      ] as const) {
        const scope = await getAdminScope(tx, ctx);
        const { rows } = await schoolResource.list(tx, ctx, scope, opts);
        const own = rows.find((r) => r.id === f.SCHOOL_A);
        expect(own, who).toBeDefined();
        expect("code" in own!, who).toBe(sees);
        if (sees) expect(own!.code, who).toBe(code);
        const html = renderToStaticMarkup(createElement(ResourceTable, { def: resourceViewFor(schoolResource, scope), rows: rows.map((r) => ({ ...r })), options: {}, canWrite: true }));
        expect(html.includes(`>${code}<`), who).toBe(sees);
        expect(html.includes(">کد<"), who).toBe(sees);
        expect(resourceViewFor(schoolResource, scope).descriptionFa?.includes("کد مدرسه"), who).toBe(sees);
      }
      throw new Rollback();
    });
  });

  it("an update carrying `code` (a crafted request) changes the details and never the code — principal, vice principal and organization admin alike", async () => {
    await rolledBack(async (tx) => {
      const before = (await findSchoolById(tx, f.SCHOOL_A))!;
      for (const [i, ctx] of [ctxOf(principalOf(f.SCHOOL_A)), ctxOf(viceOf(f.SCHOOL_A)), ctxOf(orgAdminOf)].entries()) {
        const name = `مدرسهٴ ویرایش‌شده ${i}`;
        await mutateResource(tx, ctx, { resource: "schools", op: "update", id: f.SCHOOL_A, data: { name, code: `HACK${i}`, genderPolicy: before.genderPolicy ?? "mixed", isDefault: before.isDefault } });
        const after = (await findSchoolById(tx, f.SCHOOL_A))!;
        expect(after.name).toBe(name);
        expect(after.code).toBe(before.code);
      }
      throw new Rollback();
    });
  });
});
