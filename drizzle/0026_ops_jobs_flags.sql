-- «زیرساخت فنی: صف، زمان‌بند و Feature Flag» (owner 2026-10-20; docs/decisions.md; docs/db.md ops, config). Additive:
--
-- 1) New schema `ops`:
--    ops.job       a tenant table (organization_id NOT NULL → tenant_isolation through apply_rls, ENABLE + FORCE):
--                  the Postgres-only job runner's queue. Enqueued INSIDE the business transaction (outbox semantics),
--                  payload = ids/numbers only (≤ 2 KiB, CHECK), dedupe key unique per organization, lease
--                  (locked_by / locked_until), attempts / max_attempts, dead-letter. app_rw reads and writes only its
--                  own organization's rows; the ONE cross-organization operation — claiming due jobs — is
--                  app.claim_jobs below.
--    ops.schedule  a GLOBAL table (no organization_id, no RLS, like the seed catalogs): the code-registered recurring
--                  schedules and the tick each fired last; taken FOR UPDATE SKIP LOCKED by the scheduler so two
--                  workers never fire the same tick.
-- 2) config.feature_flag gets `school_id` (nullable = organization level) with the composite FK to tenancy.school; its
--    unique key widens from (organization_id, key) to (organization_id, school_id, key) NULLS NOT DISTINCT — the same
--    shape as config.setting_value. The table has never been written by the application (no row can violate it).
-- 3) app.claim_jobs(worker, kinds[], limits[], leases[]): SECURITY DEFINER (owner app_owner, pinned search_path,
--    every name schema-qualified — the 0025 pattern), EXECUTE for app_rw only. app_owner is FORCE-RLS-bound like
--    everyone, so two permissive policies TO app_owner (job_runner_select / job_runner_update, USING true) let the
--    function — and only app_owner, the migration role — see and lease every organization's due jobs. It returns
--    ids, organization ids, kinds and attempts — never a payload; the handler then reads its job inside withTenant of
--    that organization. apply_rls() never drops these two (it manages its own six policy names).
-- 4) The three helper functions are redefined with `ops` in their schema lists — apply_grants() is 0024's definition
--    (0025 re-applied it unchanged) plus `ops`; apply_rls() and apply_updated_at_triggers() are 0018's plus `ops`.
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "job_org_dedupe_uq" UNIQUE("organization_id","dedupe_key"),
	CONSTRAINT "job_kind_chk" CHECK ("ops"."job"."kind" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("ops"."job"."kind") <= 80),
	CONSTRAINT "job_status_chk" CHECK ("ops"."job"."status" IN ('queued', 'running', 'done', 'failed', 'dead')),
	CONSTRAINT "job_payload_chk" CHECK (jsonb_typeof("ops"."job"."payload") = 'object' AND octet_length("ops"."job"."payload"::text) <= 2048),
	CONSTRAINT "job_attempts_chk" CHECK ("ops"."job"."attempts" >= 0 AND "ops"."job"."max_attempts" BETWEEN 1 AND 25),
	CONSTRAINT "job_lease_chk" CHECK (("ops"."job"."status" = 'running') = ("ops"."job"."locked_by" IS NOT NULL AND "ops"."job"."locked_until" IS NOT NULL)),
	CONSTRAINT "job_finished_chk" CHECK (("ops"."job"."status" IN ('done', 'dead')) = ("ops"."job"."finished_at" IS NOT NULL)),
	CONSTRAINT "job_last_error_chk" CHECK (char_length("ops"."job"."last_error") <= 500),
	CONSTRAINT "job_dedupe_key_chk" CHECK (char_length("ops"."job"."dedupe_key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "ops"."schedule" (
	"name" text PRIMARY KEY NOT NULL,
	"cron" text NOT NULL,
	"kind" text NOT NULL,
	"next_fire_at" timestamp with time zone NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_name_chk" CHECK ("ops"."schedule"."name" ~ '^[a-z][a-z0-9_.-]{2,79}$'),
	CONSTRAINT "schedule_cron_chk" CHECK (char_length("ops"."schedule"."cron") BETWEEN 9 AND 100)
);
--> statement-breakpoint
ALTER TABLE "config"."feature_flag" DROP CONSTRAINT "feature_flag_org_key_uq";--> statement-breakpoint
ALTER TABLE "config"."feature_flag" ADD COLUMN "school_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."job" ADD CONSTRAINT "job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "ops"."job" USING btree ("kind","run_at") WHERE "ops"."job"."status" IN ('queued', 'failed');--> statement-breakpoint
CREATE INDEX "job_lease_idx" ON "ops"."job" USING btree ("kind","locked_until") WHERE "ops"."job"."status" = 'running';--> statement-breakpoint
CREATE INDEX "job_org_status_idx" ON "ops"."job" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "config"."feature_flag" ADD CONSTRAINT "feature_flag_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config"."feature_flag" ADD CONSTRAINT "feature_flag_org_school_key_uq" UNIQUE NULLS NOT DISTINCT("organization_id","school_id","key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.apply_grants() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE s text;
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA app TO app_rw, app_backup';
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling','ops')
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
  -- The tenant-scoped catalog of primary learning objectives (migration 0017): written by the catalog seed only.
  IF to_regclass('academic.learning_objective') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON academic.learning_objective FROM app_rw';
  END IF;

  -- Append-only audit trail: the application inserts and reads, never rewrites.
  IF to_regclass('audit.audit_log') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit.audit_log FROM app_rw';
  END IF;

  -- «مشاوره» (migration 0018): notes and reports are withdrawn by status/archived_at, never deleted; a referral is
  -- an immutable link (its status lives on the work item).
  IF to_regclass('counseling.counselor_note') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON counseling.counselor_note FROM app_rw';
  END IF;
  IF to_regclass('counseling.teacher_report') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON counseling.teacher_report FROM app_rw';
  END IF;
  IF to_regclass('counseling.referral') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON counseling.referral FROM app_rw';
  END IF;

  -- «اولیا» (migration 0020): a guardian link is ended (status 'archived' + archived_at), never deleted.
  IF to_regclass('iam.guardian_link') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON iam.guardian_link FROM app_rw';
  END IF;

  -- «ارتباط ولی و مدرسه» (migration 0022): a guardian's message link is immutable — its status and the answer live
  -- on the work item.
  IF to_regclass('workspace.guardian_message') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON workspace.guardian_message FROM app_rw';
  END IF;

  -- «پیوست تکلیف و تحویل پاسخ» (migration 0024): a file, its link to a تکلیف and a student's پاسخ are withdrawn by
  -- status / archived_at, never deleted (the bytes of an archived file are removed from disk by the application).
  IF to_regclass('files.file_object') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON files.file_object FROM app_rw';
  END IF;
  IF to_regclass('workspace.work_item_attachment') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON workspace.work_item_attachment FROM app_rw';
  END IF;
  IF to_regclass('workspace.work_item_submission') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON workspace.work_item_submission FROM app_rw';
  END IF;

  -- «صف کارهای پس‌زمینه» (migration 0026): ops.job and ops.schedule keep full DML for app_rw — the worker completes,
  -- retries and prunes its own organization's jobs under tenant_isolation, and upserts the code-registered schedules.

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
      AND c.table_schema IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling','ops')
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
CREATE OR REPLACE FUNCTION app.apply_updated_at_triggers() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.column_name = 'updated_at'
      AND c.table_schema IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling','ops')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      r.table_schema, r.table_name);
  END LOOP;
END
$fn$;
--> statement-breakpoint
CREATE POLICY job_runner_select ON ops.job FOR SELECT TO app_owner USING (true);
--> statement-breakpoint
CREATE POLICY job_runner_update ON ops.job FOR UPDATE TO app_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Leases due jobs of the given kinds across organizations: at most p_limits[i] of p_kinds[i] (≤ 50 each), oldest
-- run_at first, rows nobody else holds (FOR UPDATE SKIP LOCKED — two workers never lease the same job). Due = queued /
-- failed with run_at <= now(), or running with an EXPIRED lease and attempts left (the holder died: re-run, at least
-- once). A running job whose lease expired on its last attempt is dead-lettered here (rows a live run holds are
-- skipped, never waited for). Leasing increments attempts and sets locked_by / locked_until = now() + p_leases[i]
-- seconds (5 s … 1 h; the runner passes the kind's timeout + 30 s and holds the row FOR UPDATE while it runs).
CREATE OR REPLACE FUNCTION app.claim_jobs(p_worker text, p_kinds text[], p_limits integer[], p_leases integer[])
RETURNS TABLE (job_id uuid, job_organization_id uuid, job_kind text, job_attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $fn$
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'app.claim_jobs: invalid worker id' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_kinds), 0) <> coalesce(cardinality(p_limits), 0)
     OR coalesce(cardinality(p_kinds), 0) <> coalesce(cardinality(p_leases), 0)
     OR coalesce(cardinality(p_kinds), 0) > 50 THEN
    RAISE EXCEPTION 'app.claim_jobs: kinds, limits and leases must pair up (at most 50)' USING ERRCODE = '22023';
  END IF;
  UPDATE ops.job j
     SET status = 'dead', locked_by = NULL, locked_until = NULL, finished_at = now(),
         last_error = left('lease expired on the last attempt (' || j.locked_by || ')', 500)
    FROM (SELECT x.id FROM ops.job x
          WHERE x.status = 'running' AND x.locked_until < now() AND x.attempts >= x.max_attempts AND x.kind = ANY (p_kinds)
          FOR UPDATE SKIP LOCKED) expired
   WHERE j.id = expired.id;
  RETURN QUERY
  WITH wanted AS (
    SELECT w.kind, least(greatest(coalesce(w.lim, 0), 0), 50) AS lim, least(greatest(coalesce(w.lease, 60), 5), 3600) AS lease
    FROM unnest(p_kinds, p_limits, p_leases) AS w(kind, lim, lease)
  ), picked AS (
    SELECT x.id, wanted.lease
    FROM wanted
    CROSS JOIN LATERAL (
      SELECT j.id
      FROM ops.job j
      WHERE j.kind = wanted.kind
        AND ((j.status IN ('queued', 'failed') AND j.run_at <= now())
          OR (j.status = 'running' AND j.locked_until < now() AND j.attempts < j.max_attempts))
      ORDER BY j.run_at, j.id
      LIMIT wanted.lim
      FOR UPDATE SKIP LOCKED
    ) x
  )
  UPDATE ops.job j
     SET status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
         locked_until = now() + make_interval(secs => picked.lease)
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.id, j.organization_id, j.kind, j.attempts;
END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.claim_jobs(text, text[], integer[], integer[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_jobs(text, text[], integer[], integer[]) TO app_rw;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
