import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withoutTenant } from "@/db/client";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Number of migrations committed in /drizzle (the journal is copied into the image next to the SQL). */
function journalCount(): number {
  const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  return journal.entries.length;
}

/**
 * Liveness/readiness probe used by Docker HEALTHCHECK and deploy.sh.
 * 200: DB reachable (`select 1` as app_rw). 503: DB unreachable. `pendingMigrations` > 0 means the
 * `migrate` service has not run for this image yet (reported, not failed — the app still serves).
 */
export async function GET() {
  const base = { version: process.env.APP_VERSION ?? "dev", time: new Date().toISOString() };
  try {
    const applied = await withoutTenant(async (tx) => {
      await tx.execute(sql`select 1`);
      const res = await tx.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      return res.rows[0]?.n ?? 0;
    });
    const pendingMigrations = Math.max(0, journalCount() - applied);
    return NextResponse.json({ ok: true, db: "up", pendingMigrations, ...base }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, db: "down", ...base }, { status: 503, headers: NO_STORE });
  }
}
