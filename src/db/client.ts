// The ONLY database access boundary. Exports exactly `withTenant`, `withoutTenant` and the `Tx` type.
// The pg Pool and the Drizzle instance never leave this module (ESLint restricts who may import it).
//
// RLS contract: every tenant table is FORCE ROW LEVEL SECURITY with
//   USING (organization_id = app.current_org_id()) — NULL when unset -> nothing matches (fail closed).
// `withTenant` sets `app.current_org_id` with set_config(..., is_local = true) as the FIRST statement of a
// transaction, so the setting dies with the transaction and can never leak to another request through the
// pool. `withoutTenant` runs a transaction with no organization context: usable ONLY for the global tables
// (organization, user_account, auth_identity, user_session, login_attempt, permission, role_permission).
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __eduPgPool?: Pool };

function createPool(): Pool {
  const p = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  // An idle client dropped by the server (restart, failover) must never become an uncaught exception.
  p.on("error", (err) => logger.error({ err }, "pg pool: idle client error"));
  return p;
}

// In development the module is re-evaluated on every HMR cycle; keep one pool per process.
const pool: Pool =
  env.NODE_ENV === "production" ? createPool() : (globalForDb.__eduPgPool ??= createPool());

const db = drizzle({ client: pool, schema });

export type Tx = PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export interface TenantContext {
  /** tenancy.organization.id of the current request — from the session, never from client input. */
  orgId: string;
  /** iam.person.id of the acting user inside that organization (audit `created_by`). */
  personId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside one transaction whose first statement pins the tenant (`app.current_org_id`) and the
 * acting person (`app.current_person_id`) for the duration of that transaction only.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(ctx.orgId)) throw new Error("withTenant: ctx.orgId must be a UUID");
  if (ctx.personId !== undefined && !UUID_RE.test(ctx.personId)) {
    throw new Error("withTenant: ctx.personId must be a UUID when provided");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org_id', ${ctx.orgId}, true), set_config('app.current_person_id', ${ctx.personId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** Transaction with NO tenant context. Global tables only; tenant tables return/accept nothing here. */
export async function withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}
