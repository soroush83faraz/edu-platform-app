// `pnpm db:reset:test` — drop + recreate `app_test` inside the dev container (as postgres), then migrate.
// Local development only; uses docker compose exec so no psql is needed on the host.
import { spawnSync } from "node:child_process";
import { runMigrations } from "./migrate";

const COMPOSE = ["compose", "-f", "docker-compose.dev.yml", "exec", "-T", "db", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"];

function psql(database: string, ...statements: string[]) {
  const args = [...COMPOSE, "-d", database, ...statements.flatMap((s) => ["-c", s])];
  const res = spawnSync("docker", args, { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`psql failed (exit ${res.status}) — is the dev DB up? (pnpm db:up)`);
}

psql(
  "postgres",
  "DROP DATABASE IF EXISTS app_test WITH (FORCE)",
  "CREATE DATABASE app_test OWNER app_owner ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0",
);
psql("app_test", "CREATE EXTENSION IF NOT EXISTS btree_gist", "CREATE EXTENSION IF NOT EXISTS pg_trgm");

runMigrations({ test: true })
  .then(({ applied, total }) => {
    console.log(`[db:reset:test] app_test recreated: ${applied} applied, ${total} total`);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("[db:reset:test] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
