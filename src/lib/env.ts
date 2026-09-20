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
  /** ≥ 32 chars; used to derive session/CSRF secrets. */
  SESSION_SECRET: z.string().min(32),
  /** Public origin, e.g. https://school.example.ir (no trailing slash). */
  PUBLIC_ORIGIN: z.url(),
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
