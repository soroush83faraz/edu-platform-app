# Pending decisions — roles (owner, 2026-09-27): «معاون» = «مدیر مدرسه», roles display-only on the staff pages

Notes for the orchestrator to fold into `docs/decisions.md` (docs/admin.md is already updated in place). Nothing
renames a route, a permission code, a DB value or a type code; no migration.

## 1. The vice principal holds exactly the principal's permissions, inside their own school

**Ask.** «معاون باید دقیقاً همان توانایی‌های مدیر مدرسه را در مدرسهٴ خودش داشته باشد.» The organisation-level
catalogs were just made fixed for everyone, so nothing is left that a principal should do and a vice principal not.
This replaces the owner's round-2 rule (docs/decisions.md 2026-09-21, «Rule 3 — a vice principal defines students
and teachers, not vice principals») and the round-5 note «a vice principal keeps what they can act on».

**Change — the catalog only** (`scripts/catalog.ts`): both school managers take one list, `SCHOOL_MANAGER_PERMS`
(= every non-implicit permission, what `school_principal` already had). `pnpm seed` / the deploy's `seed` service is
authoritative (inserts the missing `role_permission` rows, deletes unlisted ones) and every request re-reads the
assignments, so existing vice principals gain the permissions on their next request after the deploy. The role row
is updated in place (same id), so no assignment moves. `allowed_scope_types` are unchanged.

| Permission | `school_principal` (unchanged) | `vice_principal` before | `vice_principal` after |
|---|---|---|---|
| `iam.admin.access` | ✓ | ✓ | ✓ |
| `iam.person.read` / `iam.person.write` | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ |
| **`iam.role_assignment.write`** | ✓ | — | **✓** |
| `iam.account.reset_password` / `iam.account.unlock` | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ |
| `tenancy.structure.read` | ✓ | ✓ | ✓ |
| **`tenancy.structure.write`** | ✓ | — | **✓** |
| `academic.enrollment.write` / `academic.teacher_assignment.write` | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ |
| `academic.timetable.read` / `.write` | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ |
| `academic.attendance.read` / `.write` / `.report` | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| `workspace.work_item.read/create/update/comment/assign_class` | ✓ | ✓ | ✓ |
| `notif.notification.read` | ✓ | ✓ | ✓ |
| **`integ.import.write`** | ✓ | — | **✓** |
| (count, `iam.account.self` is implicit) | 22 | 19 | 22 |

`org_admin`, `teacher`, `student`, `guardian_full`: unchanged (tests assert no admin/role/structure/import permission
leaked into the last three).

**What the three new permissions reach — own school only.**
- `iam.role_assignment.write` → appoint and revoke `vice_principal` at their school (`SCHOOL_GRANTABLE_ROLES`),
  including a fellow vice principal and their own vice role (as the principal can revoke vices). Never
  `school_principal` (`ORG_GRANTED_ROLES` needs the permission at the ORGANIZATION — FORBIDDEN), never `org_admin`
  (FORBIDDEN for everyone; the self-bootstrap branch `personId === ctx.personId` still asks the permission at the
  organization, which a school-scoped holder never has — pinned by a test for both managers), never at another school
  or for a person of another school (NOT_FOUND before any FORBIDDEN, nothing written).
- `tenancy.structure.write` → the school's details, classes, offerings (define + hours/status) and bell schedule.
  Never a new school (`createNeedsOrgScope`), never the organisation's درس‌ها (`orgOnly`), never another school's rows.
- `integ.import.write` → the CLI import into their own `--school`; `--create-subjects` needs `tenancy.structure.write`
  at the organization and stays organisation-admin only.

**Why nothing leaks beyond the school.** Reach is decided by the assignment's scope, never the role code: `canPure`
matches a school-scoped assignment only on chains through that school; `getAdminScope` is the caller's schools;
`personInScopeSql` hides other schools' people and every organization-scoped person. The only role-code branch left
is the emblem/title (`roleHatsFor`: «معاون» vs «مدیر مدرسه») — a label. A vice principal held at a BRANCH (an allowed
scope type no screen creates) gains nothing: it fails every school-level `can()` (grant, bells, import) and its admin
scope is its own school (pre-existing mapping).

