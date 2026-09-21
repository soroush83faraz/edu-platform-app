ALTER TABLE "iam"."login_attempt" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
-- Login hardening after QA round 1 (docs/decisions.md «QA round 1 — auth»; docs/auth.md «محدودسازی»):
-- `cleared_at` is stamped by «رفع قفل» (iam/service unlockAccount) on the identifier's uncleared failures of the last
-- 24 hours. The rows stay (audit trail) but `countRecentFailures` ignores them, so an unlock really unlocks — before,
-- only user_account was reset while the iam.login_attempt windows kept refusing the login. Nullable + additive.
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
