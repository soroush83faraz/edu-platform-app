-- «مرکز درخواست‌ها» — the leave requests and «در حال بررسی» (owner 2026-10-20; docs/decisions.md «یادآوری مهلت و مرکز
-- درخواست‌ها», its 2026-10-20 owner answers; docs/db.md workspace.request_sla). Additive only, on the one table of 0028;
-- no backfill (no clock of kind leave_request exists yet, and every existing row satisfies the new CHECKs):
-- 1) `leave_request_id` (nullable) + its composite FK to academic.leave_request (0029) and a partial UNIQUE index — the
--    clock of a guardian's «درخواست مرخصی», which has no work item; CHECK `request_sla_subject_chk`: a leave_request
--    clock names its leave request and no work item, every other kind no leave request (0028's work_item CHECK stays).
-- 2) «در حال بررسی» stops the clock: `paused_at` (null = running) while the request is in progress, `paused_seconds`
--    (DEFAULT 0, CHECK ≥ 0) the current period's paused time, already added to `due_at` when the request goes back to
--    «باز» — so the 80 % mark and the deadline count ACTIVE time only (src/modules/workspace/request-sla.ts).
-- 3) the three apply_* calls (no new table: they re-apply what is there; app.apply_grants() is not redefined).
ALTER TABLE "workspace"."request_sla" ADD COLUMN "leave_request_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace"."request_sla" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace"."request_sla" ADD COLUMN "paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace"."request_sla" ADD CONSTRAINT "request_sla_leave_request_fk" FOREIGN KEY ("organization_id","leave_request_id") REFERENCES "academic"."leave_request"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_sla_leave_request_uq" ON "workspace"."request_sla" USING btree ("organization_id","leave_request_id") WHERE "workspace"."request_sla"."leave_request_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace"."request_sla" ADD CONSTRAINT "request_sla_subject_chk" CHECK (CASE WHEN "workspace"."request_sla"."kind" = 'leave_request' THEN "workspace"."request_sla"."leave_request_id" IS NOT NULL AND "workspace"."request_sla"."work_item_id" IS NULL ELSE "workspace"."request_sla"."leave_request_id" IS NULL END);--> statement-breakpoint
ALTER TABLE "workspace"."request_sla" ADD CONSTRAINT "request_sla_paused_chk" CHECK ("workspace"."request_sla"."paused_seconds" >= 0);
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
