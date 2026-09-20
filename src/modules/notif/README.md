# notif

In-app notifications (no Web Push in phase 1).

Files: `schema.ts` (Drizzle tables, pg schema `notif`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
