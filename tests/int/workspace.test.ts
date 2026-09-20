// workspace + notif (step 2): inbox_entry UNIQUE(person, work_item), the notification dedupe partial unique, and
// the work_item_type system templates (organization_id NULL) — same per-command RLS shape as iam.role
// (tests/int/rls-templates.test.ts), inherited automatically because app.apply_rls() reads nullability from the catalog.
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { inboxEntry, notification, workItem } from "@/db/schema";
import * as f from "./fixtures";
import { PG, Rollback, asAppOwner, asAppRw, inRolledBackTx, pgCode } from "./helpers";

const UNIQUE_VIOLATION = "23505";
const ORG_CTX = "select set_config('app.current_org_id', $1, true)";
const ctxA = { orgId: f.ORG_A, personId: f.PERSON_A1 };

describe("inbox_entry UNIQUE(person_id, work_item_id)", () => {
  it("one inbox row per (person, work item); the second insert is 23505 (rolled back)", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [wi] = await tx
          .insert(workItem)
          .values({ organizationId: f.ORG_A, typeId: f.WIT_TEMPLATE, statusId: f.WIS_OPEN, title: "تکلیف ریاضی", createdByPersonId: f.PERSON_A1 })
          .returning({ id: workItem.id });
        const entry = { organizationId: f.ORG_A, personId: f.PERSON_A1, workItemId: wi.id };
        await tx.insert(inboxEntry).values({ ...entry, relation: "creator" });
        await expect(tx.transaction((sp) => sp.insert(inboxEntry).values({ ...entry, relation: "assignee" }))).rejects.toSatisfy(
          (err: unknown) => pgCode(err) === UNIQUE_VIOLATION,
        );
        // Another person for the same item is fine.
        await tx.insert(inboxEntry).values({ ...entry, personId: f.PERSON_A2, relation: "assignee" });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("work_item title CHECK: empty title is rejected (23514)", async () => {
    await expect(
      withTenant(ctxA, (tx) => tx.insert(workItem).values({ organizationId: f.ORG_A, typeId: f.WIT_TEMPLATE, statusId: f.WIS_OPEN, title: "", createdByPersonId: f.PERSON_A1 })),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
  });
});

describe("notification dedupe (partial unique on recipient + dedupe_key)", () => {
  it("same (recipient, dedupe_key) twice → 23505; ON CONFLICT DO NOTHING inserts 0; NULL keys never collide", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const base = { organizationId: f.ORG_A, recipientPersonId: f.PERSON_A1, typeCode: f.NT_CODE, title: "اطلاعیه" };
        await tx.insert(notification).values({ ...base, dedupeKey: "due:wi-1" });
        await expect(tx.transaction((sp) => sp.insert(notification).values({ ...base, dedupeKey: "due:wi-1" }))).rejects.toSatisfy(
          (err: unknown) => pgCode(err) === UNIQUE_VIOLATION,
        );
        const dedup = await tx
          .insert(notification)
          .values({ ...base, dedupeKey: "due:wi-1" })
          .onConflictDoNothing()
          .returning({ id: notification.id });
        expect(dedup).toEqual([]);
        // Same key for another recipient, and two NULL-key rows for the same recipient: all accepted.
        await tx.insert(notification).values({ ...base, recipientPersonId: f.PERSON_A2, dedupeKey: "due:wi-1" });
        await tx.insert(notification).values([{ ...base }, { ...base }]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe("work_item_type system templates are read-only for tenants (app_rw)", () => {
  it("under org A: the template and A's own type are visible, B's is not; template DELETE/UPDATE touch 0 rows", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const rows = await c.query<{ id: string }>("select id from workspace.work_item_type");
        expect(rows.rows.map((r) => r.id).sort()).toEqual([f.WIT_TEMPLATE, f.WIT_A].sort());

        const del = await c.query("delete from workspace.work_item_type where organization_id is null");
        expect(del.rowCount).toBe(0);
        const hijack = await c.query("update workspace.work_item_type set organization_id = $1 where organization_id is null", [f.ORG_A]);
        expect(hijack.rowCount).toBe(0);
        const rename = await c.query("update workspace.work_item_type set name = 'hacked' where id = $1", [f.WIT_TEMPLATE]);
        expect(rename.rowCount).toBe(0);
        const still = await c.query<{ organization_id: string | null; name: string }>("select organization_id, name from workspace.work_item_type where id = $1", [
          f.WIT_TEMPLATE,
        ]);
        expect(still.rows[0]).toEqual({ organization_id: null, name: "کار شخصی" });

        // The tenant's own type is fully writable.
        const own = await c.query("update workspace.work_item_type set name = 'ویژه' where id = $1", [f.WIT_A]);
        expect(own.rowCount).toBe(1);
      });
      for (const org of [null, f.ORG_B]) {
        await inRolledBackTx(c, async () => {
          await c.query(ORG_CTX, [f.ORG_A]);
          await expect(
            c.query("insert into workspace.work_item_type (id, organization_id, code, name) values (app.uuid_generate_v7(), $1, 'evil', 'evil')", [org]),
          ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
        });
      }
    });
  });

  it("without any tenant context: templates are readable, nothing is writable", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        const rows = await c.query<{ id: string }>("select id from workspace.work_item_type");
        expect(rows.rows.map((r) => r.id)).toEqual([f.WIT_TEMPLATE]);
        expect((await c.query("delete from workspace.work_item_type")).rowCount).toBe(0);
        expect((await c.query("update workspace.work_item_type set name = 'x'")).rowCount).toBe(0);
      });
    });
  });

  it("work_item_status (global catalog) is readable but not writable by app_rw (42501)", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        const rows = await c.query<{ code: string }>("select code from workspace.work_item_status where work_item_type_id = $1", [f.WIT_TEMPLATE]);
        expect(rows.rows.map((r) => r.code)).toEqual(["open"]);
        await expect(
          c.query("insert into workspace.work_item_status (id, work_item_type_id, code, name, category, sequence) values (app.uuid_generate_v7(), $1, 'x', 'x', 'todo', 9)", [
            f.WIT_TEMPLATE,
          ]),
        ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
    });
  });

  it("app_owner (seed) can upsert a template without tenant context (rolled back)", async () => {
    await asAppOwner(async (c) => {
      await inRolledBackTx(c, async () => {
        const upsert = await c.query<{ id: string }>(
          `insert into workspace.work_item_type (id, organization_id, code, name) values (app.uuid_generate_v7(), null, 'todo', 'کار شخصی')
           on conflict (organization_id, code) do update set name = excluded.name returning id`,
        );
        expect(upsert.rows[0].id).toBe(f.WIT_TEMPLATE);
      });
    });
  });
});
