-- Custom migration: let a request that knows WHICH ACCOUNT it acts for read that account's memberships across
-- organizations. Needed exactly once per login (the org is not known before the membership is resolved).
-- The app sets app.current_user_account_id from the verified user_account row, never from client input.
-- Additive: a second, permissive SELECT-only policy next to tenant_isolation (which app.apply_rls() keeps managing).
CREATE OR REPLACE FUNCTION app.current_user_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_account_id', true), '')::uuid $$;
--> statement-breakpoint
DROP POLICY IF EXISTS account_memberships ON iam.organization_membership;
--> statement-breakpoint
CREATE POLICY account_memberships ON iam.organization_membership FOR SELECT
  USING (user_account_id = app.current_user_account_id());
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
