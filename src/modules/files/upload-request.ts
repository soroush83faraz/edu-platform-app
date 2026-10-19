// files/upload-request — what POST /api/files reads from its request, before anything else (src/app/api/files/route.ts).
// Pure (unit-tested: tests/unit/files-upload-request.test.ts).
//
//   • `isSameOriginUpload`: the request must come from the app's own pages — `Origin` equal to PUBLIC_ORIGIN's origin
//     (required; browsers send it on every POST) and, when the browser sends it, `Sec-Fetch-Site: same-origin`. With
//     the custom `X-File-Name` header a cross-site page cannot even send it without a CORS preflight nobody answers,
//     and the session cookie is SameSite=Lax — this is the third lock on the same door (CSRF).
//   • `readUploadRequest`: exactly three inputs — `purpose` and `workItemId` from the query, the name from the
//     percent-encoded `X-File-Name` header — and the announced Content-Length (digits only). The strict schema of the
//     gate (workspace/file-access `UploadMeta`) decides whether they are well-formed.
import { decodeHeaderName } from "./names";

export interface HeaderReader {
  get(name: string): string | null;
}

export function isSameOriginUpload(headers: HeaderReader, publicOrigin: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(publicOrigin).origin;
  } catch {
    return false;
  }
}

export interface UploadRequest {
  /** The gate's raw input — parsed `.strict()` by defineAction. */
  meta: Record<string, unknown>;
  /** Content-Length when the client sent a plain one; null for a chunked body. */
  announcedBytes: number | null;
}

export function readUploadRequest(query: URLSearchParams, headers: HeaderReader): UploadRequest {
  const meta: Record<string, unknown> = {};
  const purpose = query.get("purpose");
  if (purpose !== null) meta.purpose = purpose;
  const workItemId = query.get("workItemId");
  if (workItemId) meta.workItemId = workItemId;
  const name = decodeHeaderName(headers.get("x-file-name"));
  if (name !== null) meta.name = name;
  const length = headers.get("content-length");
  return { meta, announcedBytes: length !== null && /^\d{1,12}$/.test(length) ? Number(length) : null };
}
