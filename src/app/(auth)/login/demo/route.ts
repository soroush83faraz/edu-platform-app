// `/login/demo?key=…` — the unlock hand-off of «ورود آزمایشی» (docs/decisions.md 2026-10-18). The owner opens
// `/login?demo=<key>` once per device; the login page forwards the value here because a page cannot set a cookie
// while it renders. EVERY outcome is the same 303 to /login — only the right key, with the feature on, adds the unlock
// cookie (src/lib/demo-login/unlock: constant-time comparison, an expiring HMAC, never the key itself) — so the
// response says nothing about whether the feature exists, and the redirect takes the key out of the address bar.
// In open mode (DEMO_LOGIN_OPEN=1) it works the same when a key is configured — the cookie then outlives open mode —
// and without a key it sets nothing. Public by design (the proxy treats /login/* as public); no database, no
// session, never logs the key.
import { NextResponse, type NextRequest } from "next/server";
import { demoConfig } from "@/lib/demo-login/gate";
import { demoUnlockDecision } from "@/lib/demo-login/unlock";
import { logger } from "@/lib/logger";
import { clientIpFrom } from "@/lib/request";

export function GET(request: NextRequest): NextResponse {
  const { outcome, cookie } = demoUnlockDecision(demoConfig(), request.nextUrl.searchParams.get("key"), Date.now());
  // A RELATIVE Location: the standalone server sees itself as http://0.0.0.0:3000 (HOSTNAME/PORT), so an absolute
  // URL built from request.nextUrl sent the browser to 0.0.0.0:3000 behind Caddy or the :9444 proxy (2026-10-18).
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  if (cookie) res.cookies.set(cookie.name, cookie.value, cookie.options);
  if (outcome === "bad_key") logger.warn({ ip: clientIpFrom(request.headers) }, "demo unlock: wrong key");
  else if (outcome === "unlocked") logger.info({ ip: clientIpFrom(request.headers) }, "demo unlock");
  return res;
}
