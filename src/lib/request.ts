// Request facts read from Next's async `headers()`. Caddy (deploy/Caddyfile) terminates TLS and sets
// X-Forwarded-For; the first value is the client. Anything unparseable becomes 0.0.0.0 so throttling still works.
import { headers } from "next/headers";
import { isIP } from "node:net";

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const candidate = (forwarded ? forwarded.split(",")[0] : h.get("x-real-ip")) ?? "";
  const ip = candidate.trim();
  return isIP(ip) ? ip : "0.0.0.0";
}

export async function getUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}
