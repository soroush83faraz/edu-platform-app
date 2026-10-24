// Environment for integration tests. Imported by the global setup (main process) AND by setup.ts (every
// worker) BEFORE `@/db/client` is loaded, so `src/lib/env.ts` sees the *_TEST connection strings.
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath); // never overrides variables that are already set
  } catch {
    /* fall through: the checks below report what is missing */
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — copy .env.example to .env and run \`pnpm db:up\``);
  if (!/_test(\?|$)/.test(v)) throw new Error(`${name} must point at a database whose name ends with _test (got ${v})`);
  return v;
}

/** app_rw on app_test — what the application uses. */
export const RW_URL = required("DATABASE_URL_TEST");
/** app_owner on app_test — migrations and fixtures only. */
export const OWNER_URL = required("MIGRATION_DATABASE_URL_TEST");
/** app_backup on app_test — BACKUP_DATABASE_URL_TEST, else BACKUP_DATABASE_URL re-pointed at the test database. */
export const BACKUP_URL = backupTestUrl();

function backupTestUrl(): string {
  if (process.env.BACKUP_DATABASE_URL_TEST) return required("BACKUP_DATABASE_URL_TEST");
  const base = process.env.BACKUP_DATABASE_URL;
  if (!base) throw new Error("BACKUP_DATABASE_URL (or BACKUP_DATABASE_URL_TEST) is not set — copy .env.example to .env");
  const u = new URL(base);
  u.pathname = new URL(RW_URL).pathname; // same test database as app_rw (…/app_test)
  return u.toString();
}

/**
 * app_worker on app_test — the background worker's own role (migration 0032): WORKER_DATABASE_URL_TEST, else
 * WORKER_DATABASE_URL re-pointed at the test database, else (the dev container's defaults) app_worker with
 * APP_WORKER_PASSWORD / `app_worker_dev` on app_rw's host. Used only when the cluster HAS the role: the global setup
 * decides (EDU_TEST_WORKER_URL, inherited by every test worker) — without it the worker runs as app_rw, the fallback,
 * and tests/int/jobs.test.ts asserts whichever state the cluster is in.
 */
export const WORKER_URL = workerTestUrl();

function workerTestUrl(): string | null {
  if (process.env.WORKER_DATABASE_URL_TEST) return required("WORKER_DATABASE_URL_TEST");
  const base = process.env.WORKER_DATABASE_URL;
  if (base) {
    const u = new URL(base);
    u.pathname = new URL(RW_URL).pathname; // same test database as app_rw (…/app_test)
    return u.toString();
  }
  const u = new URL(RW_URL);
  u.username = "app_worker";
  u.password = process.env.APP_WORKER_PASSWORD ?? "app_worker_dev";
  return u.toString();
}

// Point the app's own env at the test database and fill the non-DB variables env.ts insists on.
process.env.DATABASE_URL = RW_URL;
process.env.MIGRATION_DATABASE_URL = OWNER_URL;
process.env.SESSION_SECRET ??= "integration-test-session-secret-0123456789abcdef";
process.env.PUBLIC_ORIGIN ??= "http://localhost:3000";
process.env.INITIAL_PASSWORD_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
