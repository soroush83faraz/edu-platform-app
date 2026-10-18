CREATE TABLE "iam"."guardian_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"guardian_person_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_link_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "guardian_link_relation_chk" CHECK ("iam"."guardian_link"."relation" IN ('father', 'mother', 'guardian', 'other')),
	CONSTRAINT "guardian_link_status_chk" CHECK ("iam"."guardian_link"."status" IN ('active', 'archived')),
	CONSTRAINT "guardian_link_archived_chk" CHECK (("iam"."guardian_link"."status" = 'archived') = ("iam"."guardian_link"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "iam"."guardian_link" ADD CONSTRAINT "guardian_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."guardian_link" ADD CONSTRAINT "guardian_link_guardian_fk" FOREIGN KEY ("organization_id","guardian_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."guardian_link" ADD CONSTRAINT "guardian_link_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_link_live_uq" ON "iam"."guardian_link" USING btree ("organization_id","guardian_person_id","student_profile_id") WHERE "iam"."guardian_link"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_link_primary_uq" ON "iam"."guardian_link" USING btree ("organization_id","student_profile_id") WHERE "iam"."guardian_link"."is_primary" AND "iam"."guardian_link"."status" = 'active';--> statement-breakpoint
CREATE INDEX "guardian_link_org_student_idx" ON "iam"."guardian_link" USING btree ("organization_id","student_profile_id");--> statement-breakpoint
CREATE INDEX "guardian_link_org_guardian_idx" ON "iam"."guardian_link" USING btree ("organization_id","guardian_person_id");
--> statement-breakpoint
-- «اولیا» — phase 1 (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»; docs/db.md iam.guardian_link):
-- 1) iam.guardian_link — a guardian (a person of the organization) ↔ a child (student_profile), one row per link with
--    its relation (پدر / مادر / سرپرست / سایر) and an optional primary flag; composite FKs to person and student_profile;
--    one LIVE link per (organization, guardian, student) and one live PRIMARY guardian per student (partial uniques).
--    A live link carries a derived role_assignment (guardian_full, scope 'student', source_type 'guardian_relationship',
--    source_id = the link) written by the service — role_assignment needs no change (its CHECKs already allow both).
--    It lives in the existing `iam` schema, so apply_rls() / apply_updated_at_triggers() pick it up unchanged:
--    tenant_isolation (ENABLE + FORCE), the updated_at trigger. No RESTRICTIVE policy: like the rest of iam, the service
--    is the boundary inside a tenant (src/modules/iam/guardian.ts) — every guardian read requires the live link AND the
--    permission at the child's student scope.
-- 2) app.apply_grants() — the definition of 0018, unchanged but for ONE more REVOKE: app_rw may not DELETE a guardian
--    link (ending one is status 'archived' + archived_at; history stays, like the counseling rows). Re-applied after
--    every migration, like the audit_log rule.
-- Additive only, no backfill.
CREATE OR REPLACE FUNCTION app.apply_grants() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE s text;
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA app TO app_rw, app_backup';
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling')
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
