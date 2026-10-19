// The request id of the logs and of the audit trail (`audit.audit_log.request_id`). src/proxy.ts mints one per request
// into `x-request-id` (overwriting whatever the client sent) and getRequestId (src/lib/ctx.ts) reads it back. A route
// the proxy does NOT run for — POST /api/files, excluded from its matcher so the upload body is never buffered — would
// otherwise read a header the CLIENT chose, and the client would pick the audit row's request id (security review
// 2026-10-19, D4). Such a route runs inside `withMintedRequestId`: every getRequestId() within returns the id minted
// here and the header is never read. Every other route passes through the proxy (tests/unit/request-id.test.ts runs
// Next's own matcher over the routes). No Next imports.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const minted = new AsyncLocalStorage<string>();

/** What src/proxy.ts sets (`crypto.randomUUID()`): a UUID, nothing else. */
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs `fn` with a request id made HERE — nothing inside reads `x-request-id`. */
export function withMintedRequestId<T>(fn: () => Promise<T>): Promise<T> {
  return minted.run(randomUUID(), fn);
}

/** The id minted for the current request by `withMintedRequestId`, if it runs inside one. */
export function mintedRequestId(): string | undefined {
  return minted.getStore();
}

/** The request id: the minted one inside `withMintedRequestId`; else the proxy's header when it is a UUID; else fresh. */
export function resolveRequestId(header: string | null): string {
  const own = minted.getStore();
  if (own) return own;
  return header && REQUEST_ID_RE.test(header) ? header : randomUUID();
}
