-- «مرخصی و خروج مجاز» (owner, 2026-10-20; docs/attendance.md «مرخصی و خروج مجاز»; docs/db.md academic.leave_request,
-- academic.early_exit). Written as 0026 on a parallel branch; renumbered 0029 at the merge onto 0028 (the tables part
-- below is drizzle-kit's, generated afresh from the combined schema; this header and the policies after it are by hand):
-- 1) academic.leave_request — a guardian's «درخواست مرخصی / غیبت موجه» for ONE child: school (the scope a manager
--    decides at), child, the requesting guardian, a date range of at most 14 days (CHECK: to − from ≤ 13) or — for one
--    day — a partial day (from_period..to_period, both or neither), a reason category (CHECK: illness / family / travel
--    / appointment / other), an optional note ≤ 300, a status (pending → approved / rejected by a manager, or cancelled
--    by the guardian) and, once decided, who and when (CHECK: decided_by + decided_at exist exactly for approved /
--    rejected) with an optional decision note ≤ 300. Composite FKs to school, student_profile and person (twice).
-- 2) academic.early_exit — a manager's «خروج مجاز»: school, child, the date and the Tehran clock time the child left, a
--    reason category (CHECK: illness / family / appointment / emergency / other), an optional note ≤ 300, an optional
--    pickup name ≤ 60, a status (active / cancelled, with who and when — CHECK) and the manager who recorded it. At most
--    ONE active exit per student per day (partial UNIQUE index). Composite FKs to school, student_profile, person (twice).
-- Both are in the existing `academic` schema, so apply_rls() gives them tenant_isolation (ENABLE + FORCE) unchanged and
-- apply_updated_at_triggers() their updated_at trigger; app.apply_grants() is NOT redefined (0020's REVOKEs and the
-- default grants stay exactly as they are). Instead of a REVOKE, defense in depth with RESTRICTIVE policies for app_rw
-- (ANDed with tenant_isolation; seeds and the pilot reset run as app_owner, pg_dump as app_backup — not bound):
--   • no DELETE of either table, ever (rows are withdrawn by status, never removed) — `USING (false)`;
--   • INSERT only in the current person's own name: a leave request as its requesting guardian, an exit as the manager
--     who records it (`app.current_person_id()` is bound by withTenant; unset → NULL → nothing passes, fail closed).
-- Reads stay with the services: a guardian only ever reaches their own children's rows through `requireChild` (the live
-- link AND `can(permission, { student })`), a manager only the schools they hold the permission at; the notes of a
-- request are shown to the child's guardians and the school's managers, never to a teacher (who sees a «مرخصی» tag only).
-- Additive only, no backfill. The permissions (academic.leave.request / academic.leave.decide /
-- academic.early_exit.write) and the notification types (academic.leave_requested, guardian.leave_decided,
-- guardian.early_exit) are catalog rows (scripts/catalog.ts), written by the deploy's `seed` step.
CREATE TABLE "academic"."early_exit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"date" date NOT NULL,
	"exit_time" time NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"picked_up_by" text,
	"status" text DEFAULT 'active' NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"cancelled_by_person_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_exit_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "early_exit_category_chk" CHECK ("academic"."early_exit"."category" IN ('illness', 'family', 'appointment', 'emergency', 'other')),
	CONSTRAINT "early_exit_status_chk" CHECK ("academic"."early_exit"."status" IN ('active', 'cancelled')),
	CONSTRAINT "early_exit_note_chk" CHECK ("academic"."early_exit"."note" IS NULL OR char_length("academic"."early_exit"."note") BETWEEN 1 AND 300),
	CONSTRAINT "early_exit_picked_up_by_chk" CHECK ("academic"."early_exit"."picked_up_by" IS NULL OR char_length("academic"."early_exit"."picked_up_by") BETWEEN 1 AND 60),
	CONSTRAINT "early_exit_cancel_chk" CHECK (("academic"."early_exit"."status" = 'cancelled') = ("academic"."early_exit"."cancelled_by_person_id" IS NOT NULL AND "academic"."early_exit"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "academic"."leave_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"from_period" smallint,
	"to_period" smallint,
	"category" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_request_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "leave_request_category_chk" CHECK ("academic"."leave_request"."category" IN ('illness', 'family', 'travel', 'appointment', 'other')),
	CONSTRAINT "leave_request_status_chk" CHECK ("academic"."leave_request"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_request_dates_chk" CHECK ("academic"."leave_request"."from_date" <= "academic"."leave_request"."to_date" AND "academic"."leave_request"."to_date" - "academic"."leave_request"."from_date" <= 13),
	CONSTRAINT "leave_request_periods_chk" CHECK (("academic"."leave_request"."from_period" IS NULL AND "academic"."leave_request"."to_period" IS NULL) OR ("academic"."leave_request"."from_period" IS NOT NULL AND "academic"."leave_request"."to_period" IS NOT NULL AND "academic"."leave_request"."from_period" BETWEEN 1 AND 12 AND "academic"."leave_request"."to_period" BETWEEN 1 AND 12 AND "academic"."leave_request"."from_period" <= "academic"."leave_request"."to_period" AND "academic"."leave_request"."from_date" = "academic"."leave_request"."to_date")),
	CONSTRAINT "leave_request_note_chk" CHECK ("academic"."leave_request"."note" IS NULL OR char_length("academic"."leave_request"."note") BETWEEN 1 AND 300),
	CONSTRAINT "leave_request_decision_note_chk" CHECK ("academic"."leave_request"."decision_note" IS NULL OR ("academic"."leave_request"."status" IN ('approved', 'rejected') AND char_length("academic"."leave_request"."decision_note") BETWEEN 1 AND 300)),
	CONSTRAINT "leave_request_decision_chk" CHECK (("academic"."leave_request"."status" IN ('approved', 'rejected')) = ("academic"."leave_request"."decided_by_person_id" IS NOT NULL AND "academic"."leave_request"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "academic"."early_exit" ADD CONSTRAINT "early_exit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."early_exit" ADD CONSTRAINT "early_exit_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."early_exit" ADD CONSTRAINT "early_exit_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."early_exit" ADD CONSTRAINT "early_exit_recorded_by_fk" FOREIGN KEY ("organization_id","recorded_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."early_exit" ADD CONSTRAINT "early_exit_cancelled_by_fk" FOREIGN KEY ("organization_id","cancelled_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."leave_request" ADD CONSTRAINT "leave_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."leave_request" ADD CONSTRAINT "leave_request_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."leave_request" ADD CONSTRAINT "leave_request_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."leave_request" ADD CONSTRAINT "leave_request_requested_by_fk" FOREIGN KEY ("organization_id","requested_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."leave_request" ADD CONSTRAINT "leave_request_decided_by_fk" FOREIGN KEY ("organization_id","decided_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "early_exit_student_day_active_uq" ON "academic"."early_exit" USING btree ("organization_id","student_profile_id","date") WHERE "academic"."early_exit"."status" = 'active';--> statement-breakpoint
CREATE INDEX "early_exit_org_school_date_idx" ON "academic"."early_exit" USING btree ("organization_id","school_id","date");--> statement-breakpoint
CREATE INDEX "early_exit_org_student_idx" ON "academic"."early_exit" USING btree ("organization_id","student_profile_id","date");--> statement-breakpoint
CREATE INDEX "leave_request_org_school_status_idx" ON "academic"."leave_request" USING btree ("organization_id","school_id","status","from_date");--> statement-breakpoint
CREATE INDEX "leave_request_org_student_idx" ON "academic"."leave_request" USING btree ("organization_id","student_profile_id","from_date");
--> statement-breakpoint
CREATE POLICY leave_request_no_delete ON academic.leave_request AS RESTRICTIVE FOR DELETE TO app_rw USING (false);
--> statement-breakpoint
CREATE POLICY leave_request_insert ON academic.leave_request AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (requested_by_person_id = app.current_person_id());
--> statement-breakpoint
CREATE POLICY early_exit_no_delete ON academic.early_exit AS RESTRICTIVE FOR DELETE TO app_rw USING (false);
--> statement-breakpoint
CREATE POLICY early_exit_insert ON academic.early_exit AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (recorded_by_person_id = app.current_person_id());
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
