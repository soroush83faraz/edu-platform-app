# edu-platform-app — Phase 1 (multi-tenant Persian school PWA)
@AGENTS.md

## Stack (exact, `.npmrc save-exact`; never bump without updating docs/decisions.md)
next 16.3.5 · react/react-dom 19.2.8 · typescript 5.9.3 · tailwindcss 4.3.3 · shadcn 4.21.0 (radix-nova, rtl:true, radix-ui 1.6.7) · drizzle-orm 0.45.2 · drizzle-kit 0.31.10 · zod 4.6.5 · pg 8.23.0 · @node-rs/argon2 2.2.1 · exceljs 4.4.0 · @serwist/next + serwist 9.5.12 · date-fns-jalali 4.4.0-0 · pino 10.3.1 · uuid 14.0.2 · @tanstack/react-table 9.2.4 · vazirmatn 33.0.3 · vitest 5.0.1 · tsx 4.23.15 · Node 22.14 · pnpm 10.22 · PostgreSQL 16.
- Next 16 facts: the request hook file is **`src/proxy.ts`** exporting `proxy()` (`middleware.ts` is deprecated). **`cookies()`, `headers()`, `params`, `searchParams` are async — always `await`.** Read `node_modules/next/dist/docs/` before using an API.
- Zod is v4: `z.url()`, `z.email()`, `error.issues`. Drizzle migrations are SQL files in `/drizzle`.

## Layout
`src/app` (routes only; thin) · `src/modules/<ctx>/{schema,dto,repo,service,actions,ui}` for tenancy, iam, config, files, audit, notif, workspace, academic, integ · `src/db/{client.ts,schema/_common.ts}` · `src/lib/{env,logger,normalize,errors,actions}` · `src/components/ui` (shadcn, generated — do not hand-edit, EXCEPT the two owned files `button.tsx` and `input.tsx` plus our hand-written `select-native.tsx` / `textarea.tsx`: padding-based 44 px controls, see docs/decisions.md «form controls»; a re-generation must re-apply their header blocks) · `scripts/` (migrate, seed, import; tsx) · `drizzle/` (SQL) · `deploy/` (compose, Caddy, ship/deploy scripts) · `tests/{unit,int}`.
Service signature: `(tx, ctx, input)`. Repos take `tx`. Explicit column selects, never `select *`.

## DB rules (non-negotiable)
- The ONLY DB access is `withTenant(ctx, fn)` / `withoutTenant(fn)` from `src/db/client` (ESLint blocks other imports). No raw `db.`; `withoutTenant` only for global tables (organization, user_account, user_session, login_attempt, permission, work_item_status, notification_type) and the read-only `iam.role` / `work_item_type` templates. Every business mutation calls `audit(ctx, action, entity, before, after, tx)` (`src/lib/audit.ts`) in the same transaction. **Never call `set_config(` outside `src/db/client.ts`** (`pnpm verify` greps for it); the login membership lookup uses `tools.bindAccount` from `definePublicAction`.
- Every tenant table has `organization_id` + RLS (ENABLE + FORCE, fail-closed). Composite FKs `(organization_id, x_id)`. Soft delete via `status/archived_at`; `text + CHECK` not pg ENUM; `timestamptz` UTC; UUID v7.
- Migrations: `drizzle-kit generate` → read the SQL → commit → `migrate` service runs it. **Never `drizzle-kit push`; never edit an applied migration; production changes are additive-only** (nullable/DEFAULT columns, expand/contract renames). Every migration ends with `SELECT app.apply_grants();` / `SELECT app.apply_rls();` / `SELECT app.apply_updated_at_triggers();` as separate statements (docs/db.md).
- App connects as `app_rw` (NOSUPERUSER NOBYPASSRLS); migrations as `app_owner` (MIGRATION_DATABASE_URL).

## Action rules
- Every Server Action and Route Handler goes through `defineAction({ schema, permission, scope }, handler)` in `src/lib/actions`. `permission` is REQUIRED (no anonymous actions except login/health). Order: session → must_change_password → Zod `.strict()` → `can()` → `withTenant` → audit in the same transaction.
- `organization_id`, `person_id`, `created_by` come ONLY from the session — never from input. Never spread client input into `.set()` / `.values()`; map fields explicitly.
- Errors leave the boundary only as `AppError` (`src/lib/errors`) with Persian messages. Proxy is a convenience redirect, NOT a security boundary.
- Auth facts come from `getRequestContext()` (`src/lib/ctx.ts`: cookie → DB session → membership → assignments) — never from proxy headers or the cookie alone. `can(tx, ctx, perm, ref?)` runs inside the action's transaction; login is the only `definePublicAction`.

