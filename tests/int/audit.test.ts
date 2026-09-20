// audit.audit_log is append-only for the application role: app_rw may INSERT and SELECT, UPDATE/DELETE are revoked
// inside app.apply_grants() (migration 0011) so a later `SELECT app.apply_grants()` cannot re-grant them. `audit()`
// (src/lib/audit.ts) writes the row inside the caller's tenant transaction.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { audit } from "@/lib/audit";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx } from "./helpers";

const ORG_CTX = "select set_config('app.current_org_id', $1, true)";

describe("audit.audit_log is append-only for app_rw", () => {
  it("INSERT and SELECT work under the tenant context; UPDATE and DELETE fail with 42501 even on the own row", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const ins = await c.query<{ id: string }>(
          `insert into audit.audit_log (id, organization_id, actor_person_id, action, entity_schema, entity_table, entity_id, after)
           values (app.uuid_generate_v7(), $1, $2, 'test.thing.changed', 'iam', 'person', $2, '{"x":1}') returning id`,
          [f.ORG_A, f.PERSON_A1],
        );
        expect(ins.rowCount).toBe(1);
        const sel = await c.query<{ action: string }>("select action from audit.audit_log where id = $1", [ins.rows[0].id]);
        expect(sel.rows[0].action).toBe("test.thing.changed");

        await c.query("savepoint s1");
        await expect(c.query("update audit.audit_log set action = 'rewritten' where id = $1", [ins.rows[0].id])).rejects.toMatchObject({
          code: PG.INSUFFICIENT_PRIVILEGE,
        });
        await c.query("rollback to savepoint s1");
        await expect(c.query("delete from audit.audit_log where id = $1", [ins.rows[0].id])).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
    });
  });

  it("the grant table shows exactly SELECT,INSERT for app_rw", async () => {
    await asAppRw(async (c) => {
      const res = await c.query<{ privs: string }>(
        `select string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants
          where grantee = 'app_rw' and table_schema = 'audit' and table_name = 'audit_log'`,
      );
      expect(res.rows[0].privs).toBe("INSERT,SELECT");
    });
  });

  it("an INSERT tagged with another organization is rejected by RLS (42501)", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        await expect(
          c.query(
            `insert into audit.audit_log (id, organization_id, action, entity_schema, entity_table)
             values (app.uuid_generate_v7(), $1, 'x', 'iam', 'person')`,
            [f.ORG_B],
          ),
        ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
    });
  });
});

describe("audit() helper", () => {
  it("writes one row with actor, request id, entity and before/after inside the caller's transaction (rolled back)", async () => {
    await expect(
      withTenant({ orgId: f.ORG_A, personId: f.PERSON_A1 }, async (tx) => {
        const ctx = { orgId: f.ORG_A, personId: f.PERSON_A1, userId: "0199a000-00ff-7000-8000-0000000000aa", requestId: "req-1", ip: "10.1.2.3", userAgent: "vitest" };
        await audit(ctx, "iam.person.updated", { schema: "iam", table: "person", id: f.PERSON_A1 }, { firstName: "a" }, { firstName: "b" }, tx);
        const rows = await tx
          .select({
            action: auditLog.action,
            actorPersonId: auditLog.actorPersonId,
            actorUserId: auditLog.actorUserId,
            requestId: auditLog.requestId,
            entitySchema: auditLog.entitySchema,
            entityTable: auditLog.entityTable,
            entityId: auditLog.entityId,
            before: auditLog.before,
            after: auditLog.after,
            ip: auditLog.ip,
            userAgent: auditLog.userAgent,
          })
          .from(auditLog)
          .where(eq(auditLog.requestId, "req-1"));
        expect(rows).toEqual([
          {
            action: "iam.person.updated",
            actorPersonId: f.PERSON_A1,
            actorUserId: ctx.userId,
            requestId: "req-1",
            entitySchema: "iam",
            entityTable: "person",
            entityId: f.PERSON_A1,
            before: { firstName: "a" },
            after: { firstName: "b" },
            ip: "10.1.2.3",
            userAgent: "vitest",
          },
        ]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
