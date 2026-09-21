import { z } from "zod";

/**
 * Typed, validated process environment. Parsed once at import time.
 * Server-only: never import from client components (it would leak nothing, but it would fail to build).
 */
const EnvSchema = z.object({
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
  /** Shown in the manifest, the title and /roadmap; defaults to «سامانهٴ مدرسه» (src/lib/product.ts). */
  PRODUCT_NAME: z.string().trim().min(1).max(60).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  FILES_DIR: z.string().min(1).default("/data/files"),
  /** Set to "1" to allow running seed against a production database. */
  SEED_ALLOW: z.string().optional(),
  /** Set to "1" to also seed the demo organizations. */
  SEED_DEMO: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  APP_VERSION: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid environment variables:\n${lines.join("\n")}\nSee .env.example for the full list.`);
}

export const env: Env = parseEnv();
