// POST /api/files?purpose=work_item|submission[&workItemId=<uuid>] — ONE file per request, its raw bytes as the body
// (no multipart: nothing to parse, nothing buffered), its name percent-encoded in `X-File-Name`. «پیوست تکلیف و تحویل
// پاسخ» (owner 2026-10-19; docs/decisions.md). The order is the security:
//   1. same origin only (Origin = PUBLIC_ORIGIN, `Sec-Fetch-Site: same-origin` when sent) — with the custom header a
//      cross-site page cannot even send the request without a CORS preflight nobody answers; the session cookie is
//      SameSite=Lax on top;
//   2. an upload slot of this process (`maxConcurrentUploads`), else 503;
//   3. gate pass 1 (defineAction — session, must-change, strict input, permission, then the item rule, the demo-session
//      refusal and the daily quota: workspace/file-access `authorizeUpload`) BEFORE a byte is read; a Content-Length
//      over 10 MiB is refused here too;
//   4. free space on the files volume (≥ 1 GiB — the database shares the disk);
//   5. the body streamed to a temp file with the 10 MiB cap, idle / total timeouts, SHA-256 (files/receive);
//   6. the kind from the BYTES (files/sniff) — anything else is refused and its temp file deleted;
//   7. gate pass 2: decided again, the `pending` row + audit, the stale uploads expired, the rename into place
//      (workspace/file-access `recordUpload`); on any failure the temp file AND the planned key are removed.
// This path is excluded from src/proxy.ts's matcher: a proxy buffers (and past `proxyClientMaxBodySize`, silently
// truncates) the request body — node_modules/next/dist/docs/…/proxyClientMaxBodySize.md. Caddy caps bodies at 12 MB.
import { NextResponse, type NextRequest } from "next/server";
import type { Result } from "@/lib/actions";
import { env } from "@/lib/env";
import { FA_MESSAGES, HTTP_STATUS } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { FILE_LIMITS, FILE_MESSAGES } from "@/modules/files/limits";
import { decodeHeaderName } from "@/modules/files/names";
import { ReceiveError, receiveToTemp, type Received } from "@/modules/files/receive";
import { sniffFile } from "@/modules/files/sniff";
import { discardTemp, freeBytes, removeStored, sweepTemp, tempDir, uploadSlots } from "@/modules/files/storage";
import { authorizeUploadGate, recordUploadGate } from "@/modules/workspace/file-gates";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const slots = uploadSlots(FILE_LIMITS.maxConcurrentUploads);

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE });
}

function fromResult(r: Extract<Result<unknown>, { ok: false }>): NextResponse {
  return fail(HTTP_STATUS[r.code], r.code, r.message);
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(env.PUBLIC_ORIGIN).origin;
  } catch {
    return false;
  }
}

const RECEIVE_REFUSAL: Record<ReceiveError["reason"], { status: number; message: string }> = {
  too_large: { status: 413, message: FILE_MESSAGES.tooLarge },
  incomplete: { status: 400, message: FILE_MESSAGES.incomplete },
  timeout: { status: 408, message: FILE_MESSAGES.timeout },
  empty: { status: 400, message: FILE_MESSAGES.empty },
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return fail(403, "FORBIDDEN", FA_MESSAGES.FORBIDDEN);
  const release = slots.tryAcquire();
  if (!release) return fail(503, "RATE_LIMITED", FILE_MESSAGES.busy);
  let received: Received | null = null;
  let plannedKey: string | null = null;
  let committed = false;
  try {
    const query = request.nextUrl.searchParams;
    // Exactly these three inputs; the strict schema refuses anything malformed. The name never reaches a path.
    const raw: Record<string, unknown> = { purpose: query.get("purpose") ?? undefined, name: decodeHeaderName(request.headers.get("x-file-name")) ?? undefined };
    const workItemId = query.get("workItemId");
    if (workItemId) raw.workItemId = workItemId;
    const lengthHeader = request.headers.get("content-length");
    const announced = lengthHeader && /^\d{1,12}$/.test(lengthHeader) ? Number(lengthHeader) : null;
    if (announced !== null && announced > FILE_LIMITS.maxFileBytes) return fail(413, "VALIDATION", FILE_MESSAGES.tooLarge);

    const ticket = await authorizeUploadGate(raw, announced);
    if (!ticket.ok) return fromResult(ticket);
    if ((await freeBytes()) < FILE_LIMITS.minFreeDiskBytes) {
      logger.error("files: upload refused — the files volume is below the free-space floor");
      return fail(507, "INTERNAL", FILE_MESSAGES.diskFull);
    }

    try {
      received = await receiveToTemp(request.body, {
        tempDir: tempDir(),
        maxBytes: FILE_LIMITS.maxFileBytes,
        expectedBytes: announced,
        idleTimeoutMs: FILE_LIMITS.idleTimeoutMs,
        totalTimeoutMs: FILE_LIMITS.totalTimeoutMs,
      });
    } catch (err) {
      if (!(err instanceof ReceiveError)) throw err;
      if (err.cause) logger.warn({ err: err.cause }, "files: upload body not received");
      const refusal = RECEIVE_REFUSAL[err.reason];
      return fail(refusal.status, "VALIDATION", refusal.message);
    }

    const verdict = await sniffFile(received.tempPath);
    if (!verdict.ok) {
      const message = verdict.reason === "empty" ? FILE_MESSAGES.empty : verdict.reason === "macro" ? FILE_MESSAGES.macro : verdict.reason === "encoding" ? FILE_MESSAGES.textEncoding : FILE_MESSAGES.badType;
      return fail(415, "VALIDATION", message);
    }

    plannedKey = ticket.data.storageKey;
    const recorded = await recordUploadGate(
      raw,
      { fileId: ticket.data.fileId, storageKey: ticket.data.storageKey },
      { tempPath: received.tempPath, sizeBytes: received.size, sha256: received.sha256, kind: verdict.kind },
    );
    if (!recorded.ok) return fromResult(recorded);
    committed = true;
    await removeStored(recorded.data.expiredKeys);
    void sweepTemp(FILE_LIMITS.tempTtlMs).catch(() => undefined);
    return NextResponse.json({ ok: true, data: recorded.data.file }, { status: 201, headers: NO_STORE });
  } catch (err) {
    logger.error({ err }, "files: upload failed");
    return fail(500, "INTERNAL", FA_MESSAGES.INTERNAL);
  } finally {
    if (!committed) {
      // Rolled back before the rename → the temp file is still there; renamed and THEN the commit failed → the key is.
      if (received) await discardTemp(received.tempPath);
      if (plannedKey) await removeStored([plannedKey]);
    }
    release();
  }
}
