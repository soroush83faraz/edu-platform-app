import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe used by Docker HEALTHCHECK and deploy.sh.
 * TODO(db-block): add `select 1` via withoutTenant + pending-migrations count; return 503 when the DB is unreachable.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      version: process.env.APP_VERSION ?? "dev",
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
