// lib/jobs/db-url — the database role the worker process connects as (security review 2026-10-20, F3; migration 0032;
// deploy/README.md «نقش app_worker»). Pure, no imports: scripts/worker.ts calls it BEFORE src/lib/env.ts is loaded (the
// env module parses process.env at import, and the one pool of src/db/client is built from DATABASE_URL).
//
//   • WORKER_DATABASE_URL set → the worker's own role, `app_worker`: the only role that may call app.claim_jobs and write
//     ops.schedule once it exists (app.apply_grants mirrors app_rw's grants and policies on it, nothing more).
//   • unset → DATABASE_URL (app_rw), the FALLBACK until the operator has created the role — app.apply_grants leaves
//     app_rw the claim and the schedules for exactly as long as app_worker does not exist.
// A WORKER_DATABASE_URL that is not a postgres:// URL refuses to start rather than guess.

export type WorkerDatabaseUrl = { url: string; role: "worker" | "app-fallback" } | { error: string };

export function workerDatabaseUrl(env: Readonly<Record<string, string | undefined>>): WorkerDatabaseUrl {
  const own = env.WORKER_DATABASE_URL?.trim();
  if (own) {
    let protocol: string;
    try {
      protocol = new URL(own).protocol;
    } catch {
      return { error: "WORKER_DATABASE_URL is not a URL" };
    }
    if (protocol !== "postgres:" && protocol !== "postgresql:") return { error: "WORKER_DATABASE_URL must be a postgres:// URL" };
    return { url: own, role: "worker" };
  }
  const app = env.DATABASE_URL?.trim();
  if (!app) return { error: "neither WORKER_DATABASE_URL nor DATABASE_URL is set" };
  return { url: app, role: "app-fallback" };
}
