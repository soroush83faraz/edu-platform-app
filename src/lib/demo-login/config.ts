// «ورود آزمایشی» (the demo quick-login, docs/decisions.md 2026-10-18) — its configuration, as a PURE function of an
// environment object. The server reads it from `process.env` on every call (`demoConfig()` in ./gate — it never
// changes at runtime, and the tests flip it), src/lib/env.ts validates the same variables once at boot and refuses
// to start on a malformed value (fail loud). This parser fails CLOSED: anything missing or malformed is «off».
//
//   DEMO_LOGIN=1          the switch; any other value or none = off
//   DEMO_LOGIN_KEY=…      24–128 URL-safe characters; the owner opens /login?demo=<key> once per device
//   DEMO_LOGIN_ORGS=a,b   organization slugs whose accounts — and ONLY whose accounts — the panel may sign in as
//   DEMO_LOGIN_OPEN=1     open mode (owner 2026-10-18, the pilot's fake data only): the panel for EVERY visitor of
//                         /login, no unlock cookie needed, and then the key is optional. Exactly "1"; any other value
//                         or none = keyed (the default). It opens nothing while DEMO_LOGIN is off.
//
// No imports: unit tests and src/lib/env.ts use it without the server environment.

/** = `organization_slug_chk` (src/db/schema/tenancy.ts). */
export const DEMO_ORG_SLUG_RE = /^[a-z0-9-]{3,40}$/;
/** URL-safe so `/login?demo=<key>` needs no escaping; ≥ 24 characters of a 64-letter alphabet ≥ 144 bits when random. */
export const DEMO_KEY_RE = /^[A-Za-z0-9_-]{24,128}$/;
/** The HMAC key of the unlock cookie is derived from SESSION_SECRET; env.ts requires the same minimum. */
export const DEMO_SECRET_MIN_LENGTH = 32;

export interface DemoEnv {
  DEMO_LOGIN?: string;
  DEMO_LOGIN_OPEN?: string;
  DEMO_LOGIN_KEY?: string;
  DEMO_LOGIN_ORGS?: string;
  SESSION_SECRET?: string;
}

export interface DemoConfig {
  /**
   * True only when the switch is on AND the organization list and the secret are well-formed AND there is a
   * well-formed key — or, in open mode only, no key at all (a malformed key is a mistake, never «no key»).
   */
  enabled: boolean;
  /**
   * DEMO_LOGIN_OPEN=1: the gate (./gate) admits every visitor without an unlock cookie. Nothing else changes — the
   * allow-list, the eligibility rule, the strict input, the rate limits (per IP tighter: DEMO_RATE), the public-device
   * session and the audit row (with `open: true`) all stay.
   */
  open: boolean;
  /** "" only in open mode without a key: then no `?demo=` value matches and no unlock cookie verifies (./unlock). */
  key: string;
  /** Distinct, well-formed slugs, in the order written (the panel lists the schools in this order). */
  orgSlugs: readonly string[];
  secret: string;
}

export const DEMO_OFF: DemoConfig = Object.freeze({ enabled: false, open: false, key: "", orgSlugs: Object.freeze([]) as readonly string[], secret: "" });

/** Comma-separated slugs → distinct list; `[]` for none; `null` when any entry is malformed (the whole list is refused). */
export function parseDemoOrgSlugs(raw: string | undefined): string[] | null {
  if (raw === undefined) return [];
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!slugs.every((s) => DEMO_ORG_SLUG_RE.test(s))) return null;
  return [...new Set(slugs)];
}

export function demoConfigFrom(e: DemoEnv): DemoConfig {
  if (e.DEMO_LOGIN !== "1") return DEMO_OFF;
  // Exactly "1" — no trimming, no "true": the value that widens the gate must be unmistakable.
  const open = e.DEMO_LOGIN_OPEN === "1";
  const key = e.DEMO_LOGIN_KEY ?? "";
  const secret = e.SESSION_SECRET ?? "";
  const orgSlugs = parseDemoOrgSlugs(e.DEMO_LOGIN_ORGS);
  const keyOk = DEMO_KEY_RE.test(key) || (open && key === "");
  if (!keyOk || secret.length < DEMO_SECRET_MIN_LENGTH || orgSlugs === null || orgSlugs.length === 0) return DEMO_OFF;
  return { enabled: true, open, key, orgSlugs, secret };
}
