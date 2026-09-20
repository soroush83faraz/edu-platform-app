# files

file_object metadata and storage access (disk under FILES_DIR).

Files: `schema.ts` (Drizzle tables, pg schema `files`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
