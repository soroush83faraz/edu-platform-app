// Request hook (Next 16: `proxy`, not middleware). Deliberately dumb — it is NOT a security boundary:
//   1. mint `x-request-id` into the request (read by getRequestId) and the response,
//   2. convenience redirect to /login when a protected path is requested without ANY session cookie
//      (a present-but-dead cookie is caught by the (app) layout / defineAction, which check the database),
//   3. `Cache-Control: private, no-store` on protected pages, `Clear-Site-Data` on /login?out=1 (after logout).
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const PUBLIC_PATHS = ["/login", "/help", "/privacy"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const { pathname, searchParams } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  if (!isPublic && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);
  if (!isPublic) res.headers.set("Cache-Control", "private, no-store");
  if (pathname === "/login" && searchParams.get("out") === "1") res.headers.set("Clear-Site-Data", '"cache", "storage"');
  return res;
}

export const config = {
  // Everything except Next internals, the anonymous health probe, PWA files and any static asset with an extension.
  matcher: ["/((?!_next|api/health|manifest|icons|sw\\.js|.*\\.[a-zA-Z0-9]+$).*)"],
};
