// Runs in every int worker before the test file: points DATABASE_URL / MIGRATION_DATABASE_URL at app_test
// so `src/lib/env.ts` (imported by `@/db/client`) never sees the development database.
import "./env";
