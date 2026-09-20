// scripts/seed.ts --catalog must be idempotent: a second run changes no counts. Runs the real seedCatalog against
// app_test as app_owner (its own Pool, like the CLI). The catalog rows it adds are removed again in afterAll by
// re-creating the fixture database, because later files (alphabetically) assert exact template lists.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { runMigrations } from "../../scripts/migrate";
import { NOTIFICATION_TYPES, SYSTEM_ROLES, SYSTEM_WORK_ITEM_TYPES, catalogCounts, seedCatalog } from "../../scripts/seed";
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
});
