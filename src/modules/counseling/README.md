# counseling

«مشاوره», phase 1 (owner, 2026-10-13; docs/decisions.md «مشاوره — فاز ۱»): the counselor's student file — notes
(`counselor_note`), teachers' reports (`teacher_report`), referrals to management and report requests to teachers
(`referral` → a confidential work item). pg schema `counseling` (migration 0018).

Files: `schema.ts` (Drizzle tables re-exported from src/db/schema/counseling.ts), `policy.ts` (the pure rules: reach,
note visibility, grouping by پایه, referral states and strings — unit-tested), `dto.ts` (Zod `.strict()` inputs),
`repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `queries.ts` / `actions.ts`
(`defineQuery` / `defineAction`), `ui/` (the forms of the file and of the teacher's report page).

Confidentiality: the service's reach (NOT_FOUND outside it) AND the RESTRICTIVE RLS policies of 0018 for app_rw;
audit rows carry ids, kinds and lengths — never a note's, a report's or a referral's text.
