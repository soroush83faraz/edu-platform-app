# Decisions log

## 2026-09-20 — Scaffold versions (exact, `save-exact=true`)

| Package | Version | Why |
|---|---|---|
| next | 16.3.5 | `latest` dist-tag on 2026-09-20. Request hook is `src/proxy.ts` (`middleware.ts` deprecated); `cookies()/headers()/params` are async. |
| react, react-dom | 19.2.8 | The version `create-next-app@16.3.5` pins (tested pairing). npm `latest` was 19.3.0 — not taken; Next's peer range is `^19.0.0`, but we follow the CNA pin. |
| typescript | 5.9.3 | npm `latest` is 7.0.2 (native port). Kept the 5.x line CNA scaffolds (`^5`) for typescript-eslint/Next tooling compatibility. |
| @types/node | 22.20.4 | Matches the Node 22 runtime (CNA scaffolds `^20`). |
| @types/react, @types/react-dom | 19.2.18 / 19.2.7 | Match the React 19.2 minor. |
| eslint / eslint-config-next | 9.39.5 / 16.3.5 | ESLint 10 is out, but eslint-config-next 16.3.5 scaffolds `^9`. |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | latest. |
| shadcn (CLI + runtime) | 4.21.0 | latest. Preset `nova` on the **radix** base (`radix-nova`), CSS variables, **`rtl: true`** so generated components use logical utilities. Chose Radix over the new Base UI default because AI-generated code and docs overwhelmingly target Radix APIs (less drift). shadcn 4 pulls `radix-ui` 1.6.7, `cn` 0.3.0, `class-variance-authority` 0.7.1, `lucide-react` 1.47.0, `tw-animate-css` 1.4.0, `sonner` 2.0.8, `next-themes` 0.4.6 (sonner only). |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | latest. |
| zod | 4.6.5 | latest (v4 API). |
| pg / @types/pg | 8.23.0 / 8.23.1 | latest. |
| @node-rs/argon2 | 2.2.1 | latest; prebuilt napi binaries via optional deps (no postinstall download). |
| exceljs | 4.4.0 | latest. |
| @serwist/next, serwist | 9.5.12 | latest (wired in the PWA block). |
| date-fns-jalali | 4.4.0-0 | The project's `latest` tag; every release carries the `-0` suffix by convention. |
| pino / pino-pretty | 10.3.1 / 13.1.3 | latest. |
| uuid | 14.0.2 | latest (v7 support). |
| @tanstack/react-table | 9.2.4 | latest. |
| vazirmatn | 33.0.3 | latest. The package has no **variable** Farsi-digits build (`Vazirmatn-FD[wght].woff2` does not exist; FD is static weights only), so the layout uses `fonts/webfonts/Vazirmatn[wght].woff2` and Persian digits come from `Intl("fa-IR")`. |
| vitest / tsx | 5.0.1 / 4.23.15 | latest. Config is `vitest.config.mts` (ESM) to silence the Vite CJS-loader warning. |

Other scaffold decisions:
- Import alias `@/*` kept (shadcn requires an alias; `--no-import-alias` no longer exists in CNA 16).
- `output: "standalone"`, `poweredByHeader: false`, `images.remotePatterns: []` in `next.config.ts`.
- pnpm 10 build scripts: only `esbuild` approved (`pnpm-workspace.yaml`); `sharp`/`unrs-resolver` ignored (they ship prebuilt optional binaries).
- `RootLayout` props typed explicitly (`{ children: React.ReactNode }`) instead of the generated global `LayoutProps` so `tsc --noEmit` works on a clean checkout without a prior build.
- ESLint: `no-restricted-imports` blocks `@/db/client` outside `src/lib/actions/**`, `src/db/**`, `scripts/**`, `tests/int/**`, and blocks `next/font/google` everywhere; `react/no-danger` is an error.
- Radix `Direction.Provider dir="rtl"` and the sonner `Toaster` live in `src/components/providers.tsx` (client) mounted from the root layout.

## 2026-09-20 — DB step 1 (tenancy + iam, roles, RLS, tenant wrapper)

- **Dev DB on host port 5433** (`docker-compose.dev.yml`, volume `pgdata_dev`) to avoid clashing with a local PostgreSQL. Roles/databases are created by `deploy/db/initdb/01-roles.sh` (bash + psql variables instead of the planned `.sql`, so the passwords come from the compose environment without templating).
- **app_owner has no BYPASSRLS** (as specified) and every tenant table is `FORCE ROW LEVEL SECURITY`, so seeds/fixtures written by app_owner must `set_config('app.current_org_id', …, true)` first. System role templates (`iam.role.organization_id IS NULL`) therefore need a second, app_owner-only policy `system_templates`; app_rw can read templates but never write rows with a NULL organization (`tenant_isolation` WITH CHECK). Chosen over granting BYPASSRLS to keep the owner subject to the same rules as everyone else.
- RLS + grants live in idempotent SQL functions `app.apply_rls()` / `app.apply_grants()` (migration `0002_rls_and_grants`); later migrations just call them. `apply_rls` picks the nullable-organization_id policy variant from `information_schema.columns.is_nullable`, so no table is special-cased by name.
- `iam.permission` and `iam.role_permission` are **SELECT-only for app_rw** (seed-managed catalogs; custom roles are out of Phase 1). `drizzle.__drizzle_migrations` is readable by app_rw for `/api/health`.
- Drizzle 0.45 expressed every construct in the spec (generated columns, partial unique indexes, GIN + `gin_trgm_ops`, `num_nonnulls` CHECK, `UNIQUE NULLS NOT DISTINCT`), so `0001_tenancy_iam_tables` is fully generated; only helpers and RLS are custom SQL. Constraint/index names are explicit and short (auto-generated composite FK names exceeded 63 chars).
- Normalizations beyond the spec text: every `boolean` with a default and every `status`-like column is `NOT NULL`; `class_group.status` got `CHECK IN ('active','archived')` (rule: enumerations are text + CHECK); `contact_point` index is `(organization_id, person_id)` (composite-FK friendly) instead of `(person_id)`.
- **`scripts/migrate.js` is pg-only.** Next's standalone output bundles `drizzle-orm` into the route chunks and does not ship it as a package (tracing it in was unreliable across the pnpm layout), so the image runner re-implements drizzle's tiny migration algorithm against the same `drizzle.__drizzle_migrations` table. `scripts/migrate.ts` (local, tsx) uses drizzle's `migrate()`; `tests/int/migrate.test.ts` proves both agree in either order.
- Migration SQL files must be UTF-8 **without BOM** (a BOM makes the first statement fail) and must not contain the literal text `--> statement-breakpoint` outside of real breakpoints (even in comments).
- ESLint: `src/app/api/health/**` may import `@/db/client` (the health probe is the one anonymous DB read); `scripts/**/*.js` may use `require()`.
- `pnpm verify` stays typecheck + lint + unit (no Docker needed); `pnpm verify:full` adds `test:int`. Int tests reset `app_test` by dropping the app-owned schemas as app_owner (no superuser needed) and re-running the migrator; `pnpm db:reset:test` does a full drop/create through `docker compose exec`.
