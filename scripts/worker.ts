// The background worker (owner 2026-10-20, docs/decisions.md «صف، زمان‌بند و Feature Flag»): runs the jobs of
// ops.job and fires the recurring schedules (src/lib/jobs). Development: `pnpm worker` (reads ./.env). Production: the
// `worker` compose service runs `node scripts/worker.mjs` — this file bundled by scripts/build-worker.ts at
// `pnpm build` — in the app's own image, as its OWN role app_worker (WORKER_DATABASE_URL; migration 0032 — or, until the
// operator has created that role, app_rw on DATABASE_URL), with the files volume mounted (the file sweeps).
// SIGTERM / SIGINT stop it gracefully (WORKER_SHUTDOWN_GRACE_MS); exit 1 on a start-up error. Logs: one JSON line per
// job run (docs/ops/runbook.md «کارهای پس‌زمینه»).
import fs from "node:fs";
import path from "node:path";
import { workerDatabaseUrl } from "../src/lib/jobs/db-url";

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* unreadable .env: env.ts reports what is missing */
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  // The worker's own database role (security review 2026-10-20, F3): the ONE pool (src/db/client) is built from
  // DATABASE_URL, so point it at WORKER_DATABASE_URL before anything imports the env module.
  const db = workerDatabaseUrl(process.env);
  if ("error" in db) throw new Error(db.error);
  process.env.DATABASE_URL = db.url;
  if (db.role === "app-fallback") {
    console.error("worker: WORKER_DATABASE_URL is not set — connecting as the app's role (DATABASE_URL). Create app_worker and set it (deploy/README.md).");
  }
  // Dynamic imports: src/lib/env.ts validates process.env at import time, so .env must be loaded first.
  const { runWorker, workerConfig } = await import("../src/lib/jobs/worker");
  const { REGISTRY } = await import("../src/lib/jobs/handlers");
  const { SCHEDULES } = await import("../src/modules/ops/schedules");
  const ac = new AbortController();
  let signals = 0;
  const stop = (sig: string) => {
    signals++;
    if (signals > 1) process.exit(130); // a second signal: do not wait
    console.error(`worker: ${sig} — stopping`);
    ac.abort();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  await runWorker({ ...workerConfig(), registry: REGISTRY, schedules: SCHEDULES, signal: ac.signal });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("worker: failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
