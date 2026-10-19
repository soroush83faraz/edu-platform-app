// POST /api/files?purpose=work_item|submission[&workItemId=<uuid>] — ONE file per request, its raw bytes as the body
// (no multipart: nothing to parse, nothing buffered), its name percent-encoded in `X-File-Name`. «پیوست تکلیف و تحویل
// پاسخ» (owner 2026-10-19; docs/decisions.md). The order is the security:
//   1. same origin only (Origin = PUBLIC_ORIGIN, `Sec-Fetch-Site: same-origin` when sent) — with the custom header a
//      cross-site page cannot even send the request without a CORS preflight nobody answers; the session cookie is
//      SameSite=Lax on top; a process with every upload slot taken answers 503 here, before any database work;
//   2. gate pass 1 (defineAction — session, must-change, strict input, permission, then the item rule, the demo-session
//      refusal and the daily quota: workspace/file-access `authorizeUpload`) BEFORE a byte is read; a Content-Length
//      over 10 MiB is refused here too;
//   3. the person's hourly attempts (60, refused ones included) and slow aborts (3 in 10 minutes → 429), the person's
//      ONE upload slot (429), then a process slot (503) — of the 8, the last 2 only for a person with no slow abort in
//      the window (`slotCeilingFor`; security review 2026-10-19, D2);
//   4. free space on the files volume (≥ 1 GiB — the database shares the disk);
//   5. the body streamed to a temp file with the 10 MiB cap and the pace rule — 15 s idle, 100 KiB/s on average after
//      10 s, 90 s in all (files/receive); a slow abort counts against the person; SHA-256 on the way;
//   6. the kind from the BYTES (files/sniff) — anything else is refused and its temp file deleted;
//   7. gate pass 2: decided again, the `pending` row + audit, the stale uploads expired, the rename into place
//      (workspace/file-access `recordUpload`); on any failure the temp file AND the planned key are removed.
// Both slots are released in `finally`, whatever the path. This path is excluded from src/proxy.ts's matcher: a proxy
// buffers (and past `proxyClientMaxBodySize`, silently truncates) the request body —
// node_modules/next/dist/docs/…/proxyClientMaxBodySize.md — so it mints its own request id (`withMintedRequestId`).
// Caddy caps bodies at 12 MB and a request's read at 120 s.
import { NextResponse, type NextRequest } from "next/server";
import type { Result } from "@/lib/actions";
import { env } from "@/lib/env";
import { FA_MESSAGES, HTTP_STATUS } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { withMintedRequestId } from "@/lib/request-id";
import { FILE_LIMITS, FILE_MESSAGES, slotCeilingFor } from "@/modules/files/limits";
import { ReceiveError, receiveToTemp, type Received } from "@/modules/files/receive";
import { sniffFile } from "@/modules/files/sniff";
import { attemptWindow, discardTemp, freeBytes, keyedSlots, removeStored, slidingCounter, sweepTemp, tempDir, uploadSlots } from "@/modules/files/storage";
import { isSameOriginUpload, readUploadRequest } from "@/modules/files/upload-request";
import { authorizeUploadGate, recordUploadGate } from "@/modules/workspace/file-gates";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const slots = uploadSlots(FILE_LIMITS.maxConcurrentUploads);
/** One upload in flight per person: one account cannot hold several slots of the process with slow bodies. */
const personSlots = keyedSlots(FILE_LIMITS.maxConcurrentUploadsPerPerson);
/** Sixty attempts an hour per person, refused ones included. */
const attempts = attemptWindow(FILE_LIMITS.maxAttemptsPerHour, 60 * 60 * 1000);
/** Slow aborts per person (idle, under the rate, past the wall clock) — the fairness of the process slots. */
const slowAborts = slidingCounter(FILE_LIMITS.slowStrikeWindowMs);

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE });
}

function fromResult(r: Extract<Result<unknown>, { ok: false }>): NextResponse {
  return fail(HTTP_STATUS[r.code], r.code, r.message);
}

function receiveRefusal(err: ReceiveError): { status: number; message: string } {
  switch (err.reason) {
    case "too_large":
      return { status: 413, message: FILE_MESSAGES.tooLarge };
    case "incomplete":
      return { status: 400, message: FILE_MESSAGES.incomplete };
    case "empty":
      return { status: 400, message: FILE_MESSAGES.empty };
    case "timeout":
      return { status: 408, message: err.pace === "total" ? FILE_MESSAGES.timeout : FILE_MESSAGES.tooSlow };
  }
}

/**
 * The request id of this upload's audit rows and logs is made HERE (src/lib/request-id.ts): src/proxy.ts does not run
 * for this path, so an `x-request-id` header would be the client's (security review 2026-10-19, D4).
 */
export function POST(request: NextRequest): Promise<NextResponse> {
  return withMintedRequestId(() => upload(request));
}

async function upload(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginUpload(request.headers, env.PUBLIC_ORIGIN)) return fail(403, "FORBIDDEN", FA_MESSAGES.FORBIDDEN);
  if (slots.inFlight() >= FILE_LIMITS.maxConcurrentUploads) return fail(503, "RATE_LIMITED", FILE_MESSAGES.busy);
  let release: (() => void) | null = null;
  let releasePerson: (() => void) | null = null;
  let received: Received | null = null;
  let plannedKey: string | null = null;
  let committed = false;
  try {
    // Exactly three inputs (purpose, workItemId, the name) — the strict schema refuses anything malformed; the name never
    // reaches a path.
    const { meta: raw, announcedBytes: announced } = readUploadRequest(request.nextUrl.searchParams, request.headers);
    if (announced !== null && announced > FILE_LIMITS.maxFileBytes) return fail(413, "VALIDATION", FILE_MESSAGES.tooLarge);

    const ticket = await authorizeUploadGate(raw, announced);
    if (!ticket.ok) return fromResult(ticket);
    const personId = ticket.data.personId;
    if (!attempts.allow(personId)) return fail(429, "RATE_LIMITED", FA_MESSAGES.RATE_LIMITED);
    const ceiling = slotCeilingFor(slowAborts.count(personId));
    if (ceiling === null) return fail(429, "RATE_LIMITED", FILE_MESSAGES.slowStrikes);
    releasePerson = personSlots.tryAcquire(personId);
    if (!releasePerson) return fail(429, "RATE_LIMITED", FILE_MESSAGES.busy);
    release = slots.tryAcquire(ceiling);
    if (!release) return fail(503, "RATE_LIMITED", FILE_MESSAGES.busy);
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
        minBytesPerSecond: FILE_LIMITS.minBytesPerSecond,
        slowGraceMs: FILE_LIMITS.slowGraceMs,
      });
    } catch (err) {
      if (!(err instanceof ReceiveError)) throw err;
      if (err.cause) logger.warn({ err: err.cause }, "files: upload body not received");
      if (err.reason === "timeout") {
        slowAborts.add(personId);
        logger.warn({ pace: err.pace }, "files: upload aborted — too slow");
      }
      const refusal = receiveRefusal(err);
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
    releasePerson?.();
    release?.();
  }
}
