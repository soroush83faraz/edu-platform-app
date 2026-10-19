// GET /files/<file id> — a file of a تکلیف or of a پاسخ («پیوست تکلیف و تحویل پاسخ», owner 2026-10-19;
// docs/decisions.md). Authorization is re-decided on EVERY request (defineQuery → workspace/file-access `findDownload`:
// the file live and attached, its تکلیف visible to the caller, a پاسخ's file only to its student and the تکلیف's
// managers). Anything else — unknown id, archived, pending, another tenant's, not yours — is the same bare 404, so a
// file's existence never leaks. A dead session goes to the login (and back here after it, `?next=`). Served with the
// headers of untrusted content (src/modules/files/serve.ts — the same set next.config.ts gives `/files/:path*`, whose
// app-wide rule excludes this path: Next would keep ITS value over ours); the service worker never caches it
// (src/lib/pwa/should-cache.ts: network-only). No Range support. HEAD is its own handler (Next would otherwise run GET
// for it and leave the opened file's stream unread): the same decision, the headers, no body, no open file.
import { type NextRequest } from "next/server";
import { loginRedirectHref } from "@/lib/ctx";
import { logger } from "@/lib/logger";
import { fileResponseHeaders } from "@/modules/files/serve";
import { openStored, statStored } from "@/modules/files/storage";
import type { DownloadMeta } from "@/modules/workspace/file-access";
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

type Decided = { ok: true; file: DownloadMeta } | { ok: false; response: Response };

/** The one decision of GET and HEAD: the caller's right to THIS file now, or the response that refuses it. */
async function decide(params: Promise<{ id: string }>): Promise<Decided> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { ok: false, response: notFound() };
  const result = await fileDownloadQuery({ fileId: id.toLowerCase() });
  if (result.ok) return { ok: true, file: result.data };
  if (result.code === "UNAUTHENTICATED") return { ok: false, response: seeOther(await loginRedirectHref()) };
  if (result.code === "PASSWORD_CHANGE_REQUIRED") return { ok: false, response: seeOther("/change-password") };
  return { ok: false, response: notFound() };
}

export async function HEAD(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const decided = await decide(params);
  if (!decided.ok) return decided.response;
  const size = await statStored(decided.file.storageKey);
  if (size === null || size !== decided.file.sizeBytes) return notFound();
  return new Response(null, { status: 200, headers: fileResponseHeaders(decided.file.kind, decided.file.name, size) });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const decided = await decide(params);
  if (!decided.ok) return decided.response;
  const { file } = decided;
  const id = file.storageKey.split("/")[2];
  const stored = await openStored(file.storageKey);
  if (!stored) return notFound();
  if (stored.size !== file.sizeBytes) {
    await stored.stream.cancel().catch(() => undefined);
    logger.error({ fileId: id }, "files: stored size differs from its row — not served");
    return notFound();
  }
  return new Response(stored.stream, { status: 200, headers: fileResponseHeaders(file.kind, file.name, stored.size) });
}
