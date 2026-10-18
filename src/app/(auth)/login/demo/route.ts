// `/login/demo?key=…` — the unlock hand-off of «ورود آزمایشی» (docs/decisions.md 2026-10-18). The owner opens
// `/login?demo=<key>` once per device; the login page forwards the value here because a page cannot set a cookie
// while it renders. EVERY outcome is the same 303 to /login — only the right key, with the feature on, adds the unlock
// cookie (src/lib/demo-login/unlock: constant-time comparison, an expiring HMAC, never the key itself) — so the
// response says nothing about whether the feature exists, and the redirect takes the key out of the address bar.
// Public by design (the proxy treats /login/* as public); no database, no session, never logs the key.
import { NextResponse, type NextRequest } from "next/server";
import { demoConfig } from "@/lib/demo-login/gate";
import { demoUnlockDecision } from "@/lib/demo-login/unlock";
import { logger } from "@/lib/logger";
import { clientIpFrom } from "@/lib/request";

export function GET(request: NextRequest): NextResponse {
  const { outcome, cookie } = demoUnlockDecision(demoConfig(), request.nextUrl.searchParams.get("key"), Date.now());
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  if (cookie) res.cookies.set(cookie.name, cookie.value, cookie.options);
  if (outcome === "bad_key") logger.warn({ ip: clientIpFrom(request.headers) }, "demo unlock: wrong key");
  else if (outcome === "unlocked") logger.info({ ip: clientIpFrom(request.headers) }, "demo unlock");
  return res;
}
