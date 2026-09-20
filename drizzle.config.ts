import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. Used ONLY for `generate` / `check` / `studio`.
 * `push` is forbidden (CLAUDE.md): migrations are committed SQL in /drizzle applied by scripts/migrate.
 * Credentials (studio only) use the schema-owner role; drizzle-kit loads `.env` itself.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  schemaFilter: ["tenancy", "iam", "academic", "workspace", "notif", "files", "audit", "config", "integ", "app"],
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
