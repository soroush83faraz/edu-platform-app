# src/db
`client.ts` (withTenant/withoutTenant, plus `bindAccountContext` for the login-time membership lookup — the only file that may call `set_config`, enforced by `pnpm verify`), `schema/` (Drizzle tables per module + `_common.ts`), migrations live in `/drizzle` (committed SQL, additive-only; every one ends with `apply_grants` / `apply_rls` / `apply_updated_at_triggers`).
