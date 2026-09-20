// Applies the committed SQL migrations in /drizzle as the schema owner (app_owner).
//   pnpm db:migrate         -> MIGRATION_DATABASE_URL       (tsx scripts/migrate.ts)
//   pnpm db:migrate:test    -> MIGRATION_DATABASE_URL_TEST  (tsx scripts/migrate.ts --test)
// The Docker image runs scripts/migrate.js instead: a pg-only re-implementation of the same algorithm (Next's
// standalone output does not ship drizzle-orm as a package). tests/int/migrate.test.ts proves both agree.
// All pending migrations run in ONE transaction; a failure leaves the database untouched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/** Loads ./.env for local runs (never overrides variables already set). */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* unreadable .env: the missing-variable error below is clearer */
  }
}

export interface MigrateOptions {
  /** Use MIGRATION_DATABASE_URL_TEST (database name must end with `_test`). */
  test?: boolean;
  /** Override the connection string (tests). */
  connectionString?: string;
}

export interface MigrateResult {
  /** Migrations applied by this run. */
  applied: number;
  /** Migrations listed in drizzle/meta/_journal.json. */
  total: number;
}

export async function runMigrations(options: MigrateOptions = {}): Promise<MigrateResult> {
  loadDotEnv();
  const varName = options.test ? "MIGRATION_DATABASE_URL_TEST" : "MIGRATION_DATABASE_URL";
  const connectionString = options.connectionString ?? process.env[varName];
  if (!connectionString) throw new Error(`${varName} is not set (see .env.example)`);
  if (options.test && !/_test(\?|$)/.test(connectionString)) {
    throw new Error(`${varName} must point at a database whose name ends with _test`);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const before = await countApplied(pool);
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await countApplied(pool);
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
      entries: unknown[];
    };
    return { applied: after - before, total: journal.entries.length };
  } finally {
    await pool.end();
  }
}

async function countApplied(pool: Pool): Promise<number> {
  const exists = await pool.query<{ n: number }>(
    "select count(*)::int as n from pg_tables where schemaname = 'drizzle' and tablename = '__drizzle_migrations'",
  );
  if (exists.rows[0].n === 0) return 0;
  const res = await pool.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
  return res.rows[0].n;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const test = process.argv.includes("--test");
  runMigrations({ test })
    .then(({ applied, total }) => {
      console.log(`[migrate] ${test ? "app_test" : "app"}: ${applied} applied, ${total} total`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
