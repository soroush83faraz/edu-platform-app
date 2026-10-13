CREATE SCHEMA "counseling";
--> statement-breakpoint
CREATE TABLE "counseling"."counselor_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"kind" text DEFAULT 'general' NOT NULL,
	"visibility" text DEFAULT 'counselors_and_principal' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counselor_note_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "counselor_note_kind_chk" CHECK ("counseling"."counselor_note"."kind" IN ('general', 'academic', 'behavioral', 'family')),
	CONSTRAINT "counselor_note_visibility_chk" CHECK ("counseling"."counselor_note"."visibility" IN ('counselors', 'counselors_and_principal')),
	CONSTRAINT "counselor_note_body_chk" CHECK (char_length("counseling"."counselor_note"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "counselor_note_status_chk" CHECK ("counseling"."counselor_note"."status" IN ('active', 'archived')),
	CONSTRAINT "counselor_note_archived_chk" CHECK (("counseling"."counselor_note"."status" = 'archived') = ("counseling"."counselor_note"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "counseling"."referral" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "referral_work_item_uq" UNIQUE("organization_id","work_item_id"),
	CONSTRAINT "referral_kind_chk" CHECK ("counseling"."referral"."kind" IN ('management', 'teacher'))
);
--> statement-breakpoint
CREATE TABLE "counseling"."teacher_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"class_offering_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_report_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "teacher_report_kind_chk" CHECK ("counseling"."teacher_report"."kind" IN ('academic', 'behavioral')),
	CONSTRAINT "teacher_report_body_chk" CHECK (char_length("counseling"."teacher_report"."body") BETWEEN 1 AND 1000),
	CONSTRAINT "teacher_report_status_chk" CHECK ("counseling"."teacher_report"."status" IN ('active', 'archived')),
	CONSTRAINT "teacher_report_archived_chk" CHECK (("counseling"."teacher_report"."status" = 'archived') = ("counseling"."teacher_report"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD COLUMN "is_confidential" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "counseling"."counselor_note" ADD CONSTRAINT "counselor_note_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."counselor_note" ADD CONSTRAINT "counselor_note_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."counselor_note" ADD CONSTRAINT "counselor_note_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."counselor_note" ADD CONSTRAINT "counselor_note_author_fk" FOREIGN KEY ("organization_id","author_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."referral" ADD CONSTRAINT "referral_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."referral" ADD CONSTRAINT "referral_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."referral" ADD CONSTRAINT "referral_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."referral" ADD CONSTRAINT "referral_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."referral" ADD CONSTRAINT "referral_created_by_fk" FOREIGN KEY ("organization_id","created_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."teacher_report" ADD CONSTRAINT "teacher_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."teacher_report" ADD CONSTRAINT "teacher_report_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."teacher_report" ADD CONSTRAINT "teacher_report_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."teacher_report" ADD CONSTRAINT "teacher_report_author_fk" FOREIGN KEY ("organization_id","author_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling"."teacher_report" ADD CONSTRAINT "teacher_report_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counselor_note_org_student_idx" ON "counseling"."counselor_note" USING btree ("organization_id","student_profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "counselor_note_org_author_idx" ON "counseling"."counselor_note" USING btree ("organization_id","author_person_id");--> statement-breakpoint
CREATE INDEX "referral_org_student_idx" ON "counseling"."referral" USING btree ("organization_id","student_profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "teacher_report_org_student_idx" ON "counseling"."teacher_report" USING btree ("organization_id","student_profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "teacher_report_org_author_idx" ON "counseling"."teacher_report" USING btree ("organization_id","author_person_id");
--> statement-breakpoint
-- «مشاوره» — phase 1 (docs/decisions.md «مشاوره — فاز ۱»; docs/db.md «counseling»):
-- 1) a NEW tenant schema `counseling` (counselor_note, teacher_report, referral). The three app.apply_* functions
--    below are the latest definitions (apply_grants from 0017, apply_rls from 0004, apply_updated_at_triggers from
--    0009) with 'counseling' added to their schema lists — nothing else in them changed — so the new tables get
--    the grants, `tenant_isolation` (ENABLE + FORCE) and the updated_at trigger like every other tenant table.
-- 2) workspace.work_item.is_confidential (boolean, DEFAULT false — additive): a participants-only item (the
--    counselor's referrals); the managers' broad read does not reach it (src/modules/workspace/service.ts).
-- 3) defense in depth for the most sensitive rows: RESTRICTIVE policies for app_rw (ANDed with tenant_isolation)
--    that mirror the service's rules — who may read a note (its school's counselors; its school's management only
--    when its visibility allows), that a note / report is written and edited only by its author, that a referral is
--    read by its school's case readers or the people it was addressed to. The person is `app.current_person_id()`
--    (bound by withTenant from the session); unset → NULL → nothing passes (fail closed). They apply to app_rw only:
--    seeds and the pilot reset run as app_owner, pg_dump as app_backup. apply_rls() never drops them (it only
--    manages its own six policy names).
-- 4) app_rw may not DELETE counseling rows (soft removal via status/archived_at), nor UPDATE a referral (an
--    immutable link) — REVOKE inside app.apply_grants(), reapplied after every migration like the audit_log rule.
-- Additive only, no backfill.
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
      AND c.table_schema IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling')
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
      AND c.table_schema IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling')
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
-- Does the CURRENT person (app.current_person_id(), bound by withTenant) hold `p_permission` through a valid
-- assignment whose scope covers school `p_school_id` — the organization, that school, or a branch of it? The same
-- rule as the service's reach (`getPermissionScope`: a branch counts as its school; class / student scopes never
-- reach a school). SECURITY INVOKER: it reads iam.role_assignment under the caller's own RLS (the current tenant
-- only); role_permission is the global seed catalog. Unbound person → NULL → false.
CREATE OR REPLACE FUNCTION app.counseling_holds(p_permission text, p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM iam.role_assignment ra
    JOIN iam.role_permission rp ON rp.role_id = ra.role_id AND rp.permission_code = p_permission
    WHERE ra.person_id = app.current_person_id()
      AND ra.revoked_at IS NULL
      AND (ra.valid_from IS NULL OR ra.valid_from <= current_date)
      AND (ra.valid_to IS NULL OR ra.valid_to >= current_date)
      AND (
        ra.scope_type = 'organization'
        OR (ra.scope_type = 'school' AND ra.school_id = p_school_id)
        OR (ra.scope_type = 'branch' AND EXISTS (
              SELECT 1 FROM tenancy.branch b WHERE b.id = ra.branch_id AND b.school_id = p_school_id))
      )
  )
$fn$;
--> statement-breakpoint
-- Is the CURRENT person one of the people work item `p_work_item_id` was given to (an assignee row)? The teachers a
-- «درخواست گزارش» went to read its referral row (which student it is about) and nothing else of the file.
CREATE OR REPLACE FUNCTION app.counseling_addressee(p_work_item_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM workspace.work_item_assignee a
    WHERE a.work_item_id = p_work_item_id AND a.person_id = app.current_person_id()
  )
$fn$;
--> statement-breakpoint
-- counselor_note: readable by the counselors of its school (holders of counseling.note.write there), and by the
-- school's other case readers (management) only when its visibility is `counselors_and_principal`; inserted and
-- edited by its author alone, who must still be a counselor of that school.
CREATE POLICY counseling_read ON counseling.counselor_note AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    app.counseling_holds('counseling.note.write', school_id)
    OR (visibility = 'counselors_and_principal' AND app.counseling_holds('counseling.case.read', school_id))
  );
--> statement-breakpoint
CREATE POLICY counseling_insert ON counseling.counselor_note AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (author_person_id = app.current_person_id() AND app.counseling_holds('counseling.note.write', school_id));
--> statement-breakpoint
CREATE POLICY counseling_update ON counseling.counselor_note AS RESTRICTIVE FOR UPDATE TO app_rw
  USING (author_person_id = app.current_person_id())
  WITH CHECK (author_person_id = app.current_person_id() AND app.counseling_holds('counseling.note.write', school_id));
--> statement-breakpoint
-- teacher_report: readable by its author and by the case readers of its school; written and edited by its author
-- only (whether the author teaches the student is the service's check).
CREATE POLICY counseling_read ON counseling.teacher_report AS RESTRICTIVE FOR SELECT TO app_rw
  USING (author_person_id = app.current_person_id() OR app.counseling_holds('counseling.case.read', school_id));
--> statement-breakpoint
CREATE POLICY counseling_insert ON counseling.teacher_report AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (author_person_id = app.current_person_id());
--> statement-breakpoint
CREATE POLICY counseling_update ON counseling.teacher_report AS RESTRICTIVE FOR UPDATE TO app_rw
  USING (author_person_id = app.current_person_id())
  WITH CHECK (author_person_id = app.current_person_id());
--> statement-breakpoint
-- referral: readable by the case readers of its school and by the people its work item was given to; created only
-- by a holder of counseling.referral.create at that school, in their own name.
CREATE POLICY counseling_read ON counseling.referral AS RESTRICTIVE FOR SELECT TO app_rw
  USING (app.counseling_holds('counseling.case.read', school_id) OR app.counseling_addressee(work_item_id));
--> statement-breakpoint
CREATE POLICY counseling_insert ON counseling.referral AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (created_by_person_id = app.current_person_id() AND app.counseling_holds('counseling.referral.create', school_id));
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
