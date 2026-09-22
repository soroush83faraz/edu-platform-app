CREATE TABLE "academic"."attendance_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"status" text NOT NULL,
	"minutes_late" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_entry_session_student_uq" UNIQUE("organization_id","attendance_session_id","student_profile_id"),
	CONSTRAINT "attendance_entry_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "attendance_entry_status_chk" CHECK ("academic"."attendance_entry"."status" IN ('present', 'absent', 'late', 'excused')),
	CONSTRAINT "attendance_entry_minutes_chk" CHECK ("academic"."attendance_entry"."minutes_late" IS NULL OR "academic"."attendance_entry"."minutes_late" BETWEEN 0 AND 600),
	CONSTRAINT "attendance_entry_note_chk" CHECK ("academic"."attendance_entry"."note" IS NULL OR char_length("academic"."attendance_entry"."note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE TABLE "academic"."attendance_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"class_offering_id" uuid,
	"date" date NOT NULL,
	"period_no" smallint,
	"taken_by_person_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_session_cell_uq" UNIQUE NULLS NOT DISTINCT("organization_id","class_group_id","date","period_no"),
	CONSTRAINT "attendance_session_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "attendance_session_period_chk" CHECK ("academic"."attendance_session"."period_no" IS NULL OR "academic"."attendance_session"."period_no" BETWEEN 1 AND 12),
	CONSTRAINT "attendance_session_note_chk" CHECK ("academic"."attendance_session"."note" IS NULL OR char_length("academic"."attendance_session"."note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
ALTER TABLE "academic"."attendance_entry" ADD CONSTRAINT "attendance_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance_entry" ADD CONSTRAINT "attendance_entry_session_fk" FOREIGN KEY ("organization_id","attendance_session_id") REFERENCES "academic"."attendance_session"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance_entry" ADD CONSTRAINT "attendance_entry_student_fk" FOREIGN KEY ("organization_id","student_profile_id") REFERENCES "iam"."student_profile"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance_session" ADD CONSTRAINT "attendance_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance_session" ADD CONSTRAINT "attendance_session_class_group_fk" FOREIGN KEY ("organization_id","class_group_id") REFERENCES "tenancy"."class_group"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance_session" ADD CONSTRAINT "attendance_session_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."attendance_session" ADD CONSTRAINT "attendance_session_taken_by_fk" FOREIGN KEY ("organization_id","taken_by_person_id") REFERENCES "iam"."person"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_entry_org_student_idx" ON "academic"."attendance_entry" USING btree ("organization_id","student_profile_id","status");--> statement-breakpoint
CREATE INDEX "attendance_session_org_date_idx" ON "academic"."attendance_session" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "attendance_session_org_offering_idx" ON "academic"."attendance_session" USING btree ("organization_id","class_offering_id");
--> statement-breakpoint
-- Attendance («حضور و غیاب», docs/attendance.md; docs/decisions.md «حضور و غیاب»):
-- 1) academic.attendance_session — ONE roll call: (class_group, date, period_no) with period_no NULL = the daily
--    homeroom roll call. The natural key is UNIQUE NULLS NOT DISTINCT so re-taking updates the same row instead of
--    inserting a second one (a plain UNIQUE would treat every NULL period as distinct). class_offering_id is the
--    درس of that زنگ (NULL for the daily roll call), taken_by_person_id / taken_at the signature the UI shows.
-- 2) academic.attendance_entry — one mark per student per roll call: present / absent / late / excused, optional
--    minutes_late and a short note; unique per (session, student); the (organization_id, student_profile_id,
--    status) index serves «حضور و غیاب من» and the per-student totals of the admin report.
-- Additive only, no backfill (attendance starts empty; the seeds write history). RLS / grants / updated_at
-- triggers come from the three apply calls below.
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
