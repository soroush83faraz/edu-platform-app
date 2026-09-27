// The catalog seed as a `pg`-only CLI — the entry that `scripts/build-seed-catalog.ts` compiles at `pnpm build` into
// the single-file `scripts/seed-catalog.js` (CommonJS, gitignored) which the `seed` service of deploy/compose.yml
// runs inside the standalone image right after `migrate`:
//
//   node scripts/seed-catalog.js          -> MIGRATION_DATABASE_URL       (app_owner; the deploy)
//   node scripts/seed-catalog.js --test   -> MIGRATION_DATABASE_URL_TEST  (database name must end with _test)
//   pnpm tsx scripts/seed-catalog.ts      -> the same, uncompiled (local)
//
// Prints the same «[seed] catalog: …» and «[seed] organization catalog: …» lines as `pnpm seed`
// (`scripts/seed.ts --catalog` — both call `seedCatalogWith` + `seedOrgCatalogsWith` from ./catalog, so there is
// one implementation). Idempotent; exit 1 on error. Unlike scripts/seed.ts it needs no SEED_ALLOW=1 in production:
// it writes the permission / role / type catalog and the FIXED structure catalog of each organization (مقطع‌ها,
// پایه‌ها, سال‌های تحصیلی — additive, never deletes) — no accounts, no people — and running it on every deploy is
// exactly the point (deploy/README.md).
//
// Deliberately no `import.meta` / `require.main` guard: this file is a program, not a library (the compiled bundle
// wraps it in its own module registry). Imports: `pg`, `node:*` and ./catalog only (the build refuses more).
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { catalogCountsWith, formatCatalogSummary, formatOrgCatalogSummary, seedCatalogWith, seedOrgCatalogsWith } from "./catalog";

/** Loads ./.env for local runs (never overrides variables already set; Docker uses env_file). */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* unreadable .env: the missing-variable error below is clearer */
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const test = process.argv.includes("--test");
  const varName = test ? "MIGRATION_DATABASE_URL_TEST" : "MIGRATION_DATABASE_URL";
  const connectionString = process.env[varName];
  if (!connectionString) throw new Error(`${varName} is not set (see .env.example)`);
  if (test && !/_test(\?|$)/.test(connectionString)) throw new Error(`${varName} must point at a database whose name ends with _test`);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await seedCatalogWith(client);
    console.log(formatCatalogSummary(await catalogCountsWith(client)));
    // Then the fixed مقطع/پایه/سال catalog of every organization (one transaction each; tenant rows under RLS).
    console.log(formatOrgCatalogSummary(await seedOrgCatalogsWith(client)));
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
