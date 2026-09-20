// Database access boundary (implemented in the DB block).
// ONLY `withTenant(ctx, fn)` and `withoutTenant(fn)` will be exported from this file.
// The pg Pool and the Drizzle instance stay private to this module — no raw `db` anywhere.
// Importing this file is restricted by ESLint to src/lib/actions/**, src/db/** and scripts/**.
export {};
