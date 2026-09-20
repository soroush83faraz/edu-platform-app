# scripts
Operational CLIs run with `tsx` locally: `migrate` (also as pg-only `migrate.js` inside the image), `seed`, later `import`, `build-template`. They may import `src/db/*` and create their OWN pool as `app_owner` (`MIGRATION_DATABASE_URL`).

- `pnpm seed` → `seed.ts --catalog`: permissions + system roles (idempotent, authoritative). Run after every migrate.
- `pnpm seed:demo` → `seed.ts --catalog --demo` (requires `SEED_DEMO=1`; `SEED_DEMO_PASSWORD`, `SEED_DEMO_NO_FORCE=1` optional). Deterministic ids/phones; re-running resets the demo passwords.
- Production refuses to seed unless `SEED_ALLOW=1`. TODO: pg-only `seed.js` for the standalone image (see deploy/README.md).
- `pnpm smoke:prod` → `smoke-prod.ts`: black-box end-to-end probe of a RUNNING deployment over HTTP only (`BASE_URL`, `SMOKE_IDENTIFIER`, `SMOKE_PASSWORD`): health → real login form → inbox summary → create todo → done → logout → protected route redirects. Run after every deploy (docs/ops/runbook.md).
- `pnpm sessions:revoke --user <login> | --org <slug> --yes | --all --yes` → `revoke-sessions.ts`: revokes live sessions through `withoutTenant`/`withTenant` + `revokeAllForUser` (incident lever, docs/ops/incident.md). Runs as `app_rw` (`DATABASE_URL`).
