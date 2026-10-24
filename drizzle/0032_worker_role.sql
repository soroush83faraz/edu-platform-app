-- The background worker's own database role, `app_worker` (security review 2026-10-20, F3 / F4 / F8; docs/decisions.md
-- «Security review of 0026–0028», docs/db.md «نقش‌ها», deploy/README.md «نقش app_worker»). Until now the worker
-- connected as app_rw, so the WEB role could call app.claim_jobs — lease (and so stall) any organization's due jobs and
-- read their ids, organizations and kinds — and rewrite ops.schedule (silence or flood every recurring job).
--
-- ROLES CANNOT BE CREATED HERE: app_owner, the migration role, is NOCREATEROLE (deploy/db/initdb/01-roles.sh). A new
-- install gets app_worker from 01-roles.sh (APP_WORKER_PASSWORD); an existing server needs the ONE-TIME superuser SQL in
-- deploy/README.md. Everything below is therefore CONDITIONAL on the role existing, and app.apply_grants() — run by
-- every migration — finishes the job whenever it does:
--   • app_worker exists → it gets exactly app_rw's grants (schema usage, table and sequence DML, default privileges,
--     every REVOKE, EXECUTE on the app functions app_rw holds) AND is bound by every role-bound RLS policy app_rw is
--     bound by (`ALTER POLICY … TO app_rw, app_worker` — the RESTRICTIVE person policies of counseling, files, guardian
--     messages, … must bind the system actor exactly as they did while it ran as app_rw); plus the worker-only rights:
--     EXECUTE on app.claim_jobs and SELECT / INSERT / UPDATE on ops.schedule — which app_rw LOSES (no ops.schedule at
--     all: the web app never reads it; the watchdog reads ops.job as app_backup).
--   • app_worker does not exist yet → app_rw keeps both (the FALLBACK: the worker keeps running as app_rw on
--     DATABASE_URL until the operator creates the role and sets WORKER_DATABASE_URL; nothing breaks on deploy).
-- app_worker is "member of nothing" (NOINHERIT, no role memberships): it holds only what is granted to it by name.
--
-- 1) ops.schedule gets a CHECK that its ticks are finite (F4: 'infinity' would silence a schedule for good,
--    '-infinity' would make every tick that reads it throw); a non-finite value is repaired first (due now / no last
--    fire), so the constraint cannot fail on existing rows. The worker also repairs an absurd tick at start
--    (`syncSchedules`: later than the next one the cron gives from now).
-- 2) app.apply_grants() is 0026's definition (the latest; 0027–0031 did not redefine it) with: the role list `rw`
--    (app_rw, and app_worker when it exists) wherever 0026 named app_rw; the worker-only block; the policy mirroring;
--    and the REVOKE DELETE lines 0027 / 0028 / 0029 deferred to "the next migration that redefines apply_grants"
--    (academic.session_report, workspace.request_sla, academic.leave_request, academic.early_exit — their RESTRICTIVE
--    no-delete policies stay as a second net).
-- 3) app.claim_jobs() is 0026's with a FAIR pick (F8): per kind, the oldest due rows (at most 1000 — the window) are
--    taken in rounds across organizations — every organization's oldest due job before anyone's second — then by age.
--    One organization's burst no longer starves the others' jobs of the same kind. Locking is unchanged in effect:
--    the chosen rows are locked FOR UPDATE SKIP LOCKED (rows another worker holds are skipped) and re-checked as due.
-- 4) the three apply_* calls.
UPDATE ops.schedule SET next_fire_at = now() WHERE NOT isfinite(next_fire_at);
--> statement-breakpoint
UPDATE ops.schedule SET last_fired_at = NULL WHERE last_fired_at IS NOT NULL AND NOT isfinite(last_fired_at);
--> statement-breakpoint
ALTER TABLE "ops"."schedule" ADD CONSTRAINT "schedule_finite_chk" CHECK (isfinite("ops"."schedule"."next_fire_at") AND ("ops"."schedule"."last_fired_at" IS NULL OR isfinite("ops"."schedule"."last_fired_at")));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.apply_grants() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  s text;
  f text;
  pol record;
  -- The worker's own role (this migration): mirrored on app_rw while it exists, absent until the operator creates it.
  w boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker');
  rw text;
