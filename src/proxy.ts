// Request hook (Next 16: `proxy`, not middleware). Deliberately dumb — it is NOT a security boundary:
//   1. mint `x-request-id` into the request (read by getRequestId) and the response,
//   2. convenience redirect to /login when a protected path is requested without ANY session cookie
//      (a present-but-dead cookie is caught by the (app)/(admin) layouts / defineAction, which check the database),
//      carrying the requested path as `?next=` so the login lands back on the deep link (`safeNextPath` accepts
//      only a same-origin relative path; loginAction re-validates it). The same deep link travels to the layouts
//      as the `x-next-path` request header (always overwritten here — a client cannot smuggle one in), so their
//      dead-cookie redirect keeps it too (`loginRedirectHref`),
//   3. `Cache-Control: private, no-store` on protected pages, `Clear-Site-Data` on /login?out=1 (after logout).
//      Production (`next start`) keeps that header on HTML/RSC/API responses — Next sets its own default only when
//      none is present (send-payload.js / send-response.js); Server Action POSTs get Next's unconditional
//      `no-cache, no-store, max-age=0, must-revalidate`. `next dev` alone overwrites page responses with
//      `no-cache, must-revalidate` (base-server.js, for back/forward restoration) — docs/decisions.md.
import { NextResponse, type NextRequest } from "next/server";
import { NEXT_PATH_HEADER } from "@/lib/next-path-header";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { safeNextPath } from "@/modules/iam/next-path";

const PUBLIC_PATHS = ["/login", "/help", "/privacy", "/~offline"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The requested page as a `next` value: path + query without Next's RSC marker; null when it is the default landing anyway. */
function deepLinkOf(request: NextRequest): string | null {
  if (request.method !== "GET") return null;
  const url = request.nextUrl.clone();
  url.searchParams.delete("_rsc");
  const candidate = `${url.pathname}${url.search}`;
  if (candidate === "/" || candidate === "/home") return null;
  return safeNextPath(candidate);
}

export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const { pathname, searchParams } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  if (!isPublic && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const next = deepLinkOf(request);
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (next) url.searchParams.set("next", next);
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const deepLink = isPublic ? null : deepLinkOf(request);
  if (deepLink) requestHeaders.set(NEXT_PATH_HEADER, deepLink);
  else requestHeaders.delete(NEXT_PATH_HEADER);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);
  if (!isPublic) res.headers.set("Cache-Control", "private, no-store");
  if (pathname === "/login" && searchParams.get("out") === "1") res.headers.set("Clear-Site-Data", '"cache", "storage"');
  return res;
}

export const config = {
  // Everything except Next internals, the anonymous health probe, the upload endpoint, PWA files and any static asset
  // with an extension. `api/files` (POST, one file as the raw body — src/app/api/files/route.ts) must not pass through
  // here: a proxy clones the request body into memory and, past `proxyClientMaxBodySize` (10 MB), hands the route a
  // silently TRUNCATED body (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/
  // proxyClientMaxBodySize.md). The route does its own session gate (defineAction), sets its own Cache-Control and
  // mints its own request id (src/lib/request-id.ts — without this proxy `x-request-id` would be the client's). The
  // exclusion is EXACTLY `/api/files` (`$`): `/api/filesx` or `/api/files/x` still pass here (security review
  // 2026-10-19, D4; tests/unit/request-id.test.ts runs Next's own matcher).
  matcher: ["/((?!_next|api/health|api/files$|manifest|icons|icon|apple-icon|sw\\.js|.*\\.[a-zA-Z0-9]+$).*)"],
};
