// System role templates (`iam.role` rows with organization_id IS NULL) are shared, read-only data for tenants.
// A single FOR ALL policy whose USING admitted NULL rows let any tenant DELETE or hijack them (an UPDATE that
// re-tags the template with its own organization_id passes the WITH CHECK). The per-command policies created by
// app.apply_rls() (0004) keep templates readable while UPDATE/DELETE target only the tenant's own rows.
import { describe, expect, it } from "vitest";
import * as f from "./fixtures";
import { PG, asAppOwner, asAppRw, inRolledBackTx } from "./helpers";

const ORG_CTX = "select set_config('app.current_org_id', $1, true)";

describe("system role templates are read-only for tenants (app_rw)", () => {
  it("under org A: DELETE FROM iam.role WHERE organization_id IS NULL touches 0 rows", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const del = await c.query("delete from iam.role where organization_id is null");
        expect(del.rowCount).toBe(0);
        const still = await c.query<{ n: number }>("select count(*)::int as n from iam.role where id = $1", [f.ROLE_TEMPLATE]);
        expect(still.rows[0].n).toBe(1);
      });
    });
  });

  it("under org A: UPDATE ... SET organization_id = A (hijack) touches 0 rows and the template stays global", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const upd = await c.query("update iam.role set organization_id = $1 where organization_id is null", [f.ORG_A]);
        expect(upd.rowCount).toBe(0);
        const row = await c.query<{ organization_id: string | null }>("select organization_id from iam.role where id = $1", [f.ROLE_TEMPLATE]);
        expect(row.rows[0].organization_id).toBeNull();
      });
    });
  });

  it("under org A: UPDATE of a template's name (no re-tagging) also touches 0 rows", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const upd = await c.query("update iam.role set name = 'hacked' where id = $1", [f.ROLE_TEMPLATE]);
        expect(upd.rowCount).toBe(0);
      });
    });
  });

  it("under org A: templates are still readable next to A's own roles; B's roles are not", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const rows = await c.query<{ id: string }>("select id from iam.role order by id");
        expect(rows.rows.map((r) => r.id).sort()).toEqual([f.ROLE_TEMPLATE, f.ROLE_A].sort());
      });
    });
  });

  it("under org A: INSERT of A's own role works, INSERT of a template (NULL) or of B's role is rejected (42501)", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const ins = await c.query(
          "insert into iam.role (id, organization_id, code, name, allowed_scope_types) values (app.uuid_generate_v7(), $1, 'clerk', 'منشی', ARRAY['school']) returning id",
          [f.ORG_A],
        );
        expect(ins.rowCount).toBe(1);
        // ...and the tenant may update/delete its OWN role.
        const upd = await c.query("update iam.role set name = 'دفتردار' where id = $1", [ins.rows[0].id]);
        expect(upd.rowCount).toBe(1);
        const del = await c.query("delete from iam.role where id = $1", [ins.rows[0].id]);
        expect(del.rowCount).toBe(1);
      });
      for (const org of [null, f.ORG_B]) {
        await inRolledBackTx(c, async () => {
          await c.query(ORG_CTX, [f.ORG_A]);
          await expect(
            c.query("insert into iam.role (id, organization_id, code, name, allowed_scope_types) values (app.uuid_generate_v7(), $1, 'evil', 'evil', ARRAY['organization'])", [
              org,
            ]),
          ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
        });
      }
    });
  });

  it("without any tenant context: templates are readable, nothing is writable", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        const rows = await c.query<{ id: string }>("select id from iam.role");
        expect(rows.rows.map((r) => r.id)).toEqual([f.ROLE_TEMPLATE]);
        const del = await c.query("delete from iam.role");
        expect(del.rowCount).toBe(0);
        const upd = await c.query("update iam.role set name = 'x'");
        expect(upd.rowCount).toBe(0);
      });
    });
  });
});

describe("system role templates stay writable for the seed (app_owner, `system_templates` policy)", () => {
  it("app_owner without tenant context can update and upsert a template (rolled back)", async () => {
    await asAppOwner(async (c) => {
      await inRolledBackTx(c, async () => {
        const upd = await c.query("update iam.role set description = 'seeded' where id = $1", [f.ROLE_TEMPLATE]);
        expect(upd.rowCount).toBe(1);
        // The seed's upsert shape: INSERT ... ON CONFLICT (organization_id, code) DO UPDATE on a NULL-org row.
        const upsert = await c.query<{ id: string }>(
          `insert into iam.role (id, organization_id, code, name, is_system, allowed_scope_types)
           values (app.uuid_generate_v7(), null, 'teacher', 'معلم', true, ARRAY['class_offering'])
           on conflict (organization_id, code) do update set name = excluded.name returning id`,
        );
        expect(upsert.rows[0].id).toBe(f.ROLE_TEMPLATE);
      });
    });
  });
});
