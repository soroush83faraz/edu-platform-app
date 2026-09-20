-- Custom migration: grants for the runtime/backup roles + Row-Level Security on every tenant table.
-- Both routines are idempotent. Every later migration that adds a schema or a table MUST end with
-- `SELECT app.apply_grants();` and `SELECT app.apply_rls();` (each as its own statement).
-- Runs as app_owner (MIGRATION_DATABASE_URL); app_owner owns the schemas and its own default privileges.

-- Privileges: app_rw = DML on tenant + global tables (RLS still applies, NOBYPASSRLS), app_backup = read-only.
-- Default privileges make tables created later by app_owner in these schemas inherit the same grants.
CREATE OR REPLACE FUNCTION app.apply_grants() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE s text;
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA app TO app_rw, app_backup';
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_rw, app_backup', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_rw', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO app_backup', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_rw', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT ON TABLES TO app_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_rw', s);
  END LOOP;

  -- Seed-managed catalogs: the runtime role may only read them.
  IF to_regclass('iam.permission') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON iam.permission FROM app_rw';
  END IF;
  IF to_regclass('iam.role_permission') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON iam.role_permission FROM app_rw';
  END IF;

  -- /api/health compares applied migrations with drizzle/meta/_journal.json.
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO app_rw';
    EXECUTE 'GRANT SELECT ON drizzle.__drizzle_migrations TO app_rw';
  END IF;
END
$fn$;
--> statement-breakpoint
-- RLS: every base table with an organization_id column in a tenant schema gets ENABLE + FORCE and a
-- `tenant_isolation` policy bound to app.current_org_id() (NULL when unset -> nothing matches -> fail closed).
-- Nullable organization_id (iam.role): NULL rows are system templates — visible to every tenant, never
-- writable through the tenant policy; only app_owner (seed) may write them via `system_templates`.
CREATE OR REPLACE FUNCTION app.apply_rls() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS system_templates ON %I.%I', r.table_schema, r.table_name);
    IF r.is_nullable = 'YES' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I.%I USING (organization_id IS NULL OR organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id())',
        r.table_schema, r.table_name);
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
