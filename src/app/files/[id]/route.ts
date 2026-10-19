// GET /files/<file id> — a file of a تکلیف or of a پاسخ («پیوست تکلیف و تحویل پاسخ», owner 2026-10-19;
// docs/decisions.md). Authorization is re-decided on EVERY request (defineQuery → workspace/file-access `findDownload`:
// the file live and attached, its تکلیف visible to the caller, a پاسخ's file only to its student and the تکلیف's
// managers). Anything else — unknown id, archived, pending, another tenant's, not yours — is the same bare 404, so a
// file's existence never leaks. A dead session goes to the login (and back here after it, `?next=`). Served with the
// headers of untrusted content (src/modules/files/serve.ts); the service worker never caches it
// (src/lib/pwa/should-cache.ts: network-only). No Range support.
import { type NextRequest } from "next/server";
import { loginRedirectHref } from "@/lib/ctx";
import { logger } from "@/lib/logger";
import { fileResponseHeaders } from "@/modules/files/serve";
import { openStored } from "@/modules/files/storage";
import { fileDownloadQuery } from "@/modules/workspace/queries";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): Response {
  return new Response("موردی یافت نشد.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "private, no-store" } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const result = await fileDownloadQuery({ fileId: id.toLowerCase() });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") return seeOther(await loginRedirectHref());
    if (result.code === "PASSWORD_CHANGE_REQUIRED") return seeOther("/change-password");
    return notFound();
  }
  const file = result.data;
  const stored = await openStored(file.storageKey);
  if (!stored) return notFound();
  if (stored.size !== file.sizeBytes) {
    await stored.stream.cancel().catch(() => undefined);
    logger.error({ fileId: id }, "files: stored size differs from its row — not served");
    return notFound();
  }
  return new Response(stored.stream, { status: 200, headers: fileResponseHeaders(file.kind, file.name, stored.size) });
}
