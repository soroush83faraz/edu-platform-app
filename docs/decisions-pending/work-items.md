# Pending decisions — work items («تکلیف / تسک»), round 7

Notes for the orchestrator to fold into `docs/decisions.md` / `docs/workspace.md`. Nothing here renames a route,
permission code, DB value or type code.

## 1. No comments, no conversation (owner: «later I'll build a communication channel»)

- Gone from the UI: the «گفت‌وگو» section and the new-comment form on `/inbox/[id]` (`CommentForm.tsx` deleted),
  the comment count on list rows (`InboxRow`), the teacher dashboard's «نظرهای تازه» panel (`FreshComments.tsx`
  and `unreadCommentNotificationsQuery` deleted), and the comment lines in the help page and the notification
  empty-state copy.
- `addCommentAction` is **no longer exported** — with no Server Action there is no client path to add a comment
  (stronger than hiding the form). `addComment` (service), `AddCommentInput` (DTO), `listComments`, the
  `work_item_comment` table, the `workspace.work_item.comment` permission and `WorkItemDetail.comments` /
  `InboxRow.commentsCount` in the read models are kept for the future channel. Re-exporting the action brings it back.
- Stored `work_item.comment` notifications are **hidden**, not deleted: `listNotifications` and `unreadCount`
  (the bell) skip that type (`HIDDEN_TYPE` in `src/modules/notif/repo.ts`).
- `scripts/load-test.ts` still has a «comment» step; `callAction` returns early when it cannot discover the
  action id, so it now silently does nothing. Remove the step when convenient.
- `src/app/(public)/privacy/page.tsx` still lists «نظرها» among the data the system holds — left as is (old
  comments do still exist in the database); revisit with the channel.

## 2. «اشخاص» picker from 0 characters

`SearchPersonsInput.q` may be empty; `searchPersons` drops the name filter for an empty query and returns the
first 20 active people by last name, first name. The form fetches on mount of the «اشخاص» mode and narrows as
one types (250 ms debounce); the placeholder is just «نام شخص» (the «(دست‌کم دو حرف)» hint is gone) and the
hit list scrolls (`max-h-72`).

## 3. Finished item: «بازیابی» + «حذف»

- The reopen button reads **«بازیابی»** everywhere (was «بازگشایی»), incl. dialog copy, toasts, service errors
  and the help page. Stored transition is unchanged (`→ open`).
- On a **done** item the manager row is «بازیابی» (outline) + **«حذف»** (`variant="destructive"`, trash glyph).
  A **cancelled** item shows «بازیابی» only.
- «حذف» = the existing **`cancelled`** status transition via `changeStatusAction` — the same action, permission
  (`workspace.work_item.update`) and service rule as the open-state «حذف»: allowed to the creator or a broad
  `update` holder. So a student may remove only their own personal «تسک» (they are its creator); class homework
  given to them is refused by the service (FORBIDDEN while open, VALIDATION once closed). Audit row
  `workspace.work_item.status_changed` in the same transaction; `work_item.archived_at` is NOT used (it would hide
  the item entirely and has no restore path in the UI).
- The confirmation is «حذف {noun}» / «این {noun} حذف شود؟ بعداً می‌توانید آن را بازیابی کنید.» where `noun` is
  the item's own word for the reader (`personalItemLabel` for a `todo`, else the voice's singular) — so a student
  reads «این تسک حذف شود؟». The old line «… دیگر آن را در فهرست خود نمی‌بینند» was dropped: it was not true (a
  removed item sits in «انجام‌شده» as «حذف‌شده»).
- After «حذف» (open or done) the page navigates to `/inbox`.
- Read-model fix: in `listInbox` the effective category now lets **cancelled win over the reader's own done**
  (before, a student who had finished an item kept seeing it as «انجام‌شده» after the teacher removed it; the
  same for a removed personal تسک). Tab counts are unaffected (both land in «انجام‌شده»). The detail page's status
  line says «حذف‌شده» to an assignee too.

## 4. Notification policy (`src/modules/workspace/notify-policy.ts`, unit + int tested)

- **Students notify nobody**: `notifiable(ctx.assignments, candidates)` returns `[]` when `isStudentOnly`. Applied
  to every `notifyMany` site in the workspace service (create, comment, status change, extend). The same empty set
  also skips the inbox «خوانده‌نشده» flip for those recipients — the unread dot is a notification too. Concretely a
  student's «انجام شد» no longer notifies the teacher or flips the teacher's row; the teacher reads n/m on the item.
- **Creating a personal item («خودم») notifies no one** (`creationNotifiable`, kind `self`) — it already had no
  other recipient; now explicit.
- **Kept**: a دبیر (or broad admin) giving class homework → the class is notified; «تمدید» → assignees;
  the creator's own status changes («اتمام», «بازیابی», «حذف») → assignees, as before.
- **Kept, flag for the owner**: an admin/principal giving a «تسک» to named people (`recipients.kind = 'persons'`)
  still notifies them. The request said «creating a تسک must not notify» but also «keep admin-assigned tasks if it
  is an assignment flow; if unclear keep» — this is an assignment to other people, so it is kept. One line in
  `creationNotifiable` changes it.
- Empty-state copy for «اعلان‌ها» no longer promises comment / «a student finished» notifications.
