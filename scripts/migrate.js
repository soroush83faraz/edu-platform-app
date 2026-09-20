// Applies the committed SQL migrations in /drizzle as the schema owner (app_owner) — the `migrate` service in
// deploy/compose.yml runs `node scripts/migrate.js` inside the standalone image.
//
// Plain CommonJS with `pg` as its only dependency: Next's standalone output bundles drizzle-orm into the route
// chunks, so the package is NOT available to a script inside the image, while `pg` is always traced as a real
// node_modules package. The algorithm mirrors drizzle-orm's migrate() byte for byte (same
// drizzle.__drizzle_migrations table, same sha256 hash, same "created_at < journal.when" rule), so
// scripts/migrate.ts (drizzle's migrate(), used locally) and this file are interchangeable —
// tests/int/migrate.test.ts proves it in both directions.
//
//   node scripts/migrate.js          -> MIGRATION_DATABASE_URL
//   node scripts/migrate.js --test   -> MIGRATION_DATABASE_URL_TEST
//
// All pending migrations run in ONE transaction; a failure leaves the database untouched.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const MIGRATIONS_FOLDER = path.resolve(__dirname, "..", "drizzle");
const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";

/** Loads ./.env for local runs (never overrides variables already set; Docker uses env_file). */
function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* unreadable .env: the missing-variable error below is clearer */
  }
}

/** @returns {{ tag: string, when: number, sql: string[], hash: string }[]} */
function readMigrations() {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) throw new Error(`Can't find ${journalPath}`);
  /** @type {{ entries: { tag: string, when: number }[] }} */
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  return journal.entries.map((entry) => {
    const file = path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) throw new Error(`No file ${file} found in ${MIGRATIONS_FOLDER} folder`);
    const query = fs.readFileSync(file).toString();
    return {
      tag: entry.tag,
      when: entry.when,
      sql: query.split("--> statement-breakpoint"),
      hash: crypto.createHash("sha256").update(query).digest("hex"),
    };
  });
}

/**
 * @param {{ test?: boolean; connectionString?: string }} [options]
 * @returns {Promise<{ applied: number; total: number }>} migrations applied by this run / listed in the journal
 */
async function runMigrations(options = {}) {
  loadDotEnv();
  const varName = options.test ? "MIGRATION_DATABASE_URL_TEST" : "MIGRATION_DATABASE_URL";
  const connectionString = options.connectionString ?? process.env[varName];
  if (!connectionString) throw new Error(`${varName} is not set (see .env.example)`);
  if (options.test && !/_test(\?|$)/.test(connectionString)) {
    throw new Error(`${varName} must point at a database whose name ends with _test`);
  }

  const migrations = readMigrations();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    const last = await client.query(`select created_at from ${MIGRATIONS_TABLE} order by created_at desc limit 1`);
    const lastMillis = last.rows.length > 0 ? Number(last.rows[0].created_at) : null;

    let applied = 0;
    await client.query("BEGIN");
    try {
      for (const m of migrations) {
        if (lastMillis !== null && lastMillis >= m.when) continue;
        for (const stmt of m.sql) await client.query(stmt);
        await client.query(`insert into ${MIGRATIONS_TABLE} ("hash", "created_at") values ($1, $2)`, [m.hash, m.when]);
        applied += 1;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    return { applied, total: migrations.length };
  } finally {
    await client.end();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  const test = process.argv.includes("--test");
  runMigrations({ test })
    .then(({ applied, total }) => {
      console.log(`[migrate] ${test ? "app_test" : "app"}: ${applied} applied, ${total} total`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
