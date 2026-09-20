-- Custom migration: per-command RLS policies for tables whose organization_id is nullable (iam.role today;
-- every future table with the same shape, e.g. workspace.work_item_type).
--
-- Why: the previous single FOR ALL policy `tenant_isolation USING (organization_id IS NULL OR organization_id =
-- app.current_org_id()) WITH CHECK (organization_id = app.current_org_id())` used its USING clause for UPDATE and
-- DELETE targeting too, so app_rw under any tenant could `DELETE FROM iam.role WHERE organization_id IS NULL`
-- (verified: 1 row) or hijack a template with `UPDATE ... SET organization_id = <own org>` (passes WITH CHECK).
-- Now: SELECT keeps seeing templates; INSERT/UPDATE/DELETE are bound to the tenant's own rows only. The
-- app_owner-only `system_templates` policy (seed) is unchanged. NOT NULL tables keep the single `tenant_isolation`.
-- Idempotent: every managed policy name is dropped before it is recreated, in both branches.
CREATE OR REPLACE FUNCTION app.apply_rls() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  p text;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.column_name = 'organization_id'
      AND c.table_schema IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    FOREACH p IN ARRAY ARRAY[
      'tenant_isolation', 'tenant_isolation_select', 'tenant_isolation_write',
      'tenant_isolation_update', 'tenant_isolation_delete', 'system_templates'
    ] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p, r.table_schema, r.table_name);
    END LOOP;
    IF r.is_nullable = 'YES' THEN
      -- Templates (NULL) are readable by every tenant and by transactions without a tenant context.
      EXECUTE format(
        'CREATE POLICY tenant_isolation_select ON %I.%I FOR SELECT USING (organization_id IS NULL OR organization_id = app.current_org_id())',
        r.table_schema, r.table_name);
      -- Writes: only rows tagged with the current tenant. No policy grants UPDATE/DELETE on NULL rows to app_rw.
      EXECUTE format(
        'CREATE POLICY tenant_isolation_write ON %I.%I FOR INSERT WITH CHECK (organization_id = app.current_org_id())',
        r.table_schema, r.table_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation_update ON %I.%I FOR UPDATE USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id())',
        r.table_schema, r.table_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation_delete ON %I.%I FOR DELETE USING (organization_id = app.current_org_id())',
        r.table_schema, r.table_name);
      -- The seed (app_owner, FORCE RLS applies to it too) manages the templates.
      EXECUTE format(
        'CREATE POLICY system_templates ON %I.%I TO app_owner USING (organization_id IS NULL) WITH CHECK (organization_id IS NULL)',
        r.table_schema, r.table_name);
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I.%I USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id())',
        r.table_schema, r.table_name);
    END IF;
  END LOOP;
END
$fn$;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
