-- «گزارش جلسه» — one report per session AND درس (security review 2026-10-20, F1 / F2; docs/decisions.md «گزارش جلسه:
-- رفع یافته‌های بازبینی امنیتی»). The key of 0027 was the roll call's cell `(class_group, date, period_no)`, so the
-- FIRST report written for a cell — by the درس the timetable put there then, or by any درس of the class a teacher
-- named — owned that cell: the teacher of the درس the timetable puts there NOW read it (with its private «یادداشت
-- دبیر») and could never write their own. The service now derives the درس from the timetable (a client value that
-- differs is refused) and reads / writes only the row of THAT درس; this key lets the two rows sit side by side.
-- An ACCEPTED EXCEPTION to "additive only" (as 0026's feature_flag key was): the UNIQUE constraint is dropped and a
-- WIDER one added in one transaction. Widening can never fail on existing rows (unique on four columns ⇒ unique on
-- five), and academic.session_report has never been written in production (0027 shipped the same day, not deployed).
ALTER TABLE "academic"."session_report" DROP CONSTRAINT "session_report_cell_uq";--> statement-breakpoint
ALTER TABLE "academic"."session_report" ADD CONSTRAINT "session_report_cell_offering_uq" UNIQUE("organization_id","class_group_id","date","period_no","class_offering_id");
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
