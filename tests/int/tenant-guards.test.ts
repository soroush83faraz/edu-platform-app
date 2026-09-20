// Cross-tenant role attachment guards (migration 0006). The plain FKs role_assignment.role_id -> role(id) and
// role.cloned_from_role_id -> role(id) are checked by referential-integrity code that bypasses RLS, so org A could
// attach or clone org B's private role by id. Constraint triggers (SECURITY DEFINER, app_owner) now require the
// referenced role to be a system template (organization_id IS NULL) or a role of the same organization.
import { describe, expect, it } from "vitest";
import * as f from "./fixtures";
import { PG, asAppOwner, asAppRw, inRolledBackTx } from "./helpers";

const ORG_CTX = "select set_config('app.current_org_id', $1, true)";
const INSERT_ASSIGNMENT =
  "insert into iam.role_assignment (id, organization_id, person_id, role_id, scope_type) values (app.uuid_generate_v7(), $1, $2, $3, 'organization') returning id";
const INSERT_ROLE =
  "insert into iam.role (id, organization_id, code, name, allowed_scope_types, cloned_from_role_id) values (app.uuid_generate_v7(), $1, $2, $2, ARRAY['school'], $3) returning id";

describe("role_assignment.role_id must be a template or a role of the same organization", () => {
  it("under A: attaching B's private role is rejected by role_assignment_role_tenant_trg (23503)", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        await expect(c.query(INSERT_ASSIGNMENT, [f.ORG_A, f.PERSON_A1, f.ROLE_B])).rejects.toMatchObject({
          code: PG.FOREIGN_KEY_VIOLATION,
          constraint: "role_assignment_role_tenant_trg",
        });
      });
    });
  });

  it("under A: a system template and A's own role are accepted (rolled back)", async () => {
    await asAppRw(async (c) => {
      for (const roleId of [f.ROLE_TEMPLATE, f.ROLE_A]) {
        await inRolledBackTx(c, async () => {
          await c.query(ORG_CTX, [f.ORG_A]);
          const res = await c.query(INSERT_ASSIGNMENT, [f.ORG_A, f.PERSON_A1, roleId]);
          expect(res.rowCount).toBe(1);
        });
      }
    });
  });

  it("under A: re-pointing an existing assignment at B's role is rejected; a nonexistent role stays a plain FK error", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const res = await c.query<{ id: string }>(INSERT_ASSIGNMENT, [f.ORG_A, f.PERSON_A1, f.ROLE_A]);
        await expect(c.query("update iam.role_assignment set role_id = $1 where id = $2", [f.ROLE_B, res.rows[0].id])).rejects.toMatchObject({
          code: PG.FOREIGN_KEY_VIOLATION,
          constraint: "role_assignment_role_tenant_trg",
        });
      });
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        await expect(c.query(INSERT_ASSIGNMENT, [f.ORG_A, f.PERSON_A1, "0199a000-0007-7000-8000-00000000dead"])).rejects.toMatchObject({
          code: PG.FOREIGN_KEY_VIOLATION,
        });
      });
    });
  });

  it("the guard cannot be deferred by app_rw (NOT DEFERRABLE constraint trigger); SET CONSTRAINTS ALL DEFERRED does not skip it", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await expect(c.query("set constraints iam.role_assignment_role_tenant_trg deferred")).rejects.toMatchObject({
          code: "42809", // wrong_object_type: constraint "..." is not deferrable
        });
      });
      await inRolledBackTx(c, async () => {
        await c.query("set constraints all deferred");
        await c.query(ORG_CTX, [f.ORG_A]);
        await expect(c.query(INSERT_ASSIGNMENT, [f.ORG_A, f.PERSON_A1, f.ROLE_B])).rejects.toMatchObject({
          code: PG.FOREIGN_KEY_VIOLATION,
          constraint: "role_assignment_role_tenant_trg",
        });
      });
    });
  });
});

describe("role.cloned_from_role_id must be a template or a role of the same organization", () => {
  it("under A: cloning B's private role is rejected by role_cloned_from_tenant_trg (23503)", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        await expect(c.query(INSERT_ROLE, [f.ORG_A, "copy_b", f.ROLE_B])).rejects.toMatchObject({
          code: PG.FOREIGN_KEY_VIOLATION,
          constraint: "role_cloned_from_tenant_trg",
        });
      });
    });
  });

  it("under A: cloning a system template or A's own role is accepted (rolled back)", async () => {
    await asAppRw(async (c) => {
      for (const source of [f.ROLE_TEMPLATE, f.ROLE_A]) {
        await inRolledBackTx(c, async () => {
          await c.query(ORG_CTX, [f.ORG_A]);
          const res = await c.query(INSERT_ROLE, [f.ORG_A, "copy_ok", source]);
          expect(res.rowCount).toBe(1);
        });
      }
    });
  });

  it("seed (app_owner, no context): a template may clone a template, never a tenant's role", async () => {
    await asAppOwner(async (c) => {
      await inRolledBackTx(c, async () => {
        const ok = await c.query(INSERT_ROLE, [null, "teacher_v2", f.ROLE_TEMPLATE]);
        expect(ok.rowCount).toBe(1);
      });
      await inRolledBackTx(c, async () => {
        await expect(c.query(INSERT_ROLE, [null, "leak", f.ROLE_A])).rejects.toMatchObject({
          code: PG.FOREIGN_KEY_VIOLATION,
          constraint: "role_cloned_from_tenant_trg",
        });
      });
    });
  });
});

describe("guard trigger functions (catalog)", () => {
  it("are SECURITY DEFINER, owned by app_owner, with a pinned search_path, and wired as NOT DEFERRABLE constraint triggers", async () => {
    await asAppRw(async (c) => {
      const fns = await c.query<{ name: string; secdef: boolean; owner: string; config: string[] | null }>(
        `select p.proname as name, p.prosecdef as secdef, pg_get_userbyid(p.proowner) as owner, p.proconfig::text[] as config
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname in ('check_role_assignment_role_tenant', 'check_role_cloned_from_tenant')
          order by 1`,
      );
      expect(fns.rows).toEqual([
        { name: "check_role_assignment_role_tenant", secdef: true, owner: "app_owner", config: ["search_path=pg_catalog, app"] },
        { name: "check_role_cloned_from_tenant", secdef: true, owner: "app_owner", config: ["search_path=pg_catalog, app"] },
      ]);

      const trg = await c.query<{ tgname: string; table: string; deferrable: boolean; enabled: string }>(
        `select t.tgname, c.relname as table, t.tgdeferrable as deferrable, t.tgenabled as enabled
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where t.tgname in ('role_assignment_role_tenant_trg', 'role_cloned_from_tenant_trg') and t.tgconstraint <> 0
          order by 1`,
      );
      expect(trg.rows).toEqual([
        { tgname: "role_assignment_role_tenant_trg", table: "role_assignment", deferrable: false, enabled: "O" },
        { tgname: "role_cloned_from_tenant_trg", table: "role", deferrable: false, enabled: "O" },
      ]);
    });
  });
});
