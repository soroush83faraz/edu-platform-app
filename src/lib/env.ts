import { z } from "zod";
import { DEMO_KEY_RE, parseDemoOrgSlugs } from "@/lib/demo-login/config";

/**
 * Typed, validated process environment. Parsed once at import time.
 * Server-only: never import from client components (it would leak nothing, but it would fail to build).
 */
const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Connection string for the app role (app_rw, NOSUPERUSER NOBYPASSRLS). */
  DATABASE_URL: z.url(),
  /** Connection string for the schema owner (app_owner). Used ONLY by migrate/seed scripts. */
  MIGRATION_DATABASE_URL: z.url(),
  /**
   * Max pooled connections of the ONE app process (`pg` Pool `max`, src/db/client.ts). Every request holds a client for
   * the length of its transaction; more than ~2× the vCPUs of the database only queues inside Postgres instead of in
   * the pool. Size Postgres `max_connections` for it plus migrate/seed/backup/psql headroom (docs/ops/capacity.md).
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  /** ≥ 32 chars; used to derive session/CSRF secrets. */
  SESSION_SECRET: z.string().min(32),
  /**
   * 32 bytes as 64 hex chars — AES-256-GCM key for `iam.auth_identity.initial_password_enc` (src/lib/crypto.ts), so
   * the credentials sheet of a class can be printed after the accounts were created. Rotating it makes older
   * initial passwords unreadable (they show as «— تغییر داده شده»); it never affects login (argon2 hashes).
   */
  INITIAL_PASSWORD_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes as 64 hex characters"),
  /** Public origin, e.g. https://school.example.ir (no trailing slash). */
  PUBLIC_ORIGIN: z.url(),
  /** Shown in the manifest, the title and /roadmap; defaults to «دانینو» (src/lib/product.ts). */
  PRODUCT_NAME: z.string().trim().min(1).max(60).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  FILES_DIR: z.string().min(1).default("/data/files"),
  /** Set to "1" to allow running seed against a production database. */
  SEED_ALLOW: z.string().optional(),
  /** Set to "1" to also seed the demo organizations. */
  SEED_DEMO: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  APP_VERSION: z.string().optional(),
  /**
   * «ورود آزمایشی» — the demo quick-login on /login (docs/decisions.md 2026-10-18; src/lib/demo-login). "1" = on;
   * absent or "0" = off (the default; the go-live checklist turns it off before real schools). Anything else refuses
   * to boot rather than guess.
   */
  DEMO_LOGIN: z.enum(["0", "1"]).optional(),
  /**
   * «ورود آزمایشی» open mode — the pilot only (owner 2026-10-18; fake data only): exactly "1", with DEMO_LOGIN=1, shows
   * the panel on /login to EVERY visitor without the unlock key, and DEMO_LOGIN_KEY becomes optional. Any other value,
   * or none, = keyed (the default) — src/lib/demo-login/config compares with "1" and nothing else. Every other gate
   * stays (DEMO_LOGIN_ORGS, eligibility, rate limits, 8-hour public-device sessions, audit). Off before real schools.
   */
  DEMO_LOGIN_OPEN: z.string().optional(),
  /**
   * 24–128 URL-safe characters (`[A-Za-z0-9_-]`): the owner opens `/login?demo=<key>` once per device to see the panel.
   * Optional only with DEMO_LOGIN_OPEN=1; when set it must still be well-formed (and the unlock keeps working).
   *   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   */
  DEMO_LOGIN_KEY: z.string().regex(DEMO_KEY_RE, "must be 24–128 characters of A–Z a–z 0–9 _ -").optional(),
  /** Comma-separated organization slugs the demo login may sign in to, e.g. `allameh,farzanegan,helli,pishgaman`. */
  DEMO_LOGIN_ORGS: z.string().optional(),
});

/**
 * The demo switch never turns on half-configured: with DEMO_LOGIN=1 at least one valid slug is required, and the key
 * too unless the pilot's open mode is on (DEMO_LOGIN_OPEN=1 — exactly the value src/lib/demo-login/config opens on).
 */
const EnvSchema = BaseEnvSchema.superRefine((e, ctx) => {
  const slugs = parseDemoOrgSlugs(e.DEMO_LOGIN_ORGS);
  if (slugs === null) {
    ctx.addIssue({ code: "custom", path: ["DEMO_LOGIN_ORGS"], message: "every entry must be an organization slug (a-z, 0-9, -; 3–40 characters)" });
  }
  if (e.DEMO_LOGIN !== "1") return;
  if (!e.DEMO_LOGIN_KEY && e.DEMO_LOGIN_OPEN !== "1") {
    ctx.addIssue({ code: "custom", path: ["DEMO_LOGIN_KEY"], message: "required when DEMO_LOGIN=1 (unless DEMO_LOGIN_OPEN=1)" });
  }
  if (slugs !== null && slugs.length === 0) ctx.addIssue({ code: "custom", path: ["DEMO_LOGIN_ORGS"], message: "required when DEMO_LOGIN=1" });
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid environment variables:\n${lines.join("\n")}\nSee .env.example for the full list.`);
}

export const env: Env = parseEnv();
