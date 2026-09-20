# iam

Persons, user accounts, sessions, roles, permissions, role assignments, login attempts.

Files: `schema.ts` (Drizzle tables, pg schema `iam`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
