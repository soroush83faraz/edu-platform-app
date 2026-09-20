// GET /api/inbox/summary → { overdue, dueToday, unread, unreadNotifications } for the badge poller. Same gate as
// every page (defineQuery: session → must-change → permission); never cached.
import { NextResponse } from "next/server";
import { HTTP_STATUS } from "@/lib/errors";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const result = await inboxSummaryQuery();
  if (!result.ok) return NextResponse.json({ ok: false, code: result.code }, { status: HTTP_STATUS[result.code], headers: NO_STORE });
  return NextResponse.json(result.data, { headers: NO_STORE });
}
