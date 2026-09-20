# tenancy

Organization, school, branch, academic year/term, levels, grades, subjects, class groups and offerings.

Files: `schema.ts` (Drizzle tables, pg schema `tenancy`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
