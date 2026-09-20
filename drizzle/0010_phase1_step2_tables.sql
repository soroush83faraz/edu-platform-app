CREATE SCHEMA "files";
--> statement-breakpoint
CREATE SCHEMA "academic";
--> statement-breakpoint
CREATE SCHEMA "workspace";
--> statement-breakpoint
CREATE SCHEMA "notif";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "config";
--> statement-breakpoint
CREATE SCHEMA "integ";
--> statement-breakpoint
CREATE TABLE "files"."file_object" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text,
	"uploaded_by_person_id" uuid NOT NULL,
	"visibility_hint" text DEFAULT 'private' NOT NULL,
	"scan_status" text DEFAULT 'skipped' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_object_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "file_object_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "file_object_size_chk" CHECK ("files"."file_object"."size_bytes" >= 0),
	CONSTRAINT "file_object_visibility_chk" CHECK ("files"."file_object"."visibility_hint" IN ('private', 'org', 'public')),
	CONSTRAINT "file_object_scan_status_chk" CHECK ("files"."file_object"."scan_status" IN ('skipped', 'pending', 'clean', 'infected'))
);
--> statement-breakpoint
CREATE TABLE "academic"."class_enrollment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_enrollment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_on" date DEFAULT current_date NOT NULL,
	"ends_on" date,
	"change_reason" text,
	"previous_enrollment_id" uuid,
	"changed_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_enrollment_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "class_enrollment_status_chk" CHECK ("academic"."class_enrollment"."status" IN ('active', 'ended', 'transferred')),
	CONSTRAINT "class_enrollment_change_reason_chk" CHECK ("academic"."class_enrollment"."change_reason" IN ('transfer', 'level_change', 'admin')),
	CONSTRAINT "class_enrollment_dates_chk" CHECK ("academic"."class_enrollment"."ends_on" IS NULL OR "academic"."class_enrollment"."starts_on" <= "academic"."class_enrollment"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "academic"."school_enrollment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_on" date DEFAULT current_date NOT NULL,
	"ends_on" date,
	"exit_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_enrollment_student_year_uq" UNIQUE("organization_id","student_profile_id","academic_year_id"),
	CONSTRAINT "school_enrollment_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "school_enrollment_status_chk" CHECK ("academic"."school_enrollment"."status" IN ('registered', 'active', 'transferred_out', 'withdrawn', 'graduated')),
	CONSTRAINT "school_enrollment_dates_chk" CHECK ("academic"."school_enrollment"."ends_on" IS NULL OR "academic"."school_enrollment"."starts_on" <= "academic"."school_enrollment"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "academic"."teacher_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"class_offering_id" uuid NOT NULL,
	"role" text DEFAULT 'main' NOT NULL,
	"valid_from" date DEFAULT current_date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_assignment_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "teacher_assignment_role_chk" CHECK ("academic"."teacher_assignment"."role" IN ('main', 'assistant', 'substitute')),
	CONSTRAINT "teacher_assignment_valid_range_chk" CHECK ("academic"."teacher_assignment"."valid_to" IS NULL OR "academic"."teacher_assignment"."valid_from" <= "academic"."teacher_assignment"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "workspace"."inbox_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"state" text DEFAULT 'unread' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_entry_person_item_uq" UNIQUE("person_id","work_item_id"),
	CONSTRAINT "inbox_entry_relation_chk" CHECK ("workspace"."inbox_entry"."relation" IN ('assignee', 'watcher', 'approver', 'creator', 'mentioned')),
	CONSTRAINT "inbox_entry_state_chk" CHECK ("workspace"."inbox_entry"."state" IN ('unread', 'read', 'snoozed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"starts_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_by_person_id" uuid NOT NULL,
	"parent_work_item_id" uuid,
	"recurrence_rule_id" uuid,
	"recurrence_source_id" uuid,
	"visibility" text DEFAULT 'assignees' NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "work_item_title_chk" CHECK (char_length("workspace"."work_item"."title") BETWEEN 1 AND 200),
	CONSTRAINT "work_item_priority_chk" CHECK ("workspace"."work_item"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "work_item_visibility_chk" CHECK ("workspace"."work_item"."visibility" IN ('assignees', 'watchers', 'scope'))
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_assignee" (
	"work_item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text DEFAULT 'assignee' NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "work_item_assignee_pk" PRIMARY KEY("work_item_id","person_id","role"),
	CONSTRAINT "work_item_assignee_role_chk" CHECK ("workspace"."work_item_assignee"."role" IN ('owner', 'assignee', 'approver')),
	CONSTRAINT "work_item_assignee_state_chk" CHECK ("workspace"."work_item_assignee"."state" IN ('pending', 'accepted', 'done'))
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"added_by_person_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_item_comment_body_chk" CHECK (char_length("workspace"."work_item_comment"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "work_item_comment_visibility_chk" CHECK ("workspace"."work_item_comment"."visibility" IN ('all', 'staff_only'))
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_type_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"sequence" integer NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	CONSTRAINT "work_item_status_type_code_uq" UNIQUE("work_item_type_id","code"),
	CONSTRAINT "work_item_status_category_chk" CHECK ("workspace"."work_item_status"."category" IN ('todo', 'doing', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_transition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"from_status_id" uuid,
	"to_status_id" uuid NOT NULL,
	"by_person_id" uuid NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"extension_table" text,
	"allow_recurrence" boolean DEFAULT false NOT NULL,
	"requires_assignee" boolean DEFAULT true NOT NULL,
	"default_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_type_org_code_uq" UNIQUE NULLS NOT DISTINCT("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "workspace"."work_item_watcher" (
	"work_item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"reason" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "work_item_watcher_pk" PRIMARY KEY("work_item_id","person_id"),
	CONSTRAINT "work_item_watcher_reason_chk" CHECK ("workspace"."work_item_watcher"."reason" IN ('guardian', 'supervisor', 'manual', 'creator'))
);
--> statement-breakpoint
CREATE TABLE "notif"."notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_kind" text,
	"source_id" uuid,
	"deep_link" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notif"."notification_type" (
	"code" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"default_channels" text DEFAULT 'inapp' NOT NULL,
	"user_can_disable" boolean DEFAULT true NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	CONSTRAINT "notification_type_urgency_chk" CHECK ("notif"."notification_type"."urgency" IN ('low', 'normal', 'high'))
);
--> statement-breakpoint
CREATE TABLE "notif"."push_subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_account_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_subscription_endpoint_uq" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_person_id" uuid,
	"actor_user_id" uuid,
	"request_id" text,
	"action" text NOT NULL,
	"entity_schema" text NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config"."feature_flag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "config"."setting_value" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_value_org_school_key_uq" UNIQUE NULLS NOT DISTINCT("organization_id","school_id","key")
);
--> statement-breakpoint
CREATE TABLE "integ"."external_identity_map" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_identity_map_ref_uq" UNIQUE("organization_id","source","entity_table","external_ref"),
	CONSTRAINT "external_identity_map_source_chk" CHECK ("integ"."external_identity_map"."source" IN ('excel', 'legacy_system'))
);
--> statement-breakpoint
CREATE TABLE "integ"."import_batch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid,
	"kind" text NOT NULL,
	"file_id" uuid,
	"file_sha256" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"ok_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_batch_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "import_batch_kind_chk" CHECK ("integ"."import_batch"."kind" IN ('students', 'staff', 'classes', 'full')),
	CONSTRAINT "import_batch_status_chk" CHECK ("integ"."import_batch"."status" IN ('draft', 'validated', 'committed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "integ"."import_row" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"sheet" text NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entity_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "import_row_batch_sheet_row_uq" UNIQUE("batch_id","sheet","row_number"),
	CONSTRAINT "import_row_status_chk" CHECK ("integ"."import_row"."status" IN ('pending', 'ok', 'warning', 'error', 'committed'))
);
--> statement-breakpoint
ALTER TABLE "iam"."login_attempt" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "iam"."login_attempt" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files"."file_object" ADD CONSTRAINT "file_object_uploaded_by_fk" FOREIGN KEY ("organization_id","uploaded_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_enrollment" ADD CONSTRAINT "class_enrollment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_enrollment" ADD CONSTRAINT "class_enrollment_school_enrollment_fk" FOREIGN KEY ("organization_id","school_enrollment_id") REFERENCES "academic"."school_enrollment"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_enrollment" ADD CONSTRAINT "class_enrollment_class_group_fk" FOREIGN KEY ("organization_id","class_group_id") REFERENCES "tenancy"."class_group"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_enrollment" ADD CONSTRAINT "class_enrollment_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_enrollment" ADD CONSTRAINT "class_enrollment_previous_fk" FOREIGN KEY ("organization_id","previous_enrollment_id") REFERENCES "academic"."class_enrollment"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."class_enrollment" ADD CONSTRAINT "class_enrollment_changed_by_fk" FOREIGN KEY ("organization_id","changed_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."school_enrollment" ADD CONSTRAINT "school_enrollment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."school_enrollment" ADD CONSTRAINT "school_enrollment_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."school_enrollment" ADD CONSTRAINT "school_enrollment_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."school_enrollment" ADD CONSTRAINT "school_enrollment_year_fk" FOREIGN KEY ("organization_id","academic_year_id") REFERENCES "tenancy"."academic_year"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."school_enrollment" ADD CONSTRAINT "school_enrollment_grade_fk" FOREIGN KEY ("organization_id","grade_level_id") REFERENCES "tenancy"."grade_level"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignment" ADD CONSTRAINT "teacher_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignment" ADD CONSTRAINT "teacher_assignment_staff_fk" FOREIGN KEY ("organization_id","staff_profile_id") REFERENCES "iam"."staff_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."teacher_assignment" ADD CONSTRAINT "teacher_assignment_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."inbox_entry" ADD CONSTRAINT "inbox_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."inbox_entry" ADD CONSTRAINT "inbox_entry_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."inbox_entry" ADD CONSTRAINT "inbox_entry_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "workspace"."work_item_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_status_id_work_item_status_id_fk" FOREIGN KEY ("status_id") REFERENCES "workspace"."work_item_status"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_created_by_fk" FOREIGN KEY ("organization_id","created_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_parent_fk" FOREIGN KEY ("organization_id","parent_work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_assignee" ADD CONSTRAINT "work_item_assignee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_assignee" ADD CONSTRAINT "work_item_assignee_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_assignee" ADD CONSTRAINT "work_item_assignee_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD CONSTRAINT "work_item_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD CONSTRAINT "work_item_attachment_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD CONSTRAINT "work_item_attachment_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "files"."file_object"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_attachment" ADD CONSTRAINT "work_item_attachment_added_by_fk" FOREIGN KEY ("organization_id","added_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_comment" ADD CONSTRAINT "work_item_comment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_comment" ADD CONSTRAINT "work_item_comment_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_comment" ADD CONSTRAINT "work_item_comment_author_fk" FOREIGN KEY ("organization_id","author_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_status" ADD CONSTRAINT "work_item_status_work_item_type_id_work_item_type_id_fk" FOREIGN KEY ("work_item_type_id") REFERENCES "workspace"."work_item_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_transition" ADD CONSTRAINT "work_item_transition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_transition" ADD CONSTRAINT "work_item_transition_from_status_id_work_item_status_id_fk" FOREIGN KEY ("from_status_id") REFERENCES "workspace"."work_item_status"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_transition" ADD CONSTRAINT "work_item_transition_to_status_id_work_item_status_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "workspace"."work_item_status"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_transition" ADD CONSTRAINT "work_item_transition_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_transition" ADD CONSTRAINT "work_item_transition_by_fk" FOREIGN KEY ("organization_id","by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_type" ADD CONSTRAINT "work_item_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_watcher" ADD CONSTRAINT "work_item_watcher_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_watcher" ADD CONSTRAINT "work_item_watcher_work_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "workspace"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace"."work_item_watcher" ADD CONSTRAINT "work_item_watcher_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif"."notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif"."notification" ADD CONSTRAINT "notification_type_code_notification_type_code_fk" FOREIGN KEY ("type_code") REFERENCES "notif"."notification_type"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif"."notification" ADD CONSTRAINT "notification_recipient_fk" FOREIGN KEY ("organization_id","recipient_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif"."push_subscription" ADD CONSTRAINT "push_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif"."push_subscription" ADD CONSTRAINT "push_subscription_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config"."feature_flag" ADD CONSTRAINT "feature_flag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config"."setting_value" ADD CONSTRAINT "setting_value_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config"."setting_value" ADD CONSTRAINT "setting_value_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."external_identity_map" ADD CONSTRAINT "external_identity_map_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."import_batch" ADD CONSTRAINT "import_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."import_batch" ADD CONSTRAINT "import_batch_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."import_batch" ADD CONSTRAINT "import_batch_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "files"."file_object"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."import_batch" ADD CONSTRAINT "import_batch_created_by_fk" FOREIGN KEY ("organization_id","created_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."import_row" ADD CONSTRAINT "import_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integ"."import_row" ADD CONSTRAINT "import_row_batch_fk" FOREIGN KEY ("organization_id","batch_id") REFERENCES "integ"."import_batch"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_enrollment_org_class_active_idx" ON "academic"."class_enrollment" USING btree ("organization_id","class_group_id") WHERE "academic"."class_enrollment"."status" = 'active';--> statement-breakpoint
CREATE INDEX "class_enrollment_org_student_idx" ON "academic"."class_enrollment" USING btree ("organization_id","student_profile_id");--> statement-breakpoint
CREATE INDEX "class_enrollment_org_school_enrollment_idx" ON "academic"."class_enrollment" USING btree ("organization_id","school_enrollment_id");--> statement-breakpoint
CREATE INDEX "school_enrollment_org_school_year_idx" ON "academic"."school_enrollment" USING btree ("organization_id","school_id","academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_assignment_active_uq" ON "academic"."teacher_assignment" USING btree ("class_offering_id","staff_profile_id","role") WHERE "academic"."teacher_assignment"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "teacher_assignment_org_staff_idx" ON "academic"."teacher_assignment" USING btree ("organization_id","staff_profile_id");--> statement-breakpoint
CREATE INDEX "teacher_assignment_org_offering_idx" ON "academic"."teacher_assignment" USING btree ("organization_id","class_offering_id");--> statement-breakpoint
CREATE INDEX "inbox_entry_org_person_state_idx" ON "workspace"."inbox_entry" USING btree ("organization_id","person_id","state","is_pinned");--> statement-breakpoint
CREATE INDEX "work_item_org_due_open_idx" ON "workspace"."work_item" USING btree ("organization_id","due_at") WHERE "workspace"."work_item"."completed_at" IS NULL AND "workspace"."work_item"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_item_org_creator_idx" ON "workspace"."work_item" USING btree ("organization_id","created_by_person_id");--> statement-breakpoint
CREATE INDEX "work_item_assignee_org_person_idx" ON "workspace"."work_item_assignee" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "work_item_attachment_item_idx" ON "workspace"."work_item_attachment" USING btree ("work_item_id","sequence");--> statement-breakpoint
CREATE INDEX "work_item_comment_item_created_idx" ON "workspace"."work_item_comment" USING btree ("work_item_id","created_at");--> statement-breakpoint
CREATE INDEX "work_item_transition_item_at_idx" ON "workspace"."work_item_transition" USING btree ("work_item_id","at");--> statement-breakpoint
CREATE INDEX "work_item_watcher_org_person_idx" ON "workspace"."work_item_watcher" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "notification_org_recipient_idx" ON "notif"."notification" USING btree ("organization_id","recipient_person_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_dedupe_uq" ON "notif"."notification" USING btree ("recipient_person_id","dedupe_key") WHERE "notif"."notification"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "push_subscription_org_account_idx" ON "notif"."push_subscription" USING btree ("organization_id","user_account_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit"."audit_log" USING btree ("organization_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_org_entity_idx" ON "audit"."audit_log" USING btree ("organization_id","entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "external_identity_map_org_entity_idx" ON "integ"."external_identity_map" USING btree ("organization_id","entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "import_batch_org_created_idx" ON "integ"."import_batch" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_row_org_batch_status_idx" ON "integ"."import_row" USING btree ("organization_id","batch_id","status");--> statement-breakpoint
ALTER TABLE "iam"."login_attempt" ADD CONSTRAINT "login_attempt_outcome_chk" CHECK ("iam"."login_attempt"."outcome" IN ('success', 'bad_password', 'locked', 'unknown', 'disabled'));