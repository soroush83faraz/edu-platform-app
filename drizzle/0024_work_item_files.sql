CREATE TABLE "workspace"."work_item_submission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"student_person_id" uuid NOT NULL,
	"body" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_submission_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "work_item_submission_org_id_item_uq" UNIQUE("organization_id","id","work_item_id"),
	CONSTRAINT "work_item_submission_student_uq" UNIQUE("organization_id","work_item_id","student_person_id"),
	CONSTRAINT "work_item_submission_body_chk" CHECK ("workspace"."work_item_submission"."body" IS NULL OR char_length("workspace"."work_item_submission"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD COLUMN "target_work_item_id" uuid;--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_submission" ADD CONSTRAINT "work_item_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_submission" ADD CONSTRAINT "work_item_submission_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_submission" ADD CONSTRAINT "work_item_submission_student_fk" FOREIGN KEY ("organization_id","student_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD CONSTRAINT "work_item_attachment_submission_fk" FOREIGN KEY ("organization_id","submission_id","work_item_id") REFERENCES "workspace"."work_item_submission"("organization_id","id","work_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_object_uploader_created_idx" ON "files"."file_object" USING btree ("organization_id","uploaded_by_person_id","created_at");--> statement-breakpoint
CREATE INDEX "file_object_pending_idx" ON "files"."file_object" USING btree ("organization_id","created_at") WHERE "files"."file_object"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "work_item_attachment_submission_idx" ON "workspace"."work_item_attachment" USING btree ("organization_id","submission_id") WHERE "workspace"."work_item_attachment"."submission_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD CONSTRAINT "work_item_attachment_file_uq" UNIQUE("organization_id","file_id");--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_size_positive_chk" CHECK ("files"."file_object"."size_bytes" > 0);--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_status_chk" CHECK ("files"."file_object"."status" IN ('pending', 'attached', 'archived'));--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_archived_chk" CHECK (("files"."file_object"."status" = 'archived') = ("files"."file_object"."archived_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_purpose_chk" CHECK ("files"."file_object"."purpose" IS NULL OR "files"."file_object"."purpose" IN ('work_item', 'submission'));--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_submission_target_chk" CHECK ("files"."file_object"."purpose" IS DISTINCT FROM 'submission' OR "files"."file_object"."target_work_item_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_storage_key_chk" CHECK ("files"."file_object"."storage_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND split_part("files"."file_object"."storage_key", '/', 1) = "files"."file_object"."organization_id"::text AND split_part("files"."file_object"."storage_key", '/', 3) = "files"."file_object"."id"::text);--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_sha256_chk" CHECK ("files"."file_object"."sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_name_chk" CHECK ("files"."file_object"."original_name" IS NULL OR char_length("files"."file_object"."original_name") BETWEEN 1 AND 200);
--> statement-breakpoint
-- «پیوست تکلیف و تحویل پاسخ» (owner, 2026-10-19; docs/decisions.md; docs/db.md files.file_object,
-- workspace.work_item_attachment, workspace.work_item_submission). Additive only, no backfill: no file row exists yet
-- (the upload UI had been cut from phase 1 until now).
-- 1) files.file_object: status (pending -> attached -> archived) + archived_at, purpose + target_work_item_id (what a
--    pending upload was made for), and CHECKs pinning storage_key to `<organization_id>/<yyyy>/<id>` of THIS row (no row
--    can point at another tenant's bytes or outside the files root), a hex SHA-256, a positive size, a bounded display
--    name; indexes for the per-person daily quota and the expiry of pending uploads. The composite FK of
--    target_work_item_id -> workspace.work_item is declared HERE only (first statement below), like
--    class_group_homeroom_staff_fk (0011): in Drizzle it would close an import cycle between the schema files.
-- 2) workspace.work_item_submission: one student's «پاسخ» to one تکلیف (text <= 4000, files via attachments), unique per
--    (organization, تکلیف, student); updated_at gets its trigger from apply_updated_at_triggers().
-- 3) workspace.work_item_attachment: submission_id (composite FK to the submission AND its تکلیف) + archived_at; a file
--    is attached once (UNIQUE (organization_id, file_id)).
-- 4) defense in depth, like counseling (0018) and guardian_message (0022): RESTRICTIVE policies for app_rw, ANDed with
--    tenant_isolation (seeds and the pilot reset run as app_owner, pg_dump as app_backup):
--      submission: readable by its student and by the تکلیف's managers, app.work_item_manager() = the item's creator or
--        a holder of workspace.work_item.update through an organization / school / branch assignment (the broad hat of
--        `managesItem`, src/modules/workspace/manage-policy.ts); inserted and updated by its student only;
--      attachment: a پاسخ's file row is readable only where the پاسخ is (the subquery runs under the submission's own
--        policies) and inserted / updated only by that پاسخ's student; the giver's files (submission_id NULL) follow the
--        تکلیف, whose visibility is the service's (`canViewWorkItem`).
--    The person is app.current_person_id() (bound by withTenant from the session); unset -> NULL -> nothing passes.
--    apply_rls() never drops these (it manages its own six policy names).
-- 5) app.apply_grants(): 0022's definition (0023 changed nothing in it) + REVOKE DELETE on the three tables: files,
--    attachments and submissions are withdrawn by status / archived_at, never deleted (the bytes of an archived file
--    are removed from disk by the application).
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_target_work_item_fk" FOREIGN KEY ("organization_id","target_work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Does the CURRENT person manage work item p_work_item_id: its creator, or a holder of workspace.work_item.update through
-- a valid organization / school / branch assignment? SECURITY INVOKER: it reads under the caller's own RLS (the current
-- tenant only); role_permission is the global seed catalog. Unbound person -> NULL -> false.
CREATE OR REPLACE FUNCTION app.work_item_manager(p_work_item_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM workspace.work_item wi
           WHERE wi.id = p_work_item_id AND wi.created_by_person_id = app.current_person_id())
      OR EXISTS (
           SELECT 1
           FROM iam.role_assignment ra
           JOIN iam.role_permission rp ON rp.role_id = ra.role_id AND rp.permission_code = 'workspace.work_item.update'
           WHERE ra.person_id = app.current_person_id()
             AND ra.revoked_at IS NULL
             AND (ra.valid_from IS NULL OR ra.valid_from <= current_date)
             AND (ra.valid_to IS NULL OR ra.valid_to >= current_date)
             AND ra.scope_type IN ('organization', 'school', 'branch'))
