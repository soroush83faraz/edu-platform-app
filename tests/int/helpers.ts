import { Client } from "pg";
import { OWNER_URL, RW_URL } from "./env";

/** Opens a raw pg connection as the application role (app_rw) — proves role-level behaviour, not just the wrapper. */
export async function asAppRw<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  return withClient(RW_URL, fn);
}

/** Opens a raw pg connection as the schema owner (app_owner). Read-only inspection in tests. */
export async function asAppOwner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  return withClient(OWNER_URL, fn);
}

async function withClient<T>(connectionString: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Runs `fn` in a transaction that is ALWAYS rolled back (writes never leak into other tests). */
export async function inRolledBackTx<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

/** Thrown from inside withTenant/withoutTenant to roll the transaction back after a successful write. */
export class Rollback extends Error {
  constructor() {
    super("rollback");
  }
}

/** SQLSTATE of a pg error, also when drizzle wrapped it (DrizzleQueryError.cause). */
export function pgCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  return pgCode(e.cause);
}

export const PG = {
  INSUFFICIENT_PRIVILEGE: "42501", // RLS WITH CHECK violation / missing grant
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
} as const;
