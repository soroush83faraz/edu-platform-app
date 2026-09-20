// The dump role. `pg_dump -U app_backup` used to fail twice over: no USAGE on schema `drizzle` (pg_dump locks every
// table, the migration ledger included) and FORCE RLS, which makes every tenant table error or read empty for a role
// without BYPASSRLS. Now: app_backup has BYPASSRLS (01-roles.sh / operator step on existing servers) and read-only
// grants on every schema incl. `drizzle` (app.apply_grants(), migration 0007). It must still be unable to write.
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { person } from "@/db/schema";
import * as f from "./fixtures";
import { PG, asAppBackup, asAppRw, inRolledBackTx } from "./helpers";

async function personsSeenBy(orgId: string): Promise<number> {
  const rows = await withTenant({ orgId }, (tx) => tx.select({ id: person.id }).from(person));
  return rows.length;
}

describe("app_backup (dump role)", () => {
  it("with no tenant context sees EVERY row of a tenant table (BYPASSRLS), not 0", async () => {
    // Every person belongs to A or B, so the two tenant views add up to the true total.
    const total = (await personsSeenBy(f.ORG_A)) + (await personsSeenBy(f.ORG_B));
    expect(total).toBeGreaterThanOrEqual(f.PERSONS_IN_A + f.PERSONS_IN_B);

    const seen = await asAppBackup(async (c) => {
      const me = await c.query<{ who: string }>("select current_user as who");
      expect(me.rows[0].who).toBe("app_backup");
      const r = await c.query<{ n: number }>("select count(*)::int as n from iam.person");
      return r.rows[0].n;
    });
    expect(seen).toBe(total);
  });

  it("can read the migration ledger and its sequence (pg_dump locks and reads schema `drizzle` too)", async () => {
    await asAppBackup(async (c) => {
      const ledger = await c.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
      expect(ledger.rows[0].n).toBeGreaterThan(0);
      const seq = await c.query<{ last_value: string }>("select last_value::text from drizzle.__drizzle_migrations_id_seq");
      expect(Number(seq.rows[0].last_value)).toBeGreaterThan(0);
    });
  });

  it("cannot INSERT, UPDATE or DELETE anywhere (42501) — BYPASSRLS widened reads only", async () => {
    await asAppBackup(async (c) => {
      await inRolledBackTx(c, async () => {
        await expect(
          c.query("insert into iam.person (id, organization_id, first_name, last_name) values (app.uuid_generate_v7(), $1, 'x', 'y')", [f.ORG_A]),
        ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
      await inRolledBackTx(c, async () => {
        await expect(c.query("update iam.person set first_name = 'x' where id = $1", [f.PERSON_B1])).rejects.toMatchObject({
          code: PG.INSUFFICIENT_PRIVILEGE,
        });
      });
      await inRolledBackTx(c, async () => {
        await expect(c.query("delete from iam.role where organization_id is null")).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
      await inRolledBackTx(c, async () => {
        await expect(c.query("insert into tenancy.organization (id, name, slug) values (app.uuid_generate_v7(), 'x', 'evil-org')")).rejects.toMatchObject({
          code: PG.INSUFFICIENT_PRIVILEGE,
        });
      });
    });
  });

  it("role attributes: app_backup BYPASSRLS + NOSUPERUSER; app_owner and app_rw stay NOBYPASSRLS; grants are SELECT only", async () => {
    await asAppRw(async (c) => {
      const roles = await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }>(
        "select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname in ('app_owner', 'app_rw', 'app_backup') order by 1",
      );
      expect(roles.rows).toEqual([
        { rolname: "app_backup", rolsuper: false, rolbypassrls: true, rolcreaterole: false },
        { rolname: "app_owner", rolsuper: false, rolbypassrls: false, rolcreaterole: false },
        { rolname: "app_rw", rolsuper: false, rolbypassrls: false, rolcreaterole: false },
      ]);

      // Every table in every app schema (drizzle ledger included) is readable, none is writable, by the dump role.
      const acl = await c.query<{ table: string; can_select: boolean; can_write: boolean }>(
        `select n.nspname || '.' || c.relname as table,
                has_table_privilege('app_backup', c.oid, 'SELECT') as can_select,
                (has_table_privilege('app_backup', c.oid, 'INSERT') or has_table_privilege('app_backup', c.oid, 'UPDATE')
                 or has_table_privilege('app_backup', c.oid, 'DELETE') or has_table_privilege('app_backup', c.oid, 'TRUNCATE')) as can_write
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind = 'r'
            and n.nspname in ('drizzle','tenancy','iam','academic','workspace','notif','files','audit','config','integ')
          order by 1`,
      );
      expect(acl.rows.length).toBeGreaterThanOrEqual(24); // 23 app tables + drizzle.__drizzle_migrations
      expect(acl.rows.filter((r) => !r.can_select).map((r) => r.table)).toEqual([]);
      expect(acl.rows.filter((r) => r.can_write).map((r) => r.table)).toEqual([]);
    });
  });
});
