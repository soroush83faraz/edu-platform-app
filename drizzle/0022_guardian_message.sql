CREATE TABLE "workspace"."guardian_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"guardian_person_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"destination_kind" text NOT NULL,
	"class_offering_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_message_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "guardian_message_work_item_uq" UNIQUE("organization_id","work_item_id"),
	CONSTRAINT "guardian_message_kind_chk" CHECK ("workspace"."guardian_message"."kind" IN ('question', 'suggestion', 'criticism')),
	CONSTRAINT "guardian_message_destination_chk" CHECK ("workspace"."guardian_message"."destination_kind" IN ('teacher', 'counselor', 'vice_principal', 'principal')),
	CONSTRAINT "guardian_message_offering_chk" CHECK (("workspace"."guardian_message"."destination_kind" = 'teacher') = ("workspace"."guardian_message"."class_offering_id" IS NOT NULL)),
	CONSTRAINT "guardian_message_criticism_chk" CHECK (NOT ("workspace"."guardian_message"."kind" = 'criticism' AND "workspace"."guardian_message"."destination_kind" = 'teacher'))
);
--> statement-breakpoint
ALTER TABLE "workspace"."guardian_message" ADD CONSTRAINT "guardian_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."guardian_message" ADD CONSTRAINT "guardian_message_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."guardian_message" ADD CONSTRAINT "guardian_message_guardian_fk" FOREIGN KEY ("organization_id","guardian_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."guardian_message" ADD CONSTRAINT "guardian_message_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."guardian_message" ADD CONSTRAINT "guardian_message_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."guardian_message" ADD CONSTRAINT "guardian_message_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_message_org_guardian_idx" ON "workspace"."guardian_message" USING btree ("organization_id","guardian_person_id","student_profile_id","created_at" DESC NULLS LAST);

--> statement-breakpoint
-- «ارتباط ولی و مدرسه» (owner, 2026-10-19; docs/decisions.md; docs/db.md workspace.guardian_message):
-- 1) workspace.guardian_message — the link between a guardian's message about ONE child and the confidential
--    `parent_message` work item that carries it (the text lives on the item; this row holds none): school, guardian,
--    child, kind (سؤال / پیشنهاد / انتقاد), destination (دبیر / مشاور / معاون / مدیر) and, for a teacher, the درس.
--    Composite FKs to school, person, student_profile, work_item and class_offering; one row per work item. The owner's
--    rule is a CHECK as well: a «انتقاد» never goes straight to a teacher. In the existing `workspace` schema, so
--    apply_rls() gives it tenant_isolation (ENABLE + FORCE) unchanged; no updated_at (immutable).
-- 2) app.apply_grants() — the definition of 0020, unchanged but for ONE more REVOKE: app_rw may neither UPDATE nor
--    DELETE a guardian message link (like counseling.referral). Re-applied after every migration.
-- 3) defense in depth, like counseling.referral (0018): RESTRICTIVE policies for app_rw (ANDed with tenant_isolation)
--    — a row is readable by the guardian who sent it and by the people its work item was given to (an assignee row of
--    the current person: `app.counseling_addressee`, 0018), and inserted only in the current person's own name. The
--    person is `app.current_person_id()` (bound by withTenant); unset → NULL → nothing passes (fail closed). Seeds and
--    the pilot reset run as app_owner, pg_dump as app_backup; apply_rls() never drops these (it manages its own six).
-- Additive only, no backfill. The system work item type `parent_message` and the notification type
-- `guardian.message_answered` are catalog rows (scripts/catalog.ts), written by the deploy's `seed` step.
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

  -- «ارتباط ولی و مدرسه» (migration 0022): a guardian's message link is immutable — its status and the answer live
  -- on the work item.
  IF to_regclass('workspace.guardian_message') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON workspace.guardian_message FROM app_rw';
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
CREATE POLICY guardian_message_read ON workspace.guardian_message AS RESTRICTIVE FOR SELECT TO app_rw
  USING (guardian_person_id = app.current_person_id() OR app.counseling_addressee(work_item_id));
--> statement-breakpoint
CREATE POLICY guardian_message_insert ON workspace.guardian_message AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (guardian_person_id = app.current_person_id());
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
