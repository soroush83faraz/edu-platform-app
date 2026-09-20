-- Custom migration: DB step 2 constraints Drizzle cannot express + grant tightening for the new catalogs.
--
-- 1) academic.class_enrollment: a student has at most ONE active class enrollment on any given day. Needs btree_gist
--    (uuid equality inside a GiST index). The extension is provisioned by deploy/db/initdb/01-roles.sh and
--    scripts/reset-test-db.ts (like pg_trgm); the CREATE below is a no-op safety net (app_owner owns the database and
--    btree_gist is a trusted extension).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE academic.class_enrollment ADD CONSTRAINT class_enrollment_active_excl
  EXCLUDE USING gist (student_profile_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&)
  WHERE (status = 'active');
--> statement-breakpoint
-- 2) tenancy.class_group.homeroom_staff_id → iam.staff_profile, composite like every other tenant FK. Deferred from
--    step 1 (iam.ts imports tenancy.ts, so the Drizzle definition would be a module cycle); declared ONLY here — the
--    column comment in src/db/schema/tenancy.ts says so.
ALTER TABLE tenancy.class_group ADD CONSTRAINT class_group_homeroom_staff_fk
  FOREIGN KEY (organization_id, homeroom_staff_id) REFERENCES iam.staff_profile (organization_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
-- 3) Grants. Same body as 0007 plus:
--    * workspace.work_item_status and notif.notification_type are seed-managed GLOBAL catalogs (no organization_id,
--      hence no RLS): app_rw may only SELECT them, exactly like iam.permission / iam.role_permission.
--    * audit.audit_log is append-only for the application: app_rw keeps SELECT + INSERT, loses UPDATE + DELETE.
--    The REVOKEs live INSIDE the function so every later `SELECT app.apply_grants()` (which re-GRANTs DML on ALL
--    TABLES of each schema) restores them.
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
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT ON TABLES TO app_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_rw', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT ON SEQUENCES TO app_backup', s);
  END LOOP;

  -- Seed-managed catalogs: the runtime role may only read them.
  IF to_regclass('iam.permission') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON iam.permission FROM app_rw';
  END IF;
  IF to_regclass('iam.role_permission') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON iam.role_permission FROM app_rw';
  END IF;
  IF to_regclass('workspace.work_item_status') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON workspace.work_item_status FROM app_rw';
  END IF;
  IF to_regclass('notif.notification_type') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON notif.notification_type FROM app_rw';
  END IF;

  -- Append-only audit trail: the application inserts and reads, never rewrites.
  IF to_regclass('audit.audit_log') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit.audit_log FROM app_rw';
  END IF;

  -- /api/health compares applied migrations with drizzle/meta/_journal.json; pg_dump (app_backup) must be able to
  -- lock and read the ledger and its id sequence too.
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO app_rw, app_backup';
    EXECUTE 'GRANT SELECT ON drizzle.__drizzle_migrations TO app_rw';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO app_backup';
    EXECUTE 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO app_backup';
  END IF;
END
$fn$;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
