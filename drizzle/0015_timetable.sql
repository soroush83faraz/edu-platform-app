CREATE TABLE "tenancy"."school_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"period_no" smallint NOT NULL,
	"label" text NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_period_school_no_uq" UNIQUE("organization_id","school_id","period_no"),
	CONSTRAINT "school_period_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "school_period_no_chk" CHECK ("tenancy"."school_period"."period_no" BETWEEN 1 AND 12),
	CONSTRAINT "school_period_range_chk" CHECK ("tenancy"."school_period"."starts_at" < "tenancy"."school_period"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "academic"."timetable_slot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"period_no" smallint NOT NULL,
	"class_offering_id" uuid NOT NULL,
	"room" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_slot_cell_uq" UNIQUE("organization_id","class_group_id","weekday","period_no"),
	CONSTRAINT "timetable_slot_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "timetable_slot_weekday_chk" CHECK ("academic"."timetable_slot"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "timetable_slot_period_chk" CHECK ("academic"."timetable_slot"."period_no" BETWEEN 1 AND 12),
	CONSTRAINT "timetable_slot_room_chk" CHECK ("academic"."timetable_slot"."room" IS NULL OR char_length("academic"."timetable_slot"."room") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD COLUMN "class_offering_id" uuid;--> statement-breakpoint
ALTER TABLE "tenancy"."school_period" ADD CONSTRAINT "school_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."school_period" ADD CONSTRAINT "school_period_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_slot" ADD CONSTRAINT "timetable_slot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_slot" ADD CONSTRAINT "timetable_slot_class_group_fk" FOREIGN KEY ("organization_id","class_group_id") REFERENCES "tenancy"."class_group"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic"."timetable_slot" ADD CONSTRAINT "timetable_slot_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timetable_slot_org_offering_idx" ON "academic"."timetable_slot" USING btree ("organization_id","class_offering_id");--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_offering_fk" FOREIGN KEY ("organization_id","class_offering_id") REFERENCES "tenancy"."class_offering"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_org_offering_idx" ON "workspace"."work_item" USING btree ("organization_id","class_offering_id") WHERE "workspace"."work_item"."class_offering_id" IS NOT NULL;--> statement-breakpoint
-- Weekly class timetable («برنامهٴ کلاسی», docs/decisions.md «برنامهٴ کلاسی»; docs/admin.md «زنگ‌بندی و برنامهٴ هفتگی»):
-- 1) tenancy.school_period — the bell schedule of a school (period_no 1..12, label, starts_at < ends_at, school-local
--    time). Pure configuration: edited in place / removed, no status column. Backfilled below with the six default
--    periods for every school that exists today; `createSchool` seeds the same six for new schools.
-- 2) academic.timetable_slot — one row per occupied cell (class_group, weekday 0=شنبه..6, period_no) → class_offering,
--    optional room. Clearing a cell deletes the row (the one hard delete of the product — pure config, audited on
--    the class group). period_no is a number, not an FK to school_period, so a re-defined زنگ‌بندی keeps the grid.
-- 3) workspace.work_item.class_offering_id (nullable, composite FK) — set by createWorkItem for class_offering
--    recipients so a task links to its درس (`listInbox({ offeringId })`); partial index for the subject page.
-- Additive only; RLS / grants / updated_at triggers come from the three apply calls.
-- app_owner is bound by FORCE RLS on tenancy.school, so the backfill runs once per organization with the tenant
-- context set transaction-locally (the pattern of migration 0012); the context is cleared again at the end.
DO $backfill$
DECLARE
  o record;
BEGIN
  FOR o IN SELECT id FROM tenancy.organization LOOP
    PERFORM set_config('app.current_org_id', o.id::text, true);
    INSERT INTO tenancy.school_period (id, organization_id, school_id, period_no, label, starts_at, ends_at)
    SELECT app.uuid_generate_v7(), s.organization_id, s.id, d.period_no, d.label, d.starts_at::time, d.ends_at::time
    FROM tenancy.school s
    CROSS JOIN (VALUES
      (1, 'زنگ اول', '08:00', '08:45'),
      (2, 'زنگ دوم', '08:55', '09:40'),
      (3, 'زنگ سوم', '10:00', '10:45'),
      (4, 'زنگ چهارم', '10:55', '11:40'),
      (5, 'زنگ پنجم', '12:00', '12:45'),
      (6, 'زنگ ششم', '12:55', '13:40')
    ) AS d(period_no, label, starts_at, ends_at)
    WHERE NOT EXISTS (SELECT 1 FROM tenancy.school_period p WHERE p.school_id = s.id);
  END LOOP;
  PERFORM set_config('app.current_org_id', '', true);
END
$backfill$;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
