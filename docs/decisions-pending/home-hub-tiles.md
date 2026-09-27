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
- **Admin section pages have no «خانه» back link in hub mode**: `/admin/students`, `/staff`, `/classes`, `/roles`,
  and `/admin/schools` for the organization admin rely on the admin pill row (`AdminNav`, `isAdminSectionFor` in
  `ResourceListPage`). Whether they should get `back` is shell work.
- `/admin` («نمای کلی») and `/my-class/info` («کلاس من») lost their only Home door in H3; the pages still exist.
- Classic has the same «حضور و غیاب» ×2 label clash for a teaching principal (pre-existing); `altLabelFa` /
  `altIcon` are only set in `HUB_TILES`, so classic is left exactly as it was (apart from the two glyph changes).
