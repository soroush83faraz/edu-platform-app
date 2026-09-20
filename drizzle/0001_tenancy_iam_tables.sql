CREATE SCHEMA "tenancy";
--> statement-breakpoint
CREATE SCHEMA "iam";
--> statement-breakpoint
CREATE TABLE "tenancy"."academic_year" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_year_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "academic_year_dates_chk" CHECK ("tenancy"."academic_year"."starts_on" < "tenancy"."academic_year"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."branch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."class_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"homeroom_staff_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_group_year_branch_name_uq" UNIQUE("academic_year_id","branch_id","name"),
	CONSTRAINT "class_group_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "class_group_status_chk" CHECK ("tenancy"."class_group"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."class_offering" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"weekly_hours" numeric(4, 1),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_offering_group_subject_term_uq" UNIQUE("class_group_id","subject_id","term_id"),
	CONSTRAINT "class_offering_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "class_offering_status_chk" CHECK ("tenancy"."class_offering"."status" IN ('planned', 'active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."education_level" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_level_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "education_level_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."grade_level" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"education_level_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_level_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "grade_level_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'core',
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_uq" UNIQUE("slug"),
	CONSTRAINT "organization_slug_chk" CHECK ("tenancy"."organization"."slug" ~ '^[a-z0-9-]{3,40}$'),
	CONSTRAINT "organization_status_chk" CHECK ("tenancy"."organization"."status" IN ('active', 'suspended', 'trial'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."school" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"gender_policy" text DEFAULT 'mixed',
	"is_default" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'Asia/Tehran',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "school_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "school_gender_policy_chk" CHECK ("tenancy"."school"."gender_policy" IN ('girls', 'boys', 'mixed'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."subject" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"parent_subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "subject_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."term" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_year_sequence_uq" UNIQUE("academic_year_id","sequence"),
	CONSTRAINT "term_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "iam"."auth_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text,
	"secret_hash" text,
	"initial_password_enc" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identity_account_provider_uq" UNIQUE("user_account_id","provider"),
	CONSTRAINT "auth_identity_provider_chk" CHECK ("iam"."auth_identity"."provider" IN ('password', 'sms_otp'))
);
--> statement-breakpoint
CREATE TABLE "iam"."contact_point" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_point_kind_chk" CHECK ("iam"."contact_point"."kind" IN ('mobile', 'landline', 'email', 'address'))
);
--> statement-breakpoint
CREATE TABLE "iam"."login_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"ip" "inet",
	"succeeded" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."organization_membership" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_account_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default_org" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now(),
	"left_at" timestamp with time zone,
	CONSTRAINT "organization_membership_person_uq" UNIQUE("person_id"),
	CONSTRAINT "organization_membership_org_account_uq" UNIQUE("organization_id","user_account_id"),
	CONSTRAINT "organization_membership_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "organization_membership_status_chk" CHECK ("iam"."organization_membership"."status" IN ('invited', 'active', 'suspended', 'left'))
);
--> statement-breakpoint
CREATE TABLE "iam"."permission" (
	"code" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"min_scope_type" text
);
--> statement-breakpoint
CREATE TABLE "iam"."person" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"gender" text,
	"external_ref" text,
	"search_text" text GENERATED ALWAYS AS (app.fa_norm(first_name || ' ' || last_name)) STORED,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "person_gender_chk" CHECK ("iam"."person"."gender" IN ('female', 'male')),
	CONSTRAINT "person_status_chk" CHECK ("iam"."person"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "iam"."role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"allowed_scope_types" text[] NOT NULL,
	"cloned_from_role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_org_code_uq" UNIQUE NULLS NOT DISTINCT("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "iam"."role_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"school_id" uuid,
	"branch_id" uuid,
	"class_group_id" uuid,
	"class_offering_id" uuid,
	"student_profile_id" uuid,
	"family_id" uuid,
	"scope_id" uuid GENERATED ALWAYS AS (coalesce(school_id, branch_id, class_group_id, class_offering_id, student_profile_id, family_id, organization_id)) STORED,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"granted_by_person_id" uuid,
	"valid_from" date DEFAULT current_date,
	"valid_to" date,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignment_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "role_assignment_scope_type_chk" CHECK ("iam"."role_assignment"."scope_type" IN ('organization', 'school', 'branch', 'class_group', 'class_offering', 'student', 'family')),
	CONSTRAINT "role_assignment_source_type_chk" CHECK ("iam"."role_assignment"."source_type" IN ('manual', 'guardian_relationship', 'teacher_assignment', 'counselor_assignment', 'enrollment')),
	CONSTRAINT "role_assignment_scope_arc_chk" CHECK ((scope_type = 'organization' AND num_nonnulls(school_id, branch_id, class_group_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'school' AND school_id IS NOT NULL AND num_nonnulls(branch_id, class_group_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'branch' AND branch_id IS NOT NULL AND num_nonnulls(school_id, class_group_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'class_group' AND class_group_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_offering_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'class_offering' AND class_offering_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_group_id, student_profile_id, family_id) = 0)
       OR (scope_type = 'student' AND student_profile_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_group_id, class_offering_id, family_id) = 0)
       OR (scope_type = 'family' AND family_id IS NOT NULL AND num_nonnulls(school_id, branch_id, class_group_id, class_offering_id, student_profile_id) = 0))
);
--> statement-breakpoint
CREATE TABLE "iam"."role_permission" (
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permission_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "iam"."staff_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"employee_number" text,
	"employment_type" text DEFAULT 'full_time',
	"hired_on" date,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profile_person_uq" UNIQUE("person_id"),
	CONSTRAINT "staff_profile_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "staff_profile_employment_type_chk" CHECK ("iam"."staff_profile"."employment_type" IN ('full_time', 'part_time', 'contractor'))
);
--> statement-breakpoint
CREATE TABLE "iam"."student_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"student_number" text NOT NULL,
	"admitted_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profile_person_uq" UNIQUE("person_id"),
	CONSTRAINT "student_profile_org_number_uq" UNIQUE("organization_id","student_number"),
	CONSTRAINT "student_profile_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "student_profile_status_chk" CHECK ("iam"."student_profile"."status" IN ('prospective', 'active', 'graduated', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "iam"."user_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"login_identifier" text NOT NULL,
	"phone_e164" text,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_account_login_identifier_uq" UNIQUE("login_identifier"),
	CONSTRAINT "user_account_phone_chk" CHECK ("iam"."user_account"."phone_e164" ~ '^\+98[0-9]{10}$'),
	CONSTRAINT "user_account_status_chk" CHECK ("iam"."user_account"."status" IN ('active', 'locked', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "iam"."user_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"current_org_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"device_label" text,
	"is_public_device" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_session_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."academic_year" ADD CONSTRAINT "academic_year_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."academic_year" ADD CONSTRAINT "academic_year_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."branch" ADD CONSTRAINT "branch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."branch" ADD CONSTRAINT "branch_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_group" ADD CONSTRAINT "class_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_group" ADD CONSTRAINT "class_group_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "tenancy"."branch"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_group" ADD CONSTRAINT "class_group_academic_year_fk" FOREIGN KEY ("organization_id","academic_year_id") REFERENCES "tenancy"."academic_year"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_group" ADD CONSTRAINT "class_group_grade_level_fk" FOREIGN KEY ("organization_id","grade_level_id") REFERENCES "tenancy"."grade_level"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_offering" ADD CONSTRAINT "class_offering_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_offering" ADD CONSTRAINT "class_offering_class_group_fk" FOREIGN KEY ("organization_id","class_group_id") REFERENCES "tenancy"."class_group"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_offering" ADD CONSTRAINT "class_offering_subject_fk" FOREIGN KEY ("organization_id","subject_id") REFERENCES "tenancy"."subject"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."class_offering" ADD CONSTRAINT "class_offering_term_fk" FOREIGN KEY ("organization_id","term_id") REFERENCES "tenancy"."term"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."education_level" ADD CONSTRAINT "education_level_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."grade_level" ADD CONSTRAINT "grade_level_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."grade_level" ADD CONSTRAINT "grade_level_education_level_fk" FOREIGN KEY ("organization_id","education_level_id") REFERENCES "tenancy"."education_level"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."school" ADD CONSTRAINT "school_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."subject" ADD CONSTRAINT "subject_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."subject" ADD CONSTRAINT "subject_parent_fk" FOREIGN KEY ("organization_id","parent_subject_id") REFERENCES "tenancy"."subject"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."term" ADD CONSTRAINT "term_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."term" ADD CONSTRAINT "term_academic_year_fk" FOREIGN KEY ("organization_id","academic_year_id") REFERENCES "tenancy"."academic_year"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."auth_identity" ADD CONSTRAINT "auth_identity_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."contact_point" ADD CONSTRAINT "contact_point_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."contact_point" ADD CONSTRAINT "contact_point_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."organization_membership" ADD CONSTRAINT "organization_membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."organization_membership" ADD CONSTRAINT "organization_membership_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."organization_membership" ADD CONSTRAINT "organization_membership_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."person" ADD CONSTRAINT "person_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role" ADD CONSTRAINT "role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role" ADD CONSTRAINT "role_cloned_from_fk" FOREIGN KEY ("cloned_from_role_id") REFERENCES "iam"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "iam"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "tenancy"."branch"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_class_group_fk" FOREIGN KEY ("organization_id","class_group_id") REFERENCES "tenancy"."class_group"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_class_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_assignment" ADD CONSTRAINT "role_assignment_student_profile_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "iam"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."role_permission" ADD CONSTRAINT "role_permission_permission_code_permission_code_fk" FOREIGN KEY ("permission_code") REFERENCES "iam"."permission"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."staff_profile" ADD CONSTRAINT "staff_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."staff_profile" ADD CONSTRAINT "staff_profile_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."student_profile" ADD CONSTRAINT "student_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."student_profile" ADD CONSTRAINT "student_profile_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."user_session" ADD CONSTRAINT "user_session_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_year_org_school_idx" ON "tenancy"."academic_year" USING btree ("organization_id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_year_current_uq" ON "tenancy"."academic_year" USING btree ("school_id") WHERE "tenancy"."academic_year"."is_current";--> statement-breakpoint
CREATE INDEX "branch_org_school_idx" ON "tenancy"."branch" USING btree ("organization_id","school_id");--> statement-breakpoint
CREATE INDEX "class_group_org_branch_idx" ON "tenancy"."class_group" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE INDEX "class_offering_org_group_idx" ON "tenancy"."class_offering" USING btree ("organization_id","class_group_id");--> statement-breakpoint
CREATE INDEX "grade_level_org_level_idx" ON "tenancy"."grade_level" USING btree ("organization_id","education_level_id");--> statement-breakpoint
CREATE INDEX "term_org_year_idx" ON "tenancy"."term" USING btree ("organization_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "contact_point_org_person_idx" ON "iam"."contact_point" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "login_attempt_identifier_at_idx" ON "iam"."login_attempt" USING btree ("identifier","at");--> statement-breakpoint
CREATE INDEX "login_attempt_ip_at_idx" ON "iam"."login_attempt" USING btree ("ip","at");--> statement-breakpoint
CREATE UNIQUE INDEX "person_org_external_ref_uq" ON "iam"."person" USING btree ("organization_id","external_ref") WHERE "iam"."person"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "person_search_text_trgm_idx" ON "iam"."person" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_active_uq" ON "iam"."role_assignment" USING btree ("person_id","role_id","scope_type","scope_id") WHERE "iam"."role_assignment"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "role_assignment_org_person_scope_idx" ON "iam"."role_assignment" USING btree ("organization_id","person_id","scope_type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_phone_uq" ON "iam"."user_account" USING btree ("phone_e164") WHERE "iam"."user_account"."phone_e164" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_session_account_active_idx" ON "iam"."user_session" USING btree ("user_account_id") WHERE "iam"."user_session"."revoked_at" IS NULL;