BEGIN
  rw := CASE WHEN w THEN 'app_rw, app_worker' ELSE 'app_rw' END;
  EXECUTE format('GRANT USAGE ON SCHEMA app TO %s, app_backup', rw);
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling','ops')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %s, app_backup', s, rw);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %s', s, rw);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO app_backup', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %s', s, rw);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %s', s, rw);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT ON TABLES TO app_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %s', s, rw);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA %I GRANT SELECT ON SEQUENCES TO app_backup', s);
  END LOOP;

  -- Seed-managed catalogs: the runtime roles may only read them.
  IF to_regclass('iam.permission') IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON iam.permission FROM %s', rw);
  END IF;
  IF to_regclass('iam.role_permission') IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON iam.role_permission FROM %s', rw);
  END IF;
  IF to_regclass('workspace.work_item_status') IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON workspace.work_item_status FROM %s', rw);
  END IF;
  IF to_regclass('notif.notification_type') IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON notif.notification_type FROM %s', rw);
  END IF;
  -- The tenant-scoped catalog of primary learning objectives (migration 0017): written by the catalog seed only.
  IF to_regclass('academic.learning_objective') IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON academic.learning_objective FROM %s', rw);
  END IF;

  -- Append-only audit trail: the application inserts and reads, never rewrites.
  IF to_regclass('audit.audit_log') IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE ON audit.audit_log FROM %s', rw);
  END IF;

  -- «مشاوره» (migration 0018): notes and reports are withdrawn by status/archived_at, never deleted; a referral is
  -- an immutable link (its status lives on the work item).
  IF to_regclass('counseling.counselor_note') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON counseling.counselor_note FROM %s', rw);
  END IF;
  IF to_regclass('counseling.teacher_report') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON counseling.teacher_report FROM %s', rw);
  END IF;
  IF to_regclass('counseling.referral') IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE ON counseling.referral FROM %s', rw);
  END IF;

  -- «اولیا» (migration 0020): a guardian link is ended (status 'archived' + archived_at), never deleted.
  IF to_regclass('iam.guardian_link') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON iam.guardian_link FROM %s', rw);
  END IF;

  -- «ارتباط ولی و مدرسه» (migration 0022): a guardian's message link is immutable — its status and the answer live
  -- on the work item.
  IF to_regclass('workspace.guardian_message') IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE ON workspace.guardian_message FROM %s', rw);
  END IF;

  -- «پیوست تکلیف و تحویل پاسخ» (migration 0024): a file, its link to a تکلیف and a student's پاسخ are withdrawn by
  -- status / archived_at, never deleted (the bytes of an archived file are removed from disk by the application).
  IF to_regclass('files.file_object') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON files.file_object FROM %s', rw);
  END IF;
  IF to_regclass('workspace.work_item_attachment') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON workspace.work_item_attachment FROM %s', rw);
  END IF;
  IF to_regclass('workspace.work_item_submission') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON workspace.work_item_submission FROM %s', rw);
  END IF;

  -- «گزارش جلسه» (0027), «مرکز درخواست‌ها» (0028), «مرخصی و خروج مجاز» (0029): withdrawn by status, never deleted —
  -- the REVOKE those migrations deferred to the next redefinition of this function (their RESTRICTIVE no-delete
  -- policies stay as a second net).
  IF to_regclass('academic.session_report') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON academic.session_report FROM %s', rw);
  END IF;
  IF to_regclass('workspace.request_sla') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON workspace.request_sla FROM %s', rw);
  END IF;
  IF to_regclass('academic.leave_request') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON academic.leave_request FROM %s', rw);
  END IF;
  IF to_regclass('academic.early_exit') IS NOT NULL THEN
    EXECUTE format('REVOKE DELETE ON academic.early_exit FROM %s', rw);
  END IF;

  -- The app functions app_rw may execute (SECURITY DEFINER, REVOKEd from PUBLIC by 0023 / 0025): the worker too.
  IF w THEN
    FOREACH f IN ARRAY ARRAY['app.guardian_message_routes(uuid)', 'app.expire_stale_uploads(integer)', 'app.live_file_ids(uuid[])'] LOOP
      IF to_regprocedure(f) IS NOT NULL THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_worker', f);
      END IF;
    END LOOP;
    -- Every policy bound to app_rw binds app_worker too: the system actor reads and writes under the same RESTRICTIVE
    -- policies as when it ran as app_rw (counseling, files, guardian messages, attachments, submissions, the
    -- no-delete / own-name policies of 0027–0029, …). ALTER POLICY keeps the policy's command and expressions.
    FOR pol IN
      SELECT p.schemaname, p.tablename, p.policyname, p.roles
      FROM pg_policies p
      WHERE p.schemaname IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling','ops')
        AND 'app_rw' = ANY (p.roles) AND NOT ('app_worker' = ANY (p.roles))
    LOOP
      EXECUTE format('ALTER POLICY %I ON %I.%I TO %s', pol.policyname, pol.schemaname, pol.tablename,
        (SELECT string_agg(quote_ident(r), ', ' ORDER BY r) FROM unnest(pol.roles || 'app_worker'::name) r));
    END LOOP;
  END IF;

  -- «صف کارهای پس‌زمینه» (0026; this migration): the claim across organizations and the schedules are the WORKER's.
  -- With app_worker: EXECUTE on app.claim_jobs and SELECT / INSERT / UPDATE on ops.schedule for it alone (no DELETE —
  -- schedules are upserted, never removed by the worker); app_rw loses both. Without it: app_rw keeps both (the fallback).
  -- ops.job keeps full DML for both runtime roles: the web enqueues (and reads its organization's jobs), the worker
  -- completes, retries and prunes them — under tenant_isolation either way.
  IF to_regprocedure('app.claim_jobs(text, text[], integer[], integer[])') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_jobs(text, text[], integer[], integer[]) FROM PUBLIC';
    IF w THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION app.claim_jobs(text, text[], integer[], integer[]) TO app_worker';
      EXECUTE 'REVOKE EXECUTE ON FUNCTION app.claim_jobs(text, text[], integer[], integer[]) FROM app_rw';
    ELSE
      EXECUTE 'GRANT EXECUTE ON FUNCTION app.claim_jobs(text, text[], integer[], integer[]) TO app_rw';
    END IF;
  END IF;
  IF to_regclass('ops.schedule') IS NOT NULL AND w THEN
    EXECUTE 'REVOKE ALL ON ops.schedule FROM app_rw';
    EXECUTE 'REVOKE DELETE, TRUNCATE ON ops.schedule FROM app_worker';
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
-- 0026's claim with a fair pick (see the header). Leases due jobs of the given kinds across organizations: at most
-- p_limits[i] of p_kinds[i] (≤ 50 each). Due = queued / failed with run_at <= now(), or running with an EXPIRED lease
-- and attempts left (the holder died: re-run, at least once). A running job whose lease expired on its last attempt is
-- dead-lettered here (rows a live run holds are skipped, never waited for). Within a kind the window of the oldest
-- 1000 due rows is ordered by each organization's turn (its 1st oldest, then its 2nd, …), then by age — so every
-- organization's oldest due job comes before anyone's second; the chosen rows are locked FOR UPDATE SKIP LOCKED and
-- re-checked as due. Leasing increments attempts and sets locked_by / locked_until = now() + p_leases[i] seconds
-- (5 s … 1 h; the runner passes the kind's timeout + 30 s and holds the row FOR UPDATE while it runs).
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
    SELECT DISTINCT ON (w.kind) w.kind, least(greatest(coalesce(w.lim, 0), 0), 50) AS lim, least(greatest(coalesce(w.lease, 60), 5), 3600) AS lease
    FROM unnest(p_kinds, p_limits, p_leases) AS w(kind, lim, lease)
    ORDER BY w.kind
  ), window_rows AS (
    SELECT wanted.kind, wanted.lim, wanted.lease, x.id, x.organization_id, x.run_at
    FROM wanted
    CROSS JOIN LATERAL (
      SELECT j.id, j.organization_id, j.run_at
      FROM ops.job j
      WHERE j.kind = wanted.kind
        AND ((j.status IN ('queued', 'failed') AND j.run_at <= now())
          OR (j.status = 'running' AND j.locked_until < now() AND j.attempts < j.max_attempts))
      ORDER BY j.run_at, j.id
      LIMIT 1000
    ) x
    WHERE wanted.lim > 0
  ), turns AS (
    SELECT r.*, row_number() OVER (PARTITION BY r.kind, r.organization_id ORDER BY r.run_at, r.id) AS org_turn
    FROM window_rows r
  ), chosen AS (
    SELECT c.id, c.lease
    FROM (SELECT t.*, row_number() OVER (PARTITION BY t.kind ORDER BY t.org_turn, t.run_at, t.id) AS pick FROM turns t) c
    WHERE c.pick <= c.lim
  ), locked AS (
    SELECT j.id, chosen.lease
    FROM ops.job j
    JOIN chosen ON chosen.id = j.id
    WHERE (j.status IN ('queued', 'failed') AND j.run_at <= now())
       OR (j.status = 'running' AND j.locked_until < now() AND j.attempts < j.max_attempts)
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE ops.job j
     SET status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
         locked_until = now() + make_interval(secs => locked.lease)
    FROM locked
   WHERE j.id = locked.id
  RETURNING j.id, j.organization_id, j.kind, j.attempts;
END
$fn$;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