## Frontend rules
- `<html lang="fa" dir="rtl">` is set ONLY in `src/app/layout.tsx`. Never set `dir` elsewhere except `<bdi dir="ltr">` around phone numbers, codes and URLs.
- Tailwind logical utilities only: `ms- me- ps- pe- start- end- text-start text-end rounded-s rounded-e border-s border-e`. NEVER `ml- mr- pl- pr- left- right- text-left text-right`.
- Fonts: `next/font/local` (Vazirmatn variable, `--font-vazir`) only; `next/font/google` is ESLint-blocked. No third-party hosts anywhere (fonts, analytics, CDNs, icons).
- Persian digits via `Intl.NumberFormat("fa-IR")` / `toLocaleString("fa-IR")`; dates via `date-fns-jalali` rendered in `Asia/Tehran`; store UTC.
- All UI text is Persian (نیم‌فاصله where needed); no English strings in UI. Touch targets ≥ 44px. No `dangerouslySetInnerHTML` (ESLint `react/no-danger`).
- Tokens live in `src/app/globals.css` (`@theme`: primary 50–900 persian-blue `#072AC8`, `sky`/`sky-strong` accent (icons, fills, links — never small sky text on white), `info`/`info-soft` soft surfaces, `warning` yellow = FILL only with navy text (`warning-text` for text), success/danger, navy-tinted neutrals; `canvas` `#E8EEF9` is the page ground under the shell and auth pages (white cards lift off it), `surface-sunken` the lighter tint INSIDE cards (row hover, inputs); radius 12px controls / 16px cards (`rounded-card`) / 20px hero (`rounded-hero`); shadow `shadow-1` (cards); gradients: `bg-hero` and the `.clay-icon` material only).
- **Type scale** (`text-*` roles, never ad-hoc sizes): `text-display` 28/34 (desktop page titles), `text-title` 24/32 (phone page titles, dashboard numbers), `text-section` 18/28 (section headings), `text-row` 15/24 (row titles, table cells), body `text-sm` 14/24 (the `body` default), `text-meta` 13/20 (meta lines, hints, table headers). `text-xs` 12 px is for pills/badges ONLY.
- **Surface roles** (utilities in `globals.css`): `surface-work` = white + `shadow-1`, the page's primary content (ONE per view, not a stack); `surface-panel` = `surface-sunken` tint + hairline, no shadow — supporting panels, asides, stat rows, the circle behind a row glyph; `surface-quiet` = no box, heading + hairline under the section. `surface-link` (+ `pressable`) = a whole-surface link: hover lift + end chevron; static cards never hover. Never `rounded-card bg-surface shadow-1` by hand.
- **Layout primitives** (`src/components/layout`): every page = `ContentWidth` (1200 px, `size="reading"` 48 rem for detail/forms) → `PageHeader` (title, description, `count`, `back`, `actions`; from `lg:` it also draws the slim context bar «مدرسه · سال · نوبت · date» from `getShellContext()`) → `PageSection` (`surface="work" | "panel" | "quiet"`) and, on dashboards/details, `TwoColumn` (`lg:grid-cols-12`, main 8/7 + aside 4/5). No ad-hoc `px-4 pt-… flex-col` page wrappers, no bespoke title rows (`AdminHeader` is an alias of `PageHeader`). Icons: lucide inside `ClayIcon` (`src/components/ClayIcon.tsx` — the calm persian-blue squircle, primary-500 → 700, white stroke-2 glyph, one small navy shadow; ONE blue for every live mark, `yellow` only for the one action («کار جدید», high priority), `grey` flat for «به‌زودی»/low priority; sizes sm/md/lg/xl/tile) or its semantic alias `IconChip` (tones → shades) — never a bare icon as a row/tile mark, never a new hue or a glow on icons (the theme is the palette: blue family + the one yellow). Use tokens, not raw hex, in components. Illustrations: `src/components/illustrations` (inline SVG, no assets).

## NOT in Phase 1 (do not add, do not scaffold)
tRPC · GraphQL · Prisma · Redis · BullMQ/queues · Auth.js/NextAuth · microservices · CQRS/event sourcing · Web Push · SMS OTP · file attachments · dark mode · custom roles · staging env.

## Workflow
- `pnpm verify` (typecheck + lint + unit tests) must pass before every commit; `pnpm build` before every deploy. Int tests: `pnpm test:int` (needs Docker Postgres).
- Deploy = `deploy/ship.ps1` (build on Windows → `docker save | ssh docker load` → `deploy.sh`). Never build on the VPS.
- Edit files with the Edit tool, Python or Git Bash `sed` — never `Get-Content | Set-Content` in PowerShell 5.1 (it re-encodes UTF-8 through the ANSI codepage and destroys Persian text).
- **45-minute rule:** a bug not fixed in 45 min → revert to the last green commit and ask for a simpler approach. Commit after every vertical slice.
