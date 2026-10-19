-- «ارتباط ولی و مدرسه»: re-routing a guardian's message nobody can answer any more (security review 2026-10-19, D1;
-- docs/decisions.md; src/modules/iam/guardian-message-routing.ts). Additive only: ONE function, no table, no column,
-- no policy changed — `workspace.guardian_message` keeps its two RESTRICTIVE policies of 0022 (readable by the sending
-- guardian and the item's addressees only), and app.apply_grants() keeps 0022's definition (re-applied below).
--
-- When a removal, a role revoke or an ended teaching leaves an OPEN «پیام ولی» with no addressee who can answer it,
-- the admin who made that change re-routes it in the same transaction. That admin is no addressee, so 0022's policy
-- hides the message row from them — and the re-route needs its routing facts (school, child, destination, درس).
-- `app.guardian_message_routes(p_person_id)` returns exactly those facts, and nothing else (no guardian, no kind, no
-- date, no text — the text lives on the work item and never here), of the OPEN messages whose work item has an
-- assignee row of `p_person_id` — and only at a school where the CURRENT person (`app.current_person_id()`, bound by
-- withTenant; unset → NULL → no row) holds one of the permissions of the writes that re-route: `iam.person.write`
-- (a removal), `iam.role_assignment.write` (a revoke), `academic.teacher_assignment.write` (an ended teaching) — the
-- school's managers and the organization admin (`app.counseling_holds`, 0018). The managers' read of the table itself
-- is unchanged (they still select no row of it).
--
-- SECURITY DEFINER (owner app_owner, pinned search_path, every name schema-qualified — docs/db-changes.md, the 0006
-- pattern; pg_temp listed last so a temporary object can never shadow anything): it reads as app_owner, to whom only
-- the RESTRICTIVE policies `TO app_rw` do not apply — app_owner is FORCE-RLS-bound like everyone else, so
-- `tenant_isolation` still confines it to the current organization (unset → nothing). EXECUTE is revoked from PUBLIC
-- and granted to app_rw only (app_backup, the dump role, needs none).
CREATE OR REPLACE FUNCTION app.guardian_message_routes(p_person_id uuid)
RETURNS TABLE (work_item_id uuid, school_id uuid, student_profile_id uuid, destination_kind text, class_offering_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $fn$
  SELECT gm.work_item_id, gm.school_id, gm.student_profile_id, gm.destination_kind, gm.class_offering_id
  FROM workspace.guardian_message gm
  JOIN workspace.work_item wi ON wi.id = gm.work_item_id AND wi.archived_at IS NULL
  JOIN workspace.work_item_status s ON s.id = wi.status_id AND s.category IN ('todo', 'doing')
  WHERE EXISTS (
          SELECT 1 FROM workspace.work_item_assignee a
          WHERE a.work_item_id = gm.work_item_id AND a.person_id = p_person_id AND a.role = 'assignee')
    AND (app.counseling_holds('iam.person.write', gm.school_id)
         OR app.counseling_holds('iam.role_assignment.write', gm.school_id)
         OR app.counseling_holds('academic.teacher_assignment.write', gm.school_id))
  ORDER BY gm.work_item_id
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guardian_message_routes(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.guardian_message_routes(uuid) TO app_rw;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
