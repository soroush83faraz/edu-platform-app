# config

Feature flags and per-organization settings.

Files: `schema.ts` (Drizzle tables, pg schema `config`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
