import { describe, expect, it } from "vitest";
import { asAppRw } from "./helpers";

const TENANT_SCHEMAS = ["tenancy", "iam", "academic", "workspace", "notif", "files", "audit", "config", "integ"];

/** tenancy (10 - organization) + iam (13 - user_account, auth_identity, user_session, login_attempt, permission, role_permission). */
const EXPECTED_TENANT_TABLES = 9 + 7;

/** Tables whose organization_id is nullable: NULL rows are shared system templates (read-only for tenants). */
const NULLABLE_ORG_TABLES = ["iam.role"];

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

  it("NOT NULL organization_id -> one tenant_isolation policy bound to app.current_org_id()", async () => {
    const rows = await asAppRw(async (c) => {
      const res = await c.query<{ table: string; qual: string; with_check: string; cmd: string }>(
        `select p.schemaname || '.' || p.tablename as table, p.qual, p.with_check, p.cmd
           from pg_policies p
           join pg_namespace n on n.nspname = p.schemaname
           join pg_class c on c.relnamespace = n.oid and c.relname = p.tablename
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
          where p.policyname = 'tenant_isolation' and p.schemaname = any($1) and a.attnotnull`,
        [TENANT_SCHEMAS],
      );
      return res.rows;
    });
    expect(rows).toHaveLength(EXPECTED_TENANT_TABLES - NULLABLE_ORG_TABLES.length);
    for (const r of rows) {
      expect(r.cmd, r.table).toBe("ALL");
      expect(r.qual, r.table).toBe("(organization_id = app.current_org_id())");
      expect(r.with_check, r.table).toBe("(organization_id = app.current_org_id())");
    }
  });

  it("nullable organization_id (system templates) -> per-command policies; UPDATE/DELETE never target NULL rows", async () => {
    const tables = await asAppRw(async (c) => {
      const res = await c.query<{ table: string }>(
        `select n.nspname || '.' || c.relname as table
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
          where c.relkind = 'r' and n.nspname = any($1) and not a.attnotnull
          order by 1`,
        [TENANT_SCHEMAS],
      );
      return res.rows.map((r) => r.table);
    });
    expect(tables).toEqual(NULLABLE_ORG_TABLES);

    for (const table of tables) {
      const [schema, name] = table.split(".");
      const policies = await asAppRw(async (c) => {
        const res = await c.query<{ policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }>(
          `select policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where schemaname = $1 and tablename = $2 order by policyname`,
          [schema, name],
        );
        return res.rows;
      });
      const byName = Object.fromEntries(policies.map((p) => [p.policyname, p]));
      expect(Object.keys(byName).sort(), table).toEqual(
        ["system_templates", "tenant_isolation_delete", "tenant_isolation_select", "tenant_isolation_update", "tenant_isolation_write"].sort(),
      );
      const ownRows = "(organization_id = app.current_org_id())";
      expect(byName.tenant_isolation_select, table).toMatchObject({
        cmd: "SELECT",
        roles: ["public"],
        qual: "((organization_id IS NULL) OR (organization_id = app.current_org_id()))",
        with_check: null,
      });
      expect(byName.tenant_isolation_write, table).toMatchObject({ cmd: "INSERT", roles: ["public"], qual: null, with_check: ownRows });
      expect(byName.tenant_isolation_update, table).toMatchObject({ cmd: "UPDATE", roles: ["public"], qual: ownRows, with_check: ownRows });
      expect(byName.tenant_isolation_delete, table).toMatchObject({ cmd: "DELETE", roles: ["public"], qual: ownRows, with_check: null });
      expect(byName.system_templates, table).toMatchObject({
        cmd: "ALL",
        roles: ["app_owner"],
        qual: "(organization_id IS NULL)",
        with_check: "(organization_id IS NULL)",
      });
      // No policy applicable to app_rw admits a NULL row for UPDATE or DELETE.
      const publicWrite = policies.filter((p) => p.roles.includes("public") && ["ALL", "UPDATE", "DELETE"].includes(p.cmd));
      for (const p of publicWrite) expect(p.qual, `${table}.${p.policyname}`).not.toContain("IS NULL");
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
