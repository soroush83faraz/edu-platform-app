CREATE TABLE "academic"."learning_objective" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"month" smallint NOT NULL,
	"subject_name" text NOT NULL,
	"subject_id" uuid,
	"domain" text,
	"text" text NOT NULL,
	"sort_order" smallint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_objective_slot_uq" UNIQUE("organization_id","grade_level_id","month","subject_name","sort_order"),
	CONSTRAINT "learning_objective_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "learning_objective_month_chk" CHECK ("academic"."learning_objective"."month" BETWEEN 1 AND 12),
	CONSTRAINT "learning_objective_domain_chk" CHECK ("academic"."learning_objective"."domain" IS NULL OR "academic"."learning_objective"."domain" IN ('knowledge', 'application', 'reasoning')),
	CONSTRAINT "learning_objective_status_chk" CHECK ("academic"."learning_objective"."status" IN ('active', 'archived')),
	CONSTRAINT "learning_objective_archived_chk" CHECK (("academic"."learning_objective"."status" = 'archived') = ("academic"."learning_objective"."archived_at" IS NOT NULL)),
	CONSTRAINT "learning_objective_text_chk" CHECK (char_length("academic"."learning_objective"."text") BETWEEN 1 AND 400),
	CONSTRAINT "learning_objective_subject_name_chk" CHECK (char_length("academic"."learning_objective"."subject_name") BETWEEN 1 AND 60),
	CONSTRAINT "learning_objective_sort_chk" CHECK ("academic"."learning_objective"."sort_order" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "academic"."objective_rating" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"learning_objective_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"rated_by_person_id" uuid NOT NULL,
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objective_rating_student_objective_uq" UNIQUE("organization_id","academic_year_id","student_profile_id","learning_objective_id"),
	CONSTRAINT "objective_rating_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "objective_rating_rating_chk" CHECK ("academic"."objective_rating"."rating" IN ('very_good', 'good', 'acceptable', 'needs_effort'))
);
--> statement-breakpoint
ALTER TABLE "academic"."learning_objective" ADD CONSTRAINT "learning_objective_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."learning_objective" ADD CONSTRAINT "learning_objective_grade_fk" FOREIGN KEY ("organization_id","grade_level_id") REFERENCES "tenancy"."grade_level"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."learning_objective" ADD CONSTRAINT "learning_objective_subject_fk" FOREIGN KEY ("organization_id","subject_id") REFERENCES "tenancy"."subject"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."objective_rating" ADD CONSTRAINT "objective_rating_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."objective_rating" ADD CONSTRAINT "objective_rating_year_fk" FOREIGN KEY ("organization_id","academic_year_id") REFERENCES "tenancy"."academic_year"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."objective_rating" ADD CONSTRAINT "objective_rating_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."objective_rating" ADD CONSTRAINT "objective_rating_objective_fk" FOREIGN KEY ("organization_id","learning_objective_id") REFERENCES "academic"."learning_objective"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."objective_rating" ADD CONSTRAINT "objective_rating_rated_by_fk" FOREIGN KEY ("organization_id","rated_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_objective_org_subject_idx" ON "academic"."learning_objective" USING btree ("organization_id","subject_id");--> statement-breakpoint
CREATE INDEX "objective_rating_org_objective_idx" ON "academic"."objective_rating" USING btree ("organization_id","learning_objective_id");--> statement-breakpoint
CREATE INDEX "objective_rating_org_student_idx" ON "academic"."objective_rating" USING btree ("organization_id","student_profile_id");
--> statement-breakpoint
-- «کارنامهٴ توصیفی» (docs/report-card.md; docs/decisions.md «کارنامهٴ توصیفی»):
-- 1) academic.learning_objective — the primary-school learning objectives of ONE organisation: پایه (composite FK to
--    its grade_level) × Jalali month (1..12) × canonical درس name (+ the organisation's subject row when one matches,
--    nullable) × position. Natural key = the position (organization, grade, month, subject_name, sort_order): the
--    catalog seed (scripts/objectives-catalog.ts, every deploy) upserts on it, so a corrected wording updates the
--    row in place and keeps its ratings; a line the documents drop is archived, never deleted. Seed-managed: the
--    runtime role may only READ it (apply_grants below), exactly like the global catalogs.
-- 2) academic.objective_rating — one student × one objective × one academic year, four levels by CHECK; UNIQUE so a
--    save is an upsert; clearing = DELETE (audited with the change list).
-- Additive only, no backfill: the catalog seed installs the objectives, the teachers write the ratings.
--> statement-breakpoint
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
  -- The tenant-scoped catalog of primary learning objectives (migration 0017): written by the catalog seed only.
  IF to_regclass('academic.learning_objective') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON academic.learning_objective FROM app_rw';
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
