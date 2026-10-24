// The worker's database role (src/lib/jobs/db-url.ts; security review 2026-10-20, F3; migration 0032): its own
// WORKER_DATABASE_URL (app_worker) when set, DATABASE_URL (app_rw) as the fallback until the role exists; a malformed
// value refuses to start.
import { describe, expect, it } from "vitest";
import { workerDatabaseUrl } from "@/lib/jobs/db-url";

const APP = "postgres://app_rw:x@db:5432/app";
const WORKER = "postgres://app_worker:y@db:5432/app";

describe("workerDatabaseUrl", () => {
  it("the worker's own role wins; the app's is the fallback", () => {
    expect(workerDatabaseUrl({ DATABASE_URL: APP, WORKER_DATABASE_URL: WORKER })).toEqual({ url: WORKER, role: "worker" });
    expect(workerDatabaseUrl({ DATABASE_URL: APP, WORKER_DATABASE_URL: `  ${WORKER}  ` })).toEqual({ url: WORKER, role: "worker" });
    expect(workerDatabaseUrl({ DATABASE_URL: APP })).toEqual({ url: APP, role: "app-fallback" });
    expect(workerDatabaseUrl({ DATABASE_URL: APP, WORKER_DATABASE_URL: "   " })).toEqual({ url: APP, role: "app-fallback" });
    expect(workerDatabaseUrl({ DATABASE_URL: APP, WORKER_DATABASE_URL: "postgresql://app_worker:y@db/app" })).toMatchObject({ role: "worker" });
  });

  it("refuses what it cannot use", () => {
    expect(workerDatabaseUrl({ DATABASE_URL: APP, WORKER_DATABASE_URL: "not a url" })).toEqual({ error: "WORKER_DATABASE_URL is not a URL" });
    expect(workerDatabaseUrl({ DATABASE_URL: APP, WORKER_DATABASE_URL: "mysql://u:p@db/app" })).toEqual({ error: "WORKER_DATABASE_URL must be a postgres:// URL" });
    expect(workerDatabaseUrl({})).toEqual({ error: "neither WORKER_DATABASE_URL nor DATABASE_URL is set" });
  });
});
