// «ورود آزمایشی» — the unlock cookie, pure (node:crypto only; no Next, no env.ts — unit-tested directly).
//
// The owner opens `/login?demo=<DEMO_LOGIN_KEY>` once on a device. `/login/demo` (src/app/(auth)/login/demo/route.ts)
// compares the key in constant time and, when it matches, sets this cookie; every later demo request (the panel's
// list, the demo login) re-verifies it on the server. The cookie never holds the key itself:
//
//   value = "v1." + exp + "." + base64url( HMAC-SHA256( K, "unlock." + exp ) )
//   K     = HMAC-SHA256( SESSION_SECRET, "donino/demo-login/v1\0" + DEMO_LOGIN_KEY )
//
// `exp` (unix seconds, 30 days ahead) is checked on the server too, so a copied cookie dies on its own; rotating
// DEMO_LOGIN_KEY or SESSION_SECRET invalidates every cookie at once. Name/flags follow the session cookie
// (src/lib/session-cookie.ts): `__Host-demo` + Secure in production, plain `demo` on http://localhost.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DemoConfig } from "./config";

const isProduction = process.env.NODE_ENV === "production";

export const DEMO_COOKIE_NAME = isProduction ? "__Host-demo" : "demo";
export const DEMO_COOKIE_SECURE = isProduction;
/** 30 days. */
export const DEMO_UNLOCK_TTL_S = 30 * 24 * 60 * 60;
/** A longer `?demo=` value is never a key (DEMO_KEY_RE caps it at 128). */
export const DEMO_KEY_PARAM_MAX = 256;

const VALUE_RE = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

function macKey(cfg: DemoConfig): Buffer {
  return createHmac("sha256", cfg.secret).update(`donino/demo-login/v1\0${cfg.key}`).digest();
}

function signature(cfg: DemoConfig, exp: number): string {
  return createHmac("sha256", macKey(cfg)).update(`unlock.${exp}`).digest("base64url");
}

/** Equal-length buffers only — `timingSafeEqual` throws otherwise. */
function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The `?demo=` value against DEMO_LOGIN_KEY, in constant time: both sides are first MACed to 32 bytes with the
 * session secret, so neither the length nor the first differing character of the real key shows in the timing.
 */
export function demoKeyMatches(cfg: DemoConfig, provided: unknown): boolean {
  if (!cfg.enabled || typeof provided !== "string" || provided.length === 0 || provided.length > DEMO_KEY_PARAM_MAX) return false;
  const mac = (s: string) => createHmac("sha256", cfg.secret).update(`donino/demo-key\0${s}`).digest();
  return sameBytes(mac(provided), mac(cfg.key));
}

export function mintDemoUnlock(cfg: DemoConfig, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + DEMO_UNLOCK_TTL_S;
  return `v1.${exp}.${signature(cfg, exp)}`;
}

/** True for a well-formed, unexpired cookie signed for the CURRENT key and secret. Never throws. */
export function verifyDemoUnlock(cfg: DemoConfig, value: string | undefined | null, nowMs: number): boolean {
  if (!cfg.enabled || !value) return false;
  const m = VALUE_RE.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Math.floor(nowMs / 1000);
  // Expired, or further ahead than we ever mint (a minute of clock slack).
  if (exp <= now || exp > now + DEMO_UNLOCK_TTL_S + 60) return false;
  return sameBytes(Buffer.from(m[2], "ascii"), Buffer.from(signature(cfg, exp), "ascii"));
}

export interface DemoCookie {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };
}

export type DemoUnlockOutcome = "off" | "bad_key" | "unlocked";

/**
 * What `/login/demo?key=…` does — the route only applies it. Every outcome redirects to `/login` the same way; only
 * `unlocked` carries the cookie, so the response tells a visitor nothing about whether the feature is on.
 */
export function demoUnlockDecision(cfg: DemoConfig, provided: unknown, nowMs: number): { outcome: DemoUnlockOutcome; cookie: DemoCookie | null } {
  if (!cfg.enabled) return { outcome: "off", cookie: null };
  if (!demoKeyMatches(cfg, provided)) return { outcome: "bad_key", cookie: null };
  return {
    outcome: "unlocked",
    cookie: {
      name: DEMO_COOKIE_NAME,
      value: mintDemoUnlock(cfg, nowMs),
      options: { httpOnly: true, secure: DEMO_COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: DEMO_UNLOCK_TTL_S },
    },
  };
}
