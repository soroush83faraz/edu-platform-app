# academic

school_enrollment, class_enrollment (dated), teacher_assignment.

Files: `schema.ts` (Drizzle tables, pg schema `academic`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