$fn$;
--> statement-breakpoint
CREATE POLICY submission_read ON workspace.work_item_submission AS RESTRICTIVE FOR SELECT TO app_rw
  USING (student_person_id = app.current_person_id() OR app.work_item_manager(work_item_id));
--> statement-breakpoint
CREATE POLICY submission_insert ON workspace.work_item_submission AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (student_person_id = app.current_person_id());
--> statement-breakpoint
CREATE POLICY submission_update ON workspace.work_item_submission AS RESTRICTIVE FOR UPDATE TO app_rw
  USING (student_person_id = app.current_person_id())
  WITH CHECK (student_person_id = app.current_person_id());
--> statement-breakpoint
CREATE POLICY attachment_read ON workspace.work_item_attachment AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    work_item_attachment.submission_id IS NULL
    OR EXISTS (SELECT 1 FROM workspace.work_item_submission s WHERE s.id = work_item_attachment.submission_id)
  );
--> statement-breakpoint
CREATE POLICY attachment_insert ON workspace.work_item_attachment AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (
    added_by_person_id = app.current_person_id()
    AND (
      work_item_attachment.submission_id IS NULL
      OR EXISTS (SELECT 1 FROM workspace.work_item_submission s
                 WHERE s.id = work_item_attachment.submission_id AND s.student_person_id = app.current_person_id())
    )
  );
--> statement-breakpoint
CREATE POLICY attachment_update ON workspace.work_item_attachment AS RESTRICTIVE FOR UPDATE TO app_rw
  USING (
    work_item_attachment.submission_id IS NULL
    OR EXISTS (SELECT 1 FROM workspace.work_item_submission s
               WHERE s.id = work_item_attachment.submission_id AND s.student_person_id = app.current_person_id())
  )
  WITH CHECK (
    work_item_attachment.submission_id IS NULL
    OR EXISTS (SELECT 1 FROM workspace.work_item_submission s
               WHERE s.id = work_item_attachment.submission_id AND s.student_person_id = app.current_person_id())
  );
--> statement-breakpoint
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
