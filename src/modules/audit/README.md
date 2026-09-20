# audit

Append-only audit_log and login_event.

Files: `schema.ts` (Drizzle tables, pg schema `audit`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
