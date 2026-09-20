import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate";
import { OWNER_URL } from "./env";
import { dropAppSchemas, seed } from "./global-setup";
import { asAppOwner } from "./helpers";

const JOURNAL = JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8")) as {
  entries: { tag: string; when: number }[];
};

interface Ledger {
  n: number;
  last: string | null;
  hashes: string[];
}

async function ledger(): Promise<Ledger> {
  return asAppOwner(async (c) => {
    const res = await c.query<{ n: number; last: string | null; hashes: string[] | null }>(
      `select count(*)::int as n, max(created_at)::text as last,
              array_agg(hash order by created_at) as hashes
         from drizzle.__drizzle_migrations`,
    );
    return { n: res.rows[0].n, last: res.rows[0].last, hashes: res.rows[0].hashes ?? [] };
  });
}

/** The image's runner: `node scripts/migrate.js --test`, exactly as the `migrate` service invokes it. */
function runImageMigrator(): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [path.resolve("scripts/migrate.js"), "--test"], {
    encoding: "utf8",
    env: { ...process.env, MIGRATION_DATABASE_URL_TEST: OWNER_URL },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe("migrator", () => {
  it("running scripts/migrate.ts (drizzle migrate()) again is a no-op", async () => {
    const before = await ledger();
    expect(before.n).toBe(JOURNAL.entries.length);

    const result = await runMigrations({ test: true, connectionString: OWNER_URL });
    expect(result).toEqual({ applied: 0, total: JOURNAL.entries.length });
    expect(await ledger()).toEqual(before);
  });

  it("scripts/migrate.js (image runner, pg only) is a no-op on a database migrated by drizzle", async () => {
    const before = await ledger();
    const run = runImageMigrator();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`0 applied, ${JOURNAL.entries.length} total`);
    expect(await ledger()).toEqual(before);
  });

  it("a fresh database migrated by scripts/migrate.js is byte-identical to one migrated by drizzle", async () => {
    const byDrizzle = await ledger();
    try {
      await dropAppSchemas();
      const run = runImageMigrator();
      expect(run.stderr, run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain(`${JOURNAL.entries.length} applied, ${JOURNAL.entries.length} total`);

      const byImage = await ledger();
      expect(byImage.hashes).toEqual(byDrizzle.hashes);
      expect(byImage.last).toBe(byDrizzle.last);

      // ...and drizzle's own migrator then has nothing left to do.
      const result = await runMigrations({ test: true, connectionString: OWNER_URL });
      expect(result.applied).toBe(0);
    } finally {
      // Other test files rely on the fixtures; put them back whatever happened above.
      await seed();
    }
  });

  it("refuses a --test run against a database whose name does not end with _test", async () => {
    await expect(
      runMigrations({ test: true, connectionString: "postgres://app_owner:x@localhost:5433/app" }),
    ).rejects.toThrow(/_test/);
  });
});
