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

// Point the app's own env at the test database and fill the non-DB variables env.ts insists on.
process.env.DATABASE_URL = RW_URL;
process.env.MIGRATION_DATABASE_URL = OWNER_URL;
process.env.SESSION_SECRET ??= "integration-test-session-secret-0123456789abcdef";
process.env.PUBLIC_ORIGIN ??= "http://localhost:3000";
