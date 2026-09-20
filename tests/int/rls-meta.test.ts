import { describe, expect, it } from "vitest";
import { asAppRw } from "./helpers";

const TENANT_SCHEMAS = ["tenancy", "iam", "academic", "workspace", "notif", "files", "audit", "config", "integ"];

/** tenancy (10 - organization) + iam (13 - user_account, auth_identity, user_session, login_attempt, permission, role_permission). */
const EXPECTED_TENANT_TABLES = 9 + 7;

describe("RLS meta-checks (catalog)", () => {
  it("every table with organization_id has RLS enabled + forced and at least one policy", async () => {
    const rows = await asAppRw(async (c) => {
      const res = await c.query<{
        schema: string;
        table: string;
        enabled: boolean;
        forced: boolean;
        policies: number;
      }>(
        `select n.nspname as schema, c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                (select count(*)::int from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where c.relkind = 'r'
            and n.nspname = any($1)
            and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
          order by 1, 2`,
        [TENANT_SCHEMAS],
      );
      return res.rows;
    });
    expect(rows).toHaveLength(EXPECTED_TENANT_TABLES);
    const bad = rows.filter((r) => !r.enabled || !r.forced || r.policies < 1);
    expect(bad, `tables missing RLS: ${bad.map((r) => `${r.schema}.${r.table}`).join(", ")}`).toEqual([]);
  });

  it("every tenant_isolation policy is bound to app.current_org_id()", async () => {
    const rows = await asAppRw(async (c) => {
      const res = await c.query<{ table: string; qual: string; with_check: string }>(
        `select schemaname || '.' || tablename as table, qual, with_check
           from pg_policies where policyname = 'tenant_isolation' and schemaname = any($1)`,
        [TENANT_SCHEMAS],
      );
      return res.rows;
    });
    expect(rows).toHaveLength(EXPECTED_TENANT_TABLES);
    for (const r of rows) {
      expect(r.qual, r.table).toContain("organization_id = app.current_org_id()");
      expect(r.with_check, r.table).toBe("(organization_id = app.current_org_id())");
    }
  });

  it("app_rw is NOSUPERUSER, NOBYPASSRLS and owns no table in the tenant schemas", async () => {
    await asAppRw(async (c) => {
      const role = await c.query<{ rolsuper: boolean; rolbypassrls: boolean; rolinherit: boolean }>(
        "select rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = 'app_rw'",
      );
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolinherit: false });

      const me = await c.query<{ who: string }>("select current_user as who");
      expect(me.rows[0].who).toBe("app_rw");

      const owned = await c.query<{ n: number }>(
        "select count(*)::int as n from pg_tables where schemaname = any($1) and tableowner = 'app_rw'",
        [TENANT_SCHEMAS],
      );
      expect(owned.rows[0].n).toBe(0);

      const all = await c.query<{ schema: string; n: number }>(
        "select schemaname as schema, count(*)::int as n from pg_tables where schemaname in ('tenancy','iam') group by 1 order by 1",
      );
      expect(all.rows).toEqual([
        { schema: "iam", n: 13 },
        { schema: "tenancy", n: 10 },
      ]);
    });
  });

  it("app_rw may only read the seed-managed catalogs (permission, role_permission)", async () => {
    await asAppRw(async (c) => {
      const res = await c.query<{ table_name: string; privs: string }>(
        `select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
           from information_schema.role_table_grants
          where grantee = 'app_rw' and table_schema = 'iam' and table_name in ('permission', 'role_permission', 'person')
          group by 1 order by 1`,
      );
      expect(res.rows).toEqual([
        { table_name: "permission", privs: "SELECT" },
        { table_name: "person", privs: "DELETE,INSERT,SELECT,UPDATE" },
        { table_name: "role_permission", privs: "SELECT" },
      ]);
    });
  });
});
