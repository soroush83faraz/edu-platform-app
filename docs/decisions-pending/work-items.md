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

## 5. Verifier round (2026-09-27): who MANAGES an item; the «اشخاص» reach

### 5.1 An assignee's «انجام شد» is theirs alone — whatever their hats

**Defect.** `changeStatus` took the manager branch for ANY broad `workspace.work_item.update` holder, so a principal /
vice principal / organization admin who was only an ASSIGNEE of someone else's item closed it for everyone with
their «انجام شد» (every assignee marked done, the item `done`, the other assignees notified and flipped unread).

**Rule** (`src/modules/workspace/manage-policy.ts` → `managesItem`, pure, unit-tested): the item's **manager** — who
may «اتمام» (close for everyone), «بازیابی», «حذف» and «تمدید» — is
- its **creator** (the giver), also when they are one of its assignees;
- otherwise a **broad `update` holder who is NOT an assignee** — the admin override (e.g. removing spam), kept as it was;
- **never an assignee who did not create it**, whatever their hats.

One predicate for `changeStatus`, `extendDueAt` (an assignee no longer extends their own deadline) and the detail read
model's `viewer.isManager`, which `WorkItemActions` and `/inbox/[id]` draw from — so such a person sees the assignee
set («انجام شد» only; their own status line; no «گیرندگان» progress panel) and the service refuses the rest
(«حذف» / «بازیابی» / «تمدید» FORBIDDEN with the existing «فقط دهندهٴ … می‌تواند …» messages). Their «انجام شد» marks
their own row, flips the item only when every assignee is done, and notifies nobody (round 7's rule, now also for
broad hats). The audit row is unchanged (`workspace.work_item.status_changed`, `myState`).

**Behaviour change for the owner:** a manager who RECEIVED a تسک (e.g. the organization admin → a principal) can no
longer close, remove, restore or extend it — only the giver (or another broad admin who is not a recipient) can.

**Kept, flag for the owner / security review:**
- The admin override is organization-wide in phase 1, like the broad READ (docs/decisions.md «Visibility … per-school
  partitioning is a later block»): a school-scoped principal can still open, close, remove or extend an item of
  ANOTHER school that they did not create and did not receive.
- A creator who is also one of several assignees («اشخاص» with themselves picked) sees «انجام شد», not «اتمام»; being
  the giver, their «انجام شد» closes the item for everyone (the service cannot tell the two clicks apart). Unchanged.

Tests: `tests/unit/manage-policy.test.ts`, `tests/unit/work-item-actions.test.ts` (button sets per `isManager`),
`tests/int/workspace-service.test.ts` «a broad admin who is an ASSIGNEE…» (the verifier's probe: the organization
admin gives a تسک to a principal and a student → the principal's «انجام شد» marks only their row, the item stays
open, no notification to anyone, no row flipped; «حذف» / «بازیابی» / «تمدید» FORBIDDEN; the giver still manages; a
broad non-assignee keeps the override; a creator-assignee still manages).

### 5.2 «اشخاص» (search + `persons` recipients) and the class picker stay inside the caller's schools

**Defect.** `searchPersonsQuery` and `resolveRecipients({ kind: 'persons' })` required a broad
`workspace.work_item.create` and filtered by the organization (RLS) only: a school-scoped principal / vice principal
could list and assign تسک to people of other schools and to the organization admin.

**Fix.** `personReach(tx, ctx)` (workspace service) = FORBIDDEN without a broad `create` (a teacher still has no
«اشخاص»; a student only «خودم» — unchanged), else `{ scope: getPermissionScope(ctx, 'workspace.work_item.create'),
selfId }`. `searchPersons` and `filterActivePersonIds` REQUIRE it and apply the admin people lists' rule
(`personInScopeSql`) OR the caller themselves:
- organization admin → everyone of the organization (unchanged);
- school manager → only people **anchored** in their schools (live school enrollment, staff primary school, school/
  branch manager role) — never another school's people, never a holder of an organization-scoped role (the
  organization admin).
On submit an out-of-reach id gets exactly the unknown-id answer (`INVALID_REFERENCE` «یکی از گیرندگان یافت نشد.» — no
oracle for «exists in another school»), before the item or any row is written.

`getPermissionScope(tx, ctx, permission)` (iam/service) is `getAdminScope`'s rule for any permission (organization
assignment → organization; else the schools of the school/branch assignments carrying it); `getAdminScope` now
delegates to it for `iam.admin.access` (same result). For the catalog's managers the work-item scope and the admin
scope are the same schools.

**Also fixed — the class picker of «کار جدید»** (`newWorkItemOptionsQuery`): `listAllOfferings` listed EVERY open
offering of the organization (درس, class name, head count) to a school-scoped principal, while the submit
(`can(assign_class, class_offering)`) refused the other schools' ones (FORBIDDEN). Now `listOfferingsInScope`: the
offerings of the broad `assign_class` scope (whole organization for the organization admin) plus those the caller
teaches elsewhere (their derived teacher role) — exactly what the submit accepts.

**Behaviour change for the owner:** a principal / vice principal no longer finds or reaches (a) people of other schools,
(b) the organization admin, (c) people anchored nowhere — staff without a primary school or manager role, students
without a live school enrollment (the admin people lists already hid them), (d) a teacher who teaches at their school
but is anchored at another school. The organization admin reaches all of them, as before.

Tests: `tests/int/admin-scope.test.ts` «W» (principal of S1 / principal and vice of S2 / organization admin: search
from 0 characters and by name, submit refusals incl. the organization admin and an unknown id — nothing written, own
school OK, teacher FORBIDDEN, class picker per scope incl. «teaches elsewhere»).

## «پنل من» — the «انجام‌نشده» buckets become boxes in a two-column grid (owner, 2026-09-27)

Each non-empty deadline bucket («سررسیده», «امروز», «این هفته», «بعداً», «بدون مهلت») is its own `surface-work` box —
the bucket's glyph, name and count on top (`SectionHeader`), its rows inside a `LeavingList` (fold on leave and the
finish hand-off unchanged) — laid out `grid-cols-2` on every width (`src/modules/workspace/ui/InboxBuckets.tsx`).
Four buckets read 2×2 on a phone; an odd last box keeps its one cell (normal flow, no `col-span`); boxes align to
their top (`items-start`) so a one-row box does not stretch to a long neighbour. «سررسیده» differs only by its red
name and count chip — no red fill. Kept at two columns on `xl` too: three columns turn four buckets into 3 + 1.

- **Exception to «one `surface-work` per view»**: the owner asked for boxes; each bucket is a primary list of its own.
- **Compact row** (`InboxBoxRow` in `InboxRow.tsx`): a phone column is ~160 px, so below `md:` the row is a 28 px
  مُهر درس (or the 28 px type glyph), the title `text-row` clamped to two lines with its priority dot, and ONE meta
  part — the deadline (red when overdue), or without one the درس / sender. Dropped on phones: class name, my
  progress «۳/۲۵» on what I gave, the unread dot (the unread title stays semibold). From `md:` the box is wide
  enough, so the full meta line, progress and unread dot come back (36 px stamp, 64 px row). ≥ 44 px on phones.
- `WorkItemMark` takes a `className` (the smaller stamp); `SubjectStamp` itself is unchanged.
- «انجام‌شده» keeps its single list of full `InboxRow`s (no buckets there).
- Tests: `tests/unit/inbox-buckets.test.ts` (boxes per bucket in order inside `grid-cols-2`, empty buckets absent, odd
  count without `col-span`, only «سررسیده» red and never as a fill, compact rows ≥ 44 px with the clamped title and
  the red overdue deadline).
