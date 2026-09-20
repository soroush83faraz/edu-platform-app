import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, withoutTenant } from "@/db/client";
import { person, role } from "@/db/schema";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

describe("RLS as app_rw (raw connection)", () => {
  it("no app.current_org_id set -> tenant tables look empty although rows exist", async () => {
    await asAppRw(async (c) => {
      const persons = await c.query<{ n: number }>("select count(*)::int as n from iam.person");
      const schools = await c.query<{ n: number }>("select count(*)::int as n from tenancy.school");
      expect(persons.rows[0].n).toBe(0);
      expect(schools.rows[0].n).toBe(0);
    });
    // ...while the owner, with the right context, sees them (proves the fixtures exist).
    const seen = await withTenant({ orgId: f.ORG_A }, (tx) => tx.select({ id: person.id }).from(person));
    expect(seen).toHaveLength(f.PERSONS_IN_A);
  });

  it("set_config(..., true) is transaction-local: nothing leaks after COMMIT on the same connection", async () => {
    await asAppRw(async (c) => {
      await c.query("BEGIN");
      await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
      const during = await c.query<{ n: number }>("select count(*)::int as n from iam.person");
      await c.query("COMMIT");
      const after = await c.query<{ n: number }>("select count(*)::int as n from iam.person");
      expect(during.rows[0].n).toBe(f.PERSONS_IN_A);
      expect(after.rows[0].n).toBe(0);
    });
  });

  it("org A context: UPDATE of an org B row touches 0 rows; INSERT tagged with org B is rejected", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        const upd = await c.query("update iam.person set first_name = 'hacked' where id = $1", [f.PERSON_B1]);
        expect(upd.rowCount).toBe(0);
      });
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        await expect(
          c.query("insert into iam.person (id, organization_id, first_name, last_name) values (app.uuid_generate_v7(), $1, 'x', 'y')", [
            f.ORG_B,
          ]),
        ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
    });
  });

  it("app_rw cannot create a system role template (organization_id IS NULL)", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        await expect(
          c.query(
            "insert into iam.role (id, organization_id, code, name, allowed_scope_types) values (app.uuid_generate_v7(), NULL, 'evil', 'evil', ARRAY['organization'])",
          ),
        ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
    });
  });
});

describe("withTenant / withoutTenant (the app's only DB boundary)", () => {
  it("withTenant(A) sees only A's rows; withTenant(B) only B's", async () => {
    const a = await withTenant({ orgId: f.ORG_A }, (tx) =>
      tx.select({ id: person.id, organizationId: person.organizationId }).from(person),
    );
    const b = await withTenant({ orgId: f.ORG_B }, (tx) =>
      tx.select({ id: person.id, organizationId: person.organizationId }).from(person),
    );
    expect(a).toHaveLength(f.PERSONS_IN_A);
    expect(a.every((r) => r.organizationId === f.ORG_A)).toBe(true);
    expect(b).toHaveLength(f.PERSONS_IN_B);
    expect(b[0].id).toBe(f.PERSON_B1);
  });

  it("withoutTenant sees NO tenant rows (fail closed)", async () => {
    const rows = await withoutTenant((tx) => tx.select({ id: person.id }).from(person));
    expect(rows).toHaveLength(0);
  });

  it("under A, updating B's person affects 0 rows and B is unchanged", async () => {
    const updated = await withTenant({ orgId: f.ORG_A }, (tx) =>
      tx.update(person).set({ firstName: "hacked" }).where(eq(person.id, f.PERSON_B1)).returning({ id: person.id }),
    );
    expect(updated).toHaveLength(0);
    const [b1] = await withTenant({ orgId: f.ORG_B }, (tx) =>
      tx.select({ firstName: person.firstName }).from(person).where(eq(person.id, f.PERSON_B1)),
    );
    expect(b1.firstName).toBe("مریم");
  });

  it("under A, inserting a person with organization_id = B throws 42501", async () => {
    await expect(
      withTenant({ orgId: f.ORG_A }, (tx) =>
        tx.insert(person).values({ organizationId: f.ORG_B, firstName: "x", lastName: "y" }),
      ),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.INSUFFICIENT_PRIVILEGE);
  });

  it("under A, inserting a person for A works and search_text is normalized (rolled back)", async () => {
    await expect(
      withTenant({ orgId: f.ORG_A, personId: f.PERSON_A1 }, async (tx) => {
        const [row] = await tx
          .insert(person)
          .values({ organizationId: f.ORG_A, firstName: "علي‌رضا", lastName: "كريمي" })
          .returning({ searchText: person.searchText });
        expect(row.searchText).toBe("علی رضا کریمی");
        const [ctx] = (await tx.execute<{ org: string; who: string }>(
          sql`select app.current_org_id()::text as org, app.current_person_id()::text as who`,
        )).rows;
        expect(ctx).toEqual({ org: f.ORG_A, who: f.PERSON_A1 });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    const a = await withTenant({ orgId: f.ORG_A }, (tx) => tx.select({ id: person.id }).from(person));
    expect(a).toHaveLength(f.PERSONS_IN_A);
  });

  it("system role templates (organization_id IS NULL) are visible to every tenant, other tenants' roles are not", async () => {
    const rolesA = await withTenant({ orgId: f.ORG_A }, (tx) => tx.select({ id: role.id }).from(role));
    const ids = rolesA.map((r) => r.id).sort();
    expect(ids).toEqual([f.ROLE_TEMPLATE, f.ROLE_A].sort());
  });

  it("rejects a non-UUID orgId before touching the database", async () => {
    await expect(withTenant({ orgId: "1 OR 1=1" }, async () => 1)).rejects.toThrow(/UUID/);
  });
});
