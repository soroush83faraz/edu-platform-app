# academic

school_enrollment, class_enrollment (dated; one active class per student per day — exclusion constraint), teacher_assignment.

`service.ts`: `assignTeacher` / `endTeacherAssignment` (also write/revoke the derived `teacher` role_assignment), `enrollStudent` / `moveEnrollment`. All `(tx, ctx, input)`, audited via `src/lib/audit.ts`; the demo seed uses them too.

Files: `schema.ts` (Drizzle tables, pg schema `academic`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).
