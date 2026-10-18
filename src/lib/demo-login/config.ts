// «ورود آزمایشی» (the demo quick-login, docs/decisions.md 2026-10-18) — its configuration, as a PURE function of an
// environment object. The server reads it from `process.env` on every call (`demoConfig()` in ./gate — it never
// changes at runtime, and the tests flip it), src/lib/env.ts validates the same variables once at boot and refuses
// to start on a malformed value (fail loud). This parser fails CLOSED: anything missing or malformed is «off».
//
//   DEMO_LOGIN=1          the switch; any other value or none = off
//   DEMO_LOGIN_KEY=…      24–128 URL-safe characters; the owner opens /login?demo=<key> once per device
//   DEMO_LOGIN_ORGS=a,b   organization slugs whose accounts — and ONLY whose accounts — the panel may sign in as
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
  DEMO_LOGIN_KEY?: string;
  DEMO_LOGIN_ORGS?: string;
  SESSION_SECRET?: string;
}

export interface DemoConfig {
  /** True only when the switch is on AND the key, the organization list and the secret are all well-formed. */
  enabled: boolean;
  key: string;
  /** Distinct, well-formed slugs, in the order written (the panel lists the schools in this order). */
  orgSlugs: readonly string[];
  secret: string;
}

export const DEMO_OFF: DemoConfig = Object.freeze({ enabled: false, key: "", orgSlugs: Object.freeze([]) as readonly string[], secret: "" });

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
  const key = e.DEMO_LOGIN_KEY ?? "";
  const secret = e.SESSION_SECRET ?? "";
  const orgSlugs = parseDemoOrgSlugs(e.DEMO_LOGIN_ORGS);
  if (!DEMO_KEY_RE.test(key) || secret.length < DEMO_SECRET_MIN_LENGTH || orgSlugs === null || orgSlugs.length === 0) return DEMO_OFF;
  return { enabled: true, key, orgSlugs, secret };
}
