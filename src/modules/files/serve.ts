// files/serve — the response headers of a served upload (GET /files/[id], src/app/files/[id]/route.ts). Pure
// (unit-tested: tests/unit/files-names.test.ts). Every upload is untrusted content, so:
//   • Content-Type: the SNIFFED kind's own type (./kinds) — never the client's;
//   • X-Content-Type-Options: nosniff — the browser may not second-guess it;
//   • Content-Security-Policy: default-src 'none' (no script, no subresource) + sandbox (an opaque origin, no forms, no
//     top navigation) + frame-ancestors 'none' — the image document still shows the image (it is the document itself);
//   • Content-Disposition: inline for images only, attachment for everything else — PDFs included: the browsers' PDF
//     viewers refuse to run under a CSP sandbox, and outside one a PDF can carry script into the viewer;
//   • Cache-Control: private, no-store; Cross-Origin-Resource-Policy: same-origin (no other site may embed it);
//     Referrer-Policy: no-referrer; X-Frame-Options: DENY.
import { KIND_INFO, type FileKind } from "./kinds";
import { contentDisposition } from "./names";

export const FILE_RESPONSE_SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
} as const;

export function fileResponseHeaders(kind: FileKind, name: string, sizeBytes: number): Record<string, string> {
  const info = KIND_INFO[kind];
  return {
    ...FILE_RESPONSE_SECURITY_HEADERS,
    "Content-Type": info.mime,
    "Content-Length": String(sizeBytes),
    "Content-Disposition": contentDisposition(info.inline ? "inline" : "attachment", name),
  };
}
