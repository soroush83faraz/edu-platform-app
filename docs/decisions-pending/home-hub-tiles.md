# Pending for docs/decisions.md — «hub» layout, the Home tiles: every former nav destination is a Home tile (owner, 2026-09-27)

The hub is everyone's layout now (`src/lib/ui-variant.ts`: `getUiVariant()` returns `"hub"`; the classic list stays
in code for a revert — see `docs/decisions-pending/home-hub.md`). This note covers the Home tiles: H2 built them,
H3 (the owner's adoption round) reordered them, dropped two and changed three glyphs.

## The ask
No bottom nav: the role item that sat at the bottom right — «کلاس من» (student), «کلاس‌ها» (teacher), «مدیریت»
(admin) — disappears, and each thing it held becomes its own icon on Home, so the person finds everything there.

## What changed
- `src/lib/modules-registry.ts`: a second list, **`HUB_TILES`**, beside the classic `HOME_TILES`.
  `homeTilesFor(hats, has, { variant })` picks `HUB_TILES` for `variant: "hub"` and `HOME_TILES` otherwise (the
  third argument is optional; omitted = classic). `resolveHomeTiles` (`src/components/home/home-data.ts`) reads
  `getUiVariant()` and passes it — the phone grid (`HomeGrid`) and the desktop board (`DashboardTiles`) both render
  whatever it returns. In hub nothing sits under the tiles (no «تکالیف نزدیک» card — H3).
- The desktop board's own links follow the variant too (`HomeTiles.variant`): in hub, «امروز» / «امروز تدریس
  دارم» open `/my-class/timetable` / `/classes/timetable` for the week, and «همهٴ کلاس‌ها» opens
  `/classes/offerings` — pages with a way back, instead of the full nav pages. Classic links unchanged.
- Three small tile fields, used by the hub list only: `exceptRole` (hide the tile when the person ALSO wears that
  hat), `altLabelFa` (the label to use when another tile the same person sees already has this label) and — H3 —
  `altIcon` (the glyph to use when another tile the same person sees already draws this glyph).
- Admin section tiles are built from `ADMIN_SECTIONS` (`src/lib/admin/nav.ts`), so their label, glyph and href
  stay in the one list; they are gated by `iam.admin.access`, as the /admin layout is.

## Dedicated pages (no duplicated logic)
A place that was a SECTION of a page opens a small page of its own that draws exactly that section. The sections
were lifted out of the full pages into shared parts, and the full pages now compose the same parts (identical
markup), so classic renders exactly as before:
- `src/components/my-class/MyClassParts.tsx` — `MyClassCard`, `MyClassFacts`, `MyWeek`, `MySubjectsList`,
  `NoClassYet` (+ `myWeekHasSlots`). Used by `/my-class` and by `/my-class/timetable` «برنامهٴ هفتگی»,
  `/my-class/subjects` «درس‌ها و دبیران» and `/my-class/info` «کلاس من» (the class card + the counts — no tile
  since H3, see open questions).
- `src/components/classes/ClassesParts.tsx` — `ClassesActions`, `TeachingWeek`, `OfferingsGrid`, `NoOfferingsYet`
  (+ `offeringsSummaryFa`, `hasTeachingWeek`). Used by `/classes` and by `/classes/offerings` «کلاس‌های من» and
  `/classes/timetable` «برنامهٴ هفتگی».
- Each new page: `ContentWidth` → `PageHeader` with `back={{ href: "/home", label: "خانه" }}` → the section. A
  student who lands on a `/classes/*` page is sent to the matching `/my-class/*` page, as `/classes` sends them to
  `/my-class`.

## The hub tile list per role (H3, the owner's order; grid order, RTL: first = right)
- **Student:** پنل من · برنامهٴ هفتگی (`/my-class/timetable`) · درس‌ها و دبیران (`/my-class/subjects`) · حضور و غیاب.
- **Teacher:** پنل من · کلاس‌های من (`/classes/offerings`) · برنامهٴ هفتگی (`/classes/timetable`) · حضور و غیاب.
- **Principal / vice principal of ONE school:** پنل من · مدرسه (`/admin/schools/<id>`) · دانش‌آموزان · کارکنان ·
  کلاس‌ها · نقش‌ها · برنامهٴ کلاسی (`/admin/schools/<id>/periods`) · حضور و غیاب (`/admin/attendance`).
- **Organization admin, or a school admin of several schools:** پنل من · مدرسه‌ها (`/admin/schools`) · دانش‌آموزان ·
  کارکنان · کلاس‌ها · نقش‌ها · حضور و غیاب. **No «برنامهٴ کلاسی»**: a bell schedule belongs to ONE school and has no
  organization-wide page — they reach it through «مدرسه‌ها» → the school → زنگ‌بندی (unchanged rule).
- **Multi-hat:** the union in the order student → teacher → admin, «حضور و غیاب» last, no destination, label or
  glyph twice:
  - a teaching principal: پنل من · کلاس‌های من · برنامهٴ هفتگی · مدرسه · دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها ·
    برنامهٴ کلاسی · حضور و غیاب (the roll call) · **گزارش حضور و غیاب** (the admin report, `altLabelFa`);
  - a student who also teaches gets ONE «برنامهٴ هفتگی» — the teaching week; the class week steps aside
    (`exceptRole: "teacher"`), mirroring `navRoleFor`'s teacher > student.
- **Removed in H3:** the student's «کلاس من» (`/my-class/info`) and the admins' «نمای کلی» (`/admin`).
- «مدرسه‌ها» / «مدرسه»: ONE tile for every admin scope in hub (classic gives it to school-scoped admins only,
  because the organization admin has the «مدرسه‌ها» section in the nav — which hub does not have).

## Glyphs (H3) — no two tiles a person sees share one
- «پنل من» `Inbox` · «برنامهٴ هفتگی» `CalendarDays` · «درس‌ها و دبیران» `BookOpen` · «مدرسه/مدرسه‌ها» `School` ·
  «دانش‌آموزان» `GraduationCap` · «کارکنان» `UsersRound` · «نقش‌ها» `ShieldCheck` · «حضور و غیاب» `UserCheck`.
- **«برنامهٴ کلاسی» → `AlarmClock`** (was `Clock`): the bell schedule is time AND bell; `BellRing` was rejected
  because the notifications bell sits in the top bar of the same screen. (Changed in `HOME_TILES` too.)
- **«کلاس‌ها» (admin) → `Presentation`** (the classroom board; was `Users`, which read as a crowd of people beside
  «کارکنان»). Changed at the source, `ADMIN_SECTIONS` in `src/lib/admin/nav.ts`, so the /admin pill row, the rail
  and the overview draw the same glyph.
- **«کلاس‌های من» (teacher) → `Presentation`** as well — the same idea, a class; for a person who ALSO has the
  admin «کلاس‌ها» tile it switches to **`Lectern`** (`altIcon`: their own teaching, at the lectern).
- The admin's attendance report keeps `UserCheck` alone, and switches to **`ClipboardList`** (`altIcon`) beside
  the roll-call tile, where it also reads «گزارش حضور و غیاب».

## Tests
- `tests/unit/home-tiles.test.ts` — the «hub layout» block: the exact labels and hrefs per role (student, teacher,
  org admin, one- and two-school principal, the vice principal), «حضور و غیاب» last for every role, no «کلاس من»
  / «نمای کلی», the admin-hat gate, the multi-hat union order and label de-duplication, the chosen glyphs and the
  `altIcon` swaps, per-person unique hrefs, labels AND glyphs (multi-hat personas included), that classic
  (no options / `variant: "classic"`) is unchanged, and that each section page uses `ContentWidth` + the back to
  `/home` while the full pages still draw the shared parts.
- `tests/unit/admin-nav.test.ts` — the one-door rule made variant-aware: classic unchanged (sections and tiles never
  overlap); hub: every section the person has is exactly one tile, except the overview, which has none.
- `tests/unit/hub-home.test.ts` — no card under the tiles in hub, on phones or the desktop board.

## Open questions / follow-ups
- **Correction (2026-09-27): admin section pages DO get a «خانه» back link in hub mode.** `ResourceListPage`
  computes `back` as `undefined` for `/admin/students`, `/staff`, `/classes`, `/roles`, and `/admin/schools` (for
  the organization admin) — relying on the admin pill row (`AdminNav`, `isAdminSectionFor`) as their way around in
  classic. But `PageHeader` treats an `undefined` `back` as "give the hub default": in hub it draws its own «خانه»
  → `/home` link whenever the caller passes no explicit `back` (see `PageHeader`'s own doc comment and
  `tests/unit/hub-shell.test.ts`). So in hub every one of those pages already has a «خانه» door, on top of the
  pill row — no shell work is needed here.
- `/admin` («نمای کلی») and `/my-class/info` («کلاس من») lost their only Home door in H3; the pages still exist.
- Classic has the same «حضور و غیاب» ×2 label clash for a teaching principal (pre-existing); `altLabelFa` /
  `altIcon` are only set in `HUB_TILES`, so classic is left exactly as it was (apart from the two glyph changes).

## Organisation admin: the organisation is the context; attendance per school; «به‌زودی» for them only (2026-09-27)
Owner (organisation admin): «Why does the box at the top say «علامه طباطبایی»? The organisation admin is ABOVE the
school.» — and «attendance separate for each school; not on the organisation admin's Home any more».
- **One rule for «where am I»** — `contextPlaceFa` / `contextLineFa` (`src/lib/context-place.ts`). The organisation
  admin's context is the ORGANISATION: the Home greeting card reads «مدیر سازمان · <organisation>», the «حساب من»
  profile card, the shell title (`AppShell`, sr-only h1 / classic nav) and the `PageHeader` desktop context bar
  («<organisation> · <year>», plus the «۲ مدرسه» chip when there are several; no school, no branch, no نوبت) — even
  in a one-school organisation, and even when they also teach (their teaching pages keep class/school details).
  The shell context (`getShellContext`) now carries `orgScoped` + `orgName`; the rule also falls back to the pure
  `isOrganizationAdmin(ctx.assignments)` so a failed shell read never shows the primary school. Principals/vice
  principals/teachers/students keep their school — and a principal now reads THEIR scope school (the shell's), not
  the organisation's primary one (`ctx.schoolName`), which was a latent mismatch for a principal of a second school.
- **Attendance per school.** The admin «حضور و غیاب» tile is `adminScope: "school"`: gone from the organisation
  admin's Home (classic and hub), kept for principals/vice principals (one or several schools); teachers/students
  keep their `/attendance` tile. The school hub (`/admin/schools/[id]`) has a «حضور و غیاب» row beside «برنامهٴ
  کلاسی» (one card, same row style) → `/admin/attendance?school=<id>`, shown when the viewer holds
  `academic.attendance.report` (the report's own permission). Shown on a principal's own hub too: a harmless second
  door next to their Home tile — the one-door tests govern Home tiles, and the hub should read the same for every
  admin who opens it.
- **`/admin/attendance?school=`**: server-side (`attendanceReportReach`, `src/modules/academic/attendance-report.ts`)
  — checked against the admin scope (a school manager only their own school, the org admin any school of the org;
  another school / another tenant's / unknown → 404), and the class picker, «امروز ثبت نشده», the class (must be
  one of that school's) and the student drill-down (must be on that class's report) are all narrowed to it. The
  title reads «حضور و غیاب · <school>», the back link returns to that school's hub, the form carries the filter.
- **«به‌زودی» on Home for the organisation admin only** (`showUpcomingOnHome(hats)` replaces the global
  `SHOW_UPCOMING_ON_HOME = false`): drawn after all their live tiles on phones (`HomeGrid`) and the desktop board
  (`DashboardTiles`); an org admin who also teaches still sees it (with the teacher's upcoming modules too);
  principals, vice principals, teachers and students get none.
- Tests: `tests/unit/org-context.test.ts` (the rule + the PageHeader bar, org admin vs principal),
  `hub-home.test.ts` (greeting), `profile-page.test.ts` (profile card), `home-tiles.test.ts` (no attendance tile
  for the org admin; `showUpcomingOnHome`), `home-courses.test.ts` (upcoming per viewer),
  `school-hub-attendance.test.ts` (the hub row + href), `tests/int/attendance.test.ts` (the school filter narrows
  the reads; out-of-scope / other-tenant / unknown → NOT_FOUND).
- Owner, 2026-09-27 (later): «به‌زودی» on Home for every admin — organization admin, principal, vice principal; teachers and students still don't see it (`showUpcomingOnHome` = `hats.isAdmin`).