**UI follows by permission, no code change needed:** the Home «زنگ‌بندی» tile, the school hub's «ویرایش مشخصات» /
«کلاس جدید», the periods editor's «ویرایش», «ارائهٴ درس جدید» and hours/status, the /admin/roles grant button.
Copy that named the principal alone was corrected (the two offering FORBIDDEN messages, the periods read-only line).

## 2. Roles are DISPLAY-ONLY on the staff pages; /admin/roles is the one door

**Ask.** «در صفحهٴ کارکنان نقش فقط نمایش داده شود» — nobody changes a colleague's role «وسط کار» from the staff
pages; role assignment lives on «نقش‌ها» only.

- `/admin/staff` rows and the school hub's staff rows (`StaffRow`) were already text-only — unchanged, now pinned by
  a render test (no select/button/input/form).
- Person page (`RolesCard`): the «افزودن نقش…» picker and the per-role «لغو» are gone; manager roles are neutral
  chips; a caller holding `iam.role_assignment.write` gets one line linking to «نقش‌ها». **Kept: «پایان تدریس»** on the
  teaching rows — it ends a teacher assignment (`academic.teacher_assignment.write`; the derived «دبیر» role follows)
  and is the only UI that ends an assistant/substitute assignment (the offering form edits the MAIN teacher only).
  Owner to confirm.
- New colleague (`/admin/staff/new`, `StaffForm`): the optional manager-role picker is gone, and `CreateStaffInput`
  lost its `roles` key — `.strict()` now refuses it, so the new-colleague request cannot grant a role even when hand
  made. The header tells a role-granting caller to give the role afterwards in «نقش‌ها». The service `createStaff`
  keeps `roles` (the pilot seed uses it, through the same `resolveRoleGrant`).
- `/admin/roles`: new primary action **«معاون جدید»** (school managers: one role, so only «همکار» — and the school when
  they hold two — is asked) / **«نقش جدید»** (organisation admin: role + school). `GrantRoleButton` + pure
  `grant-role-form.ts`; options are server-computed in `rolesPageQuery`: `roleGrantOptions` and the new
  `roleGrantCandidates` (active staff inside `personInScopeSql` — exactly who `assignRole` accepts; students never
  offered; grouped by primary school only under schools the caller covers). It submits the existing
  `assignRoleAction`, which re-runs the whole matrix. «لغو» (`RevokeRoleButton` / `revokeRoleAction`) unchanged. Page
  description and empty state now say roles are given and revoked here only.
- Removed as dead: `PersonDetail.roles[].revocable` and `getPersonDetail`'s `assignments` parameter (only the removed
  «لغو» read them), `roleGrant` from `peopleFormOptionsQuery` / `personDetailQuery`, the `RoleGrant` Zod object. Kept:
  `assignRoleAction`, `revokeRoleAction` (both used by /admin/roles), `endTeachingAction` («پایان تدریس»).
- /admin landing hints: «کارکنان» no longer promises «نقش مدیر/معاون»; «نقش‌ها» reads «دادن و لغو نقش مدیر و معاون هر مدرسه».

## 3. Tests

- `tests/unit/role-catalog.test.ts` (new): vice = principal = every role-carried permission, read from the catalog;
  `canPure` for EVERY permission — true on own school/branch/offering chains, false on school B, its branch and
  offerings, the organization and a student chain, for both; `canManageRole` for every role × {A, B, null} identical;
  `roleGrantOptions` identical and school-bounded; branch-scoped vice manages nothing; `resourceOpGate` parity on
  every resource shape; Home tiles identical («زنگ‌بندی» included); the title is the only difference.
- `tests/unit/role-grant-ui.test.ts` (new): staff row, roles card and new-colleague form render no role control; the
  grant dialog's shape per caller.
