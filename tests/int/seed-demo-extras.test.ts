// scripts/seed-demo-extras.ts must be idempotent and must speak the CURRENT notification policy. Seeds the pilot
// (scaled down), turns one notification title back into the old «کار جدید: …» wording, runs the demo extras twice as
// app_owner (the CLI's code path) and checks: the second run writes nothing, every role got its content, the managers'
// and the first دبیر's bells hold read AND unread rows, nobody was notified of an assignee's «انجام شد», and the old
// title is renamed. The rows it adds are removed in afterAll by re-creating the fixture database.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { DEMO_ITEMS } from "../../scripts/demo-extras-plan";
import { demoExtrasCounts, seedDemoExtras } from "../../scripts/seed-demo-extras";
import { ALLAMEH, pilotId, seedPilot, withOrg } from "../../scripts/seed-pilot";
import { OWNER_URL } from "./env";
import { dropAppSchemas, seed } from "./global-setup";

describe("seed:demo-extras", () => {
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("a second run writes nothing; every role gets content under the current notification policy", async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      const db = drizzle({ client: pool, schema });
      await seedCatalog(db);
      await seedPilot(db, { scale: 0.2, password: "Pilot-test-pass" });

      // One legacy title, as databases seeded before the «تکلیف» wording still hold them.
      const alkOrg = pilotId(`org:${ALLAMEH.key}`);
      const legacy = await withOrg(db, alkOrg, async (tx) => {
        const res = await tx.execute<{ id: string; title: string }>(sql`
          update notif.notification set title = 'کار جدید: ' || substr(title, length('تکلیف جدید: ') + 1)
          where id = (select id from notif.notification where type_code = 'work_item.assigned' and title like 'تکلیف جدید: %' order by id limit 1)
          returning id, title`);
        return res.rows[0];
      });
      expect(legacy.title.startsWith("کار جدید: ")).toBe(true);

      const run1 = await seedDemoExtras(db);
      const first = await demoExtrasCounts(db);
      const run2 = await seedDemoExtras(db);
      const second = await demoExtrasCounts(db);

      expect(second).toEqual(first);
      expect(run1.skipped).toEqual([]);
      for (const o of run1.orgs) {
        expect(o.created).toBe(DEMO_ITEMS.length);
        expect(o.extended).toBe(DEMO_ITEMS.filter((i) => i.extendTo).length);
        expect(o.closed).toBe(DEMO_ITEMS.filter((i) => i.closeByGiver).length);
        expect(o.doneMarks).toBeGreaterThan(0);
        expect(o.readMarks).toBeGreaterThan(0);
      }
      for (const o of run2.orgs) expect(o).toMatchObject({ created: 0, doneMarks: 0, closed: 0, extended: 0, readMarks: 0, renamedTitles: 0 });
      expect(run1.orgs.find((o) => o.slug === ALLAMEH.slug)?.renamedTitles).toBe(1);

      for (const o of run1.orgs) {
        const view = (role: string) => o.roles.find((r) => r.role === role)!;
        // Nothing in the current policy notifies the organization admin (nobody gives them work; completions are silent).
        expect(view("org admin")).toMatchObject({ notifications: 0 });
        expect(view("org admin").givenOpen).toBeGreaterThan(0);
        expect(view("org admin").personalOpen).toBeGreaterThan(0);
        for (const role of ["principal", "vice", "teacher-1"]) {
          expect(view(role).assignedOpen).toBeGreaterThan(0);
          expect(view(role).unread).toBeGreaterThan(0);
        }
        for (const role of ["principal", "teacher-1"]) expect(view(role).unread).toBeLessThan(view(role).notifications);
        expect(view("principal").givenOpen).toBeGreaterThan(0);
        expect(view("teacher-1").givenOpen).toBeGreaterThan(0);
        expect(view("student-0").personalOpen).toBeGreaterThan(0);
      }

      const alk = await withOrg(db, alkOrg, async (tx) => {
        const one = async (q: ReturnType<typeof sql>) => (await tx.execute<{ n: number }>(q)).rows[0].n;
        return {
          // an assignee's «انجام شد» writes no notification: every status notification is a giver's «وضعیت «…»: …»
          byAssignee: await one(sql`select count(*)::int as n from notif.notification where type_code = 'work_item.status_changed' and title not like 'وضعیت «%'`),
          extendedToPrincipal: await one(sql`select count(*)::int as n from notif.notification where type_code = 'work_item.due_extended' and recipient_person_id = ${pilotId("alk:person:principal")}`),
          legacyLeft: await one(sql`select count(*)::int as n from notif.notification where title like 'کار جدید: %'`),
          renamed: await one(sql`select count(*)::int as n from notif.notification where id = ${legacy.id} and title like 'تکلیف جدید: %'`),
          auditBySeed: await one(sql`select count(*)::int as n from audit.audit_log where request_id = 'seed-demo-extras'`),
        };
      });
      expect(alk).toMatchObject({ byAssignee: 0, extendedToPrincipal: 1, legacyLeft: 0, renamed: 1 });
      expect(alk.auditBySeed).toBeGreaterThan(DEMO_ITEMS.length);

      // --prune-legacy-status: an assignee status notification written under the old policy is deleted; the giver's
      // «وضعیت «…»: …» rows and everything else stay.
      await withOrg(db, alkOrg, (tx) =>
        tx.execute(sql`
          insert into notif.notification (id, organization_id, recipient_person_id, type_code, title, source_kind, source_id)
          select gen_random_uuid(), organization_id, recipient_person_id, type_code, 'دانش‌آموز «' || title || '» را انجام‌شده کرد (۱/۵)', source_kind, source_id
          from notif.notification where type_code = 'work_item.status_changed' order by id limit 1`),
      );
      const pruned = await seedDemoExtras(db, { pruneLegacyStatus: true });
      expect(pruned.orgs.map((o) => o.prunedStatus)).toEqual([1, 0, 0]);
      expect(pruned.orgs.every((o) => o.created === 0)).toBe(true);
      expect(await demoExtrasCounts(db)).toEqual(first);
    } finally {
      await pool.end();
    }
  }, 300_000);
});
