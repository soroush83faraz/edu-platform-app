// scripts/seed.ts --catalog must be idempotent: a second run changes no counts. Runs the real seedCatalog against
// app_test as app_owner (its own Pool, like the CLI). The catalog rows it adds are removed again in afterAll by
// re-creating the fixture database, because later files (alphabetically) assert exact template lists.
// The second test builds the deploy-time bundle (scripts/seed-catalog.js, `pnpm build`) and runs it with plain
// `node` exactly as the `seed` service does — same summary line, zero diff in the catalog tables.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { buildSeedCatalog } from "../../scripts/build-seed-catalog";
import { formatCatalogSummary } from "../../scripts/catalog";
import { runMigrations } from "../../scripts/migrate";
import { DANESH, NOTIFICATION_TYPES, SYSTEM_ROLES, SYSTEM_WORK_ITEM_TYPES, catalogCounts, demoId, seedCatalog, seedDemo } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import { dropAppSchemas, seed } from "./global-setup";
import * as f from "./fixtures";

describe("seed --catalog", () => {
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("running the catalog seed twice yields identical counts, and the fixture templates are updated in place", async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      const db = drizzle({ client: pool, schema });
      const roleIds1 = await seedCatalog(db);
      const first = await catalogCounts(db);
      const roleIds2 = await seedCatalog(db);
      const second = await catalogCounts(db);

      expect(second).toEqual(first);
      expect(roleIds2).toEqual(roleIds1);
      expect(first.permissions).toBe(PERMISSIONS.length);
      // The fixture 'teacher' template (ROLE_TEMPLATE) is one of the system roles: updated in place, not duplicated.
      expect(first.roles).toBe(SYSTEM_ROLES.length);
      expect(roleIds1.teacher).toBe(f.ROLE_TEMPLATE);
      // Same for the fixture 'todo' template (WIT_TEMPLATE, with one status).
      expect(first.workItemTypes).toBe(SYSTEM_WORK_ITEM_TYPES.length);
      expect(first.workItemStatuses).toBe(SYSTEM_WORK_ITEM_TYPES.reduce((n, t) => n + t.statuses.length, 0));
      // The fixture notification type shares its code with a catalog row.
      expect(first.notificationTypes).toBe(NOTIFICATION_TYPES.length);

      const todo = await pool.query<{ id: string; requires_assignee: boolean }>(
        "select id, requires_assignee from workspace.work_item_type where organization_id is null and code = 'todo'",
      );
      expect(todo.rows).toEqual([{ id: f.WIT_TEMPLATE, requires_assignee: false }]);
      const todoStatuses = await pool.query<{ code: string }>("select code from workspace.work_item_status where work_item_type_id = $1 order by sequence", [f.WIT_TEMPLATE]);
      expect(todoStatuses.rows.map((r) => r.code)).toEqual(["open", "in_progress", "done", "cancelled"]);
    } finally {
      await pool.end();
    }
  });

  it("the compiled scripts/seed-catalog.js (pg only, the deploy's `seed` service) prints the same summary and changes nothing after the TS seed", async () => {
    const { out, modules } = buildSeedCatalog();
    // Only the entry, the catalog and the permission catalog reach the bundle — no drizzle, no zod, no schema.
    expect(modules.sort()).toEqual(["scripts/catalog", "scripts/seed-catalog", "src/modules/iam/permissions"]);

    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      const db = drizzle({ client: pool, schema });
      await seedCatalog(db);
      const snapshot = () =>
        pool.query<{ code: string; permission_code: string }>(
          "select r.code, rp.permission_code from iam.role_permission rp join iam.role r on r.id = rp.role_id where r.organization_id is null order by 1, 2",
        );
      const before = (await snapshot()).rows;
      expect(before.length).toBe(SYSTEM_ROLES.reduce((n, r) => n + r.permissions.length, 0));
      const counts = await catalogCounts(db);

      const run = spawnSync(process.execPath, [out, "--test"], { encoding: "utf8", env: { ...process.env, MIGRATION_DATABASE_URL_TEST: OWNER_URL } });
      expect(run.stderr, run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toBe(formatCatalogSummary(counts));
      expect(path.basename(out)).toBe("seed-catalog.js");

      expect((await snapshot()).rows).toEqual(before);
      expect(await catalogCounts(db)).toEqual(counts);
      // A database name that does not end with _test is refused under --test (the deploy uses MIGRATION_DATABASE_URL).
      const refused = spawnSync(process.execPath, [out, "--test"], { encoding: "utf8", env: { ...process.env, MIGRATION_DATABASE_URL_TEST: OWNER_URL.replace(/_test(\?|$)/, "$1") } });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("_test");
    } finally {
      await pool.end();
    }
  });
});

describe("seed --demo (weekly timetable)", () => {
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("every demo class ends up with a timetable, and re-seeding changes nothing", async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      const db = drizzle({ client: pool, schema });
      const roleIds = await seedCatalog(db);
      process.env.SEED_DEMO_PASSWORD = "Demo-1405-pass";
      const first = await seedDemo(db, roleIds);
      const danesh = first.counts[DANESH.slug];
      const noor = first.counts["noor-demo"];
      expect(danesh.timetableSlots).toBeGreaterThan(0);
      expect(noor.timetableSlots).toBeGreaterThan(0);

      // Every active class of both demo organizations — not just the ones a spec names — has at least one slot.
      const client = await pool.connect();
      try {
        for (const orgId of [demoId(`org:${DANESH.key}`), demoId("org:noor")]) {
          await client.query("select set_config('app.current_org_id', $1, false)", [orgId]);
          const classes = await client.query<{ id: string }>("select id from tenancy.class_group where organization_id = $1 and status = 'active'", [orgId]);
          expect(classes.rows.length).toBeGreaterThan(0);
          for (const { id } of classes.rows) {
            const slots = await client.query<{ n: string }>("select count(*)::int as n from academic.timetable_slot where class_group_id = $1", [id]);
            expect(Number(slots.rows[0].n)).toBeGreaterThan(0);
          }
        }
      } finally {
        client.release();
      }

      const second = await seedDemo(db, roleIds);
      expect(second.counts).toEqual(first.counts);
    } finally {
      await pool.end();
    }
  });
});