- `tests/int/admin-scope.test.ts`: permissions now read from the catalog; N1 rewritten as N1/V (both managers:
  principal/org-admin minting FORBIDDEN incl. self-bootstrap, nothing written; vice appoints vices at own school; other
  school or other school's person NOT_FOUND, nothing written); M1/M2 loop over both managers; M3 replaced by V
  (offerings define + hours/status, teacher set/swap/clear, classes, bells, import `can()`, all NOT_FOUND at S1); F3
  residual: vice revokes a fellow vice, FORBIDDEN on the principal's role, NOT_FOUND on S1's roles.
- `tests/int/seed.test.ts`: DB rows vice = principal; a DB holding the OLD vice rows is upgraded by the next seed,
  in place, idempotently. `tests/int/import.test.ts`: seeded mousavi (vice of B) imports into B, not G, nothing at
  the organization. `tests/int/admin-resource-form.test.ts`: the teacher-only split is tested on a synthetic role; the
  catalog principal and vice pass the same payload.
- Updated for the new truth: `tests/unit/{can,home-tiles,periods-editor,admin-gate}.test.ts`.

## 4. For the owner / a security review

- Pre-existing, now symmetric: a school manager can reset the password of another school manager of the same school
  (the person is in scope) and so act as them. Before this change a vice principal could use that to gain the
  principal's extra permissions; now the permissions are equal, but it stays an impersonation path between peers.
- Pre-existing: the SERVICE lets a school manager grant `vice_principal` to any in-scope person, a student included;
  the UI offers staff only (`roleGrantCandidates`). A server-side «staff only» check would close it. → **Closed in §5.**
- A vice principal can revoke a fellow vice principal and their own vice role (the principal cannot revoke a
  principal — that asymmetry is the owner's M2 rule, unchanged).

## 5. Verifier round (2026-09-27): manager roles go to active staff only; the admin help rewritten

**Manager roles → active colleagues only.** `assignRole` now refuses a MANAGER role (`school_principal`,
`vice_principal`, and the `org_admin` self-bootstrap) unless the person is an **active colleague**: a staff profile
with `left_on` null on an active person — exactly who `roleGrantCandidates` offers on /admin/roles. Anyone else — a
student, a guardian-only person, a colleague who has left, an archived person — gets VALIDATION with a field error on
`personId` («نقش مدیریتی فقط به کارکنان فعال داده می‌شود.», `MESSAGES.managerRoleNeedsStaff`); nothing is written.
Order: `resolveRoleGrant` (FORBIDDEN / NOT_FOUND for the school) → person in scope (NOT_FOUND) → this check, so it
only ever answers about a person the caller can already see in their own lists (no oracle). The `student` role is the
student's marker, not a manager role, and is unaffected. Every path that grants a manager role goes through it:
/admin/roles (`assignRoleAction`) and `createStaff` with `roles` (the demo and pilot seeds — their person gets a staff
profile first, so the seed tests stay green). The importer grants no manager role (staff are imported without roles).

Behaviour change: a colleague marked as left (`staff_profile.left_on`) can no longer be appointed until reinstated;
roles they ALREADY hold are not touched (offboarding revocation is out of scope — flag).

Tests: `tests/int/admin-scope.test.ts` «R» (principal and vice of S2 and the organization admin → a student: field
error, nothing written; `roleGrantCandidates` never listed them; a left colleague refused, reinstated → granted; the
`student` role still idempotent for the student).

**Admin help** (`src/app/(public)/help/page.tsx`, «ساختار مدرسه و کلاس‌ها را از کجا می‌سازم؟»): the answer no longer
sends admins to «چیپ‌های بالای صفحه» to create years, levels and grades (those pages are gone, the catalogs are fixed).
It now says the years/levels/grades are ready-made (پایه‌های اول تا دوازدهم در سه مقطع، سال جاری و سال بعد با
نوبت‌ها); the admin builds classes (grade from the list), sets the زنگ‌بندی on the school page, the offerings and the
«برنامهٴ هفتگی» on each class page, adds students and staff; the organization admin keeps the درس‌ها under
«مدرسه‌ها ← درس‌ها». Pinned by `tests/unit/help-copy.test.ts`.
