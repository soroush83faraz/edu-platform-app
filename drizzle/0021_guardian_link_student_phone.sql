ALTER TABLE "iam"."guardian_link" ADD COLUMN "student_guardian_phone" text;
--> statement-breakpoint
-- «اولیا» — security review 2026-10-19, D4a (docs/decisions.md «اولیا: security review fixes»; docs/db.md
-- iam.guardian_link): the student's «ولی» phone a guardian link was made FROM (the class bulk; «افزودن ولی» with one of
-- the child's «ولی» numbers), NULL otherwise. When that phone changes or goes, the «اولیا» card flags the link for review
-- instead of keeping a possibly mistyped number's access silently — and never unlinks it by itself (a sibling's parent
-- may legitimately have another number). Additive only (a nullable column, no default, no backfill: links made before it
-- are «added with another number» and are never flagged); no table, schema or grant changes — the three calls below
-- re-apply the 0020 definitions unchanged.
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
