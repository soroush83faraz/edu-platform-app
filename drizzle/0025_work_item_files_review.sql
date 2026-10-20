-- «پیوست تکلیف و تحویل پاسخ»: security review fixes before the first deploy of 0024 (2026-10-19, D3 + D6;
-- docs/decisions.md; docs/db.md files.file_object). Additive only: no table, no column, no data changed — two
-- policies tightened, three added, one function redefined, three functions added. app.apply_grants() keeps 0024's
-- definition (re-applied below), 0023's app.guardian_message_routes is untouched.
--
-- D3 — until now `files.file_object` had only tenant_isolation, so as app_rw (a bug, an injection) a classmate could
-- read another student's file rows (name, uploader, storage key) and archive them, and anyone could archive or add a
-- giver's attachment row (submission_id NULL). Now, for app_rw (RESTRICTIVE, ANDed with tenant_isolation; seeds and
-- the pilot reset run as app_owner, pg_dump as app_backup — neither is bound by these):
--   file_read    a file row is readable by its uploader, and through an attachment row the caller may read: a
--                پاسخ's (attachment_read already hides it unless the پاسخ is readable — its student, the item's
--                managers) or a giver's (submission_id NULL) on an item the caller may OPEN (app.work_item_viewer =
--                canViewWorkItem);
--   file_insert  only as its own uploader, and only `pending`;
--   file_update  exactly the app's three writes: the uploader's own pending upload (taken FOR UPDATE, then attached),
--                attached → archived by whoever manages the attachment (the پاسخ's student for its files; the item's
--                manager for a giver's file). A pending upload of someone else expires only through
--                app.expire_stale_uploads (below);
--   attachment_insert / attachment_update (0024's, tightened): a پاسخ's rows by its student only (unchanged); a giver's
--                rows only by the item's manager (was: anyone).
-- app.work_item_manager(item) now matches `managesItem` (src/modules/workspace/manage-policy.ts) exactly: the creator
-- unless the type's creator is no participant (`parent_message`), else a holder of a BROAD workspace.work_item.update
-- who is NOT one of its assignees (was: creator OR broad holder). submission_read (0024) uses it unchanged.
-- Both helpers are SECURITY INVOKER (the caller's own RLS: the current tenant only); unbound person → NULL → false.
--
-- D3/D6 — two SECURITY DEFINER functions (owner app_owner, pinned search_path, every name schema-qualified — the 0006 /
-- 0023 pattern; app_owner is FORCE-RLS-bound, so tenant_isolation still confines them to the current organization and
-- only the RESTRICTIVE policies `TO app_rw` do not apply). EXECUTE revoked from PUBLIC, granted to app_rw only:
--   app.expire_stale_uploads(limit)  archives the organization's uploads left `pending` for more than 24 h
--                (FILE_LIMITS.pendingTtlMs), at most 50 per call, SKIP LOCKED, and returns their ids and keys — what
--                every upload did before (src/modules/workspace/file-access.ts `expireStaleUploads`), now that app_rw
--                no longer sees other people's pending rows;
--   app.live_file_ids(ids)  which of these ids (≤ 1000) have a live (pending / attached) row in the current
--                organization — the orphan sweeper's only question (src/modules/files/sweep.ts); raises when no
--                organization is bound, so an unbound call can never make every file look like an orphan.
CREATE OR REPLACE FUNCTION app.work_item_manager(p_work_item_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE
           WHEN wi.created_by_person_id = app.current_person_id() THEN wt.code IS DISTINCT FROM 'parent_message'
           ELSE NOT EXISTS (
                  SELECT 1 FROM workspace.work_item_assignee a
                  WHERE a.work_item_id = wi.id AND a.person_id = app.current_person_id() AND a.role = 'assignee')
                AND EXISTS (
                  SELECT 1
                  FROM iam.role_assignment ra
                  JOIN iam.role_permission rp ON rp.role_id = ra.role_id AND rp.permission_code = 'workspace.work_item.update'
                  WHERE ra.person_id = app.current_person_id()
                    AND ra.revoked_at IS NULL
                    AND (ra.valid_from IS NULL OR ra.valid_from <= current_date)
                    AND (ra.valid_to IS NULL OR ra.valid_to >= current_date)
                    AND ra.scope_type IN ('organization', 'school', 'branch'))
         END
  FROM workspace.work_item wi
  JOIN workspace.work_item_type wt ON wt.id = wi.type_id
  WHERE wi.id = p_work_item_id
$fn$;
--> statement-breakpoint
-- May the CURRENT person open work item p_work_item_id (`canViewWorkItem`, src/modules/workspace/service.ts)? Its
-- creator (unless a `parent_message`), anyone with an inbox row for it (assignee, watcher), or a holder of a BROAD
-- workspace.work_item.read when the item is not confidential and not a personal item (its ONLY assignee its creator).
CREATE OR REPLACE FUNCTION app.work_item_viewer(p_work_item_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT (wi.created_by_person_id = app.current_person_id() AND wt.code IS DISTINCT FROM 'parent_message')
      OR EXISTS (
           SELECT 1 FROM workspace.inbox_entry ie
           WHERE ie.work_item_id = wi.id AND ie.person_id = app.current_person_id())
      OR (NOT wi.is_confidential
          AND NOT (
                EXISTS (SELECT 1 FROM workspace.work_item_assignee a
                        WHERE a.work_item_id = wi.id AND a.role = 'assignee' AND a.person_id = wi.created_by_person_id)
            AND NOT EXISTS (SELECT 1 FROM workspace.work_item_assignee a
                            WHERE a.work_item_id = wi.id AND a.role = 'assignee' AND a.person_id <> wi.created_by_person_id))
          AND EXISTS (
                SELECT 1
                FROM iam.role_assignment ra
                JOIN iam.role_permission rp ON rp.role_id = ra.role_id AND rp.permission_code = 'workspace.work_item.read'
                WHERE ra.person_id = app.current_person_id()
                  AND ra.revoked_at IS NULL
                  AND (ra.valid_from IS NULL OR ra.valid_from <= current_date)
                  AND (ra.valid_to IS NULL OR ra.valid_to >= current_date)
                  AND ra.scope_type IN ('organization', 'school', 'branch')))
  FROM workspace.work_item wi
  JOIN workspace.work_item_type wt ON wt.id = wi.type_id
  WHERE wi.id = p_work_item_id
$fn$;
--> statement-breakpoint
CREATE POLICY file_read ON files.file_object AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    file_object.uploaded_by_person_id = app.current_person_id()
    OR EXISTS (
         SELECT 1 FROM workspace.work_item_attachment a
         WHERE a.organization_id = file_object.organization_id AND a.file_id = file_object.id
           AND (a.submission_id IS NOT NULL OR app.work_item_viewer(a.work_item_id)))
  );
--> statement-breakpoint
CREATE POLICY file_insert ON files.file_object AS RESTRICTIVE FOR INSERT TO app_rw
  WITH CHECK (file_object.uploaded_by_person_id = app.current_person_id() AND file_object.status = 'pending');
--> statement-breakpoint
CREATE POLICY file_update ON files.file_object AS RESTRICTIVE FOR UPDATE TO app_rw
  USING (
    (file_object.uploaded_by_person_id = app.current_person_id() AND file_object.status = 'pending')
    OR (file_object.status = 'attached' AND EXISTS (
         SELECT 1 FROM workspace.work_item_attachment a
         WHERE a.organization_id = file_object.organization_id AND a.file_id = file_object.id
           AND CASE WHEN a.submission_id IS NULL THEN app.work_item_manager(a.work_item_id)
                    ELSE EXISTS (SELECT 1 FROM workspace.work_item_submission s
                                 WHERE s.id = a.submission_id AND s.student_person_id = app.current_person_id())
               END))
  )
  WITH CHECK (
    (file_object.status = 'attached' AND file_object.uploaded_by_person_id = app.current_person_id() AND EXISTS (
         SELECT 1 FROM workspace.work_item_attachment a
         WHERE a.organization_id = file_object.organization_id AND a.file_id = file_object.id
           AND a.added_by_person_id = app.current_person_id()))
    OR (file_object.status = 'archived' AND EXISTS (
         SELECT 1 FROM workspace.work_item_attachment a
         WHERE a.organization_id = file_object.organization_id AND a.file_id = file_object.id
           AND CASE WHEN a.submission_id IS NULL THEN app.work_item_manager(a.work_item_id)
                    ELSE EXISTS (SELECT 1 FROM workspace.work_item_submission s
                                 WHERE s.id = a.submission_id AND s.student_person_id = app.current_person_id())
               END))
  );
--> statement-breakpoint
ALTER POLICY attachment_insert ON workspace.work_item_attachment
  WITH CHECK (
    work_item_attachment.added_by_person_id = app.current_person_id()
    AND CASE WHEN work_item_attachment.submission_id IS NULL THEN app.work_item_manager(work_item_attachment.work_item_id)
             ELSE EXISTS (SELECT 1 FROM workspace.work_item_submission s
                          WHERE s.id = work_item_attachment.submission_id AND s.student_person_id = app.current_person_id())
        END
  );
--> statement-breakpoint
ALTER POLICY attachment_update ON workspace.work_item_attachment
  USING (
    CASE WHEN work_item_attachment.submission_id IS NULL THEN app.work_item_manager(work_item_attachment.work_item_id)
         ELSE EXISTS (SELECT 1 FROM workspace.work_item_submission s
                      WHERE s.id = work_item_attachment.submission_id AND s.student_person_id = app.current_person_id())
    END
  )
  WITH CHECK (
    CASE WHEN work_item_attachment.submission_id IS NULL THEN app.work_item_manager(work_item_attachment.work_item_id)
         ELSE EXISTS (SELECT 1 FROM workspace.work_item_submission s
                      WHERE s.id = work_item_attachment.submission_id AND s.student_person_id = app.current_person_id())
    END
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.expire_stale_uploads(p_limit integer)
RETURNS TABLE (file_id uuid, file_storage_key text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $fn$
  WITH stale AS (
    SELECT f.id
    FROM files.file_object f
    WHERE f.organization_id = app.current_org_id()
      AND f.status = 'pending'
      AND f.created_at < now() - interval '24 hours'
    ORDER BY f.created_at
    LIMIT least(greatest(coalesce(p_limit, 0), 0), 50)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE files.file_object f
     SET status = 'archived', archived_at = now()
    FROM stale
   WHERE f.id = stale.id
  RETURNING f.id, f.storage_key
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.expire_stale_uploads(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.expire_stale_uploads(integer) TO app_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.live_file_ids(p_ids uuid[]) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $fn$
BEGIN
  IF app.current_org_id() IS NULL THEN
    RAISE EXCEPTION 'app.live_file_ids: no organization bound' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'app.live_file_ids: at most 1000 ids per call' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT f.id
    FROM files.file_object f
    WHERE f.organization_id = app.current_org_id()
      AND f.id = ANY (p_ids)
      AND f.status <> 'archived';
END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.live_file_ids(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.live_file_ids(uuid[]) TO app_rw;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
