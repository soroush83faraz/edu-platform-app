# workspace

work_item (کارتابل): types, statuses, assignees, watchers, comments, transitions, inbox entries.

Files: `schema.ts` (Drizzle tables, pg schema `workspace`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
