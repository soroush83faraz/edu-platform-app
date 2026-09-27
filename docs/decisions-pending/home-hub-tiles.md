# Pending for docs/decisions.md — «hub» layout, part H2: every former nav destination is a Home tile (owner trial, 2026-09-27)

EXPERIMENTAL and fully reversible. The switch is `src/lib/ui-variant.ts` (`getUiVariant()`, cookie `donino-ui`;
`"hub"` only when the cookie says so, `"classic"` otherwise). The shell side (no bottom nav / rail, the profile +
notifications top bar, the «ظاهر آزمایشی» toggle) is part H1; this note covers the Home tiles only.

## The ask
No bottom nav: the role item that sat at the bottom right — «کلاس من» (student), «کلاس‌ها» (teacher), «مدیریت»
(admin) — disappears, and each thing it held becomes its own icon on Home, so the person finds everything there.

## What changed
- `src/lib/modules-registry.ts`: a second list, **`HUB_TILES`**, beside the classic `HOME_TILES`.
  `homeTilesFor(hats, has, { variant })` picks `HUB_TILES` for `variant: "hub"` and `HOME_TILES` otherwise (the
  third argument is optional; omitted = classic, so every existing caller and test is unchanged).
  `resolveHomeTiles` (`src/components/home/home-data.ts`) reads `getUiVariant()` and passes it — the phone grid
  (`HomeGrid`) and the desktop board (`DashboardTiles`) both render whatever it returns. The tasks card stays
  under the tiles, unchanged.
- The desktop board's own links follow the variant too (`HomeTiles.variant`): in hub, «امروز» / «امروز تدریس
  دارم» open `/my-class/timetable` / `/classes/timetable` for the week, and «همهٴ کلاس‌ها» opens
  `/classes/offerings` — pages with a way back, instead of the full nav pages. Classic links unchanged.
- Two small tile fields, used by the hub list only: `exceptRole` (hide the tile when the person ALSO wears that
  hat) and `altLabelFa` (the label to use when another tile the same person sees already has this label).
- Admin section tiles are built from `ADMIN_SECTIONS` (`src/lib/admin/nav.ts`), so their label, glyph and href
  stay in the one list; they are gated by `iam.admin.access`, as the /admin layout is.

## Dedicated pages (no duplicated logic)
A place that was a SECTION of a page opens a small page of its own that draws exactly that section. The sections
were lifted out of the full pages into shared parts, and the full pages now compose the same parts (identical
markup), so classic renders exactly as before:
- `src/components/my-class/MyClassParts.tsx` — `MyClassCard`, `MyClassFacts`, `MyWeek`, `MySubjectsList`,
  `NoClassYet` (+ `myWeekHasSlots`). Used by `/my-class` and by:
  - `/my-class/timetable` «برنامهٴ هفتگی» (the class week; `myTimetableQuery`)
  - `/my-class/subjects` «درس‌ها و دبیران» (`myClassQuery`)
  - `/my-class/info` «کلاس من» — the class card + the هم‌کلاسی‌ها / درس‌ها counts. There is **no classmates
    list** in phase 1 (only the count), so the tile is the class-info destination, named «کلاس من».
- `src/components/classes/ClassesParts.tsx` — `ClassesActions`, `TeachingWeek`, `OfferingsGrid`, `NoOfferingsYet`
  (+ `offeringsSummaryFa`, `hasTeachingWeek`). Used by `/classes` and by:
  - `/classes/offerings` «کلاس‌های من» (the درس cards + the page actions «حضور و غیاب» / «تکلیف جدید»)
  - `/classes/timetable` «برنامهٴ هفتگی» (the teaching week)
- Each new page: `ContentWidth` → `PageHeader` with `back={{ href: "/home", label: "خانه" }}` → the section. A
  student who lands on a `/classes/*` page is sent to the matching `/my-class/*` page, as `/classes` sends them to
  `/my-class`.

## The hub tile list per role (grid order; RTL: first = right)
- **Student:** پنل من · حضور و غیاب · برنامهٴ هفتگی (`/my-class/timetable`, CalendarDays) · درس‌ها و دبیران
  (`/my-class/subjects`, BookOpen) · کلاس من (`/my-class/info`, Backpack).
- **Teacher:** پنل من · حضور و غیاب · کلاس‌های من (`/classes/offerings`, Presentation) · برنامهٴ هفتگی
  (`/classes/timetable`, CalendarDays).
- **Organization admin:** پنل من · حضور و غیاب (`/admin/attendance`) · دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها ·
  مدرسه‌ها (`/admin/schools`) · نمای کلی (`/admin`, LayoutGrid).
- **Principal / vice principal of ONE school:** پنل من · حضور و غیاب · دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها ·
  مدرسه (`/admin/schools/<id>`) · برنامهٴ کلاسی (`/admin/schools/<id>/periods`) · نمای کلی.
- **School admin of several schools:** as above with «مدرسه‌ها» (`/admin/schools`) and no «برنامهٴ کلاسی».
- **Multi-hat:** the union, in the order student → teacher → admin, no destination twice and no label twice:
  - a teaching principal gets «حضور و غیاب» (the roll call) AND the report, which then reads **«گزارش حضور و
    غیاب»** (`altLabelFa`);
  - a student who also teaches gets ONE «برنامهٴ هفتگی» — the teaching week; the class week steps aside
    (`exceptRole: "teacher"`), mirroring `navRoleFor`'s teacher > student.
- Order rule: most frequent first («پنل من», «حضور و غیاب»), then the role tiles; admins' people and classes before
  the structure («مدرسه»/«مدرسه‌ها», «برنامهٴ کلاسی»), the overview last.
- «مدرسه‌ها» / «مدرسه»: ONE tile for every admin scope in hub (classic gives it to school-scoped admins only,
  because the organization admin has the «مدرسه‌ها» section in the nav — which hub does not have).

## Tests
- `tests/unit/home-tiles.test.ts` — a «hub layout» block: the exact list per role (student, teacher, org admin, one-
  and two-school principal), the admin-hat gate, multi-hat union and label de-duplication, per-person unique
  hrefs AND labels, that classic (no options / `variant: "classic"`) is unchanged for every hat, and that each new
  page uses `ContentWidth` + the back to `/home` while the full pages still draw the shared parts. The classic
  «no tile is a second door to a nav destination» test is now explicitly the classic rule.
- `tests/unit/admin-nav.test.ts` — the one-door rule made variant-aware: classic unchanged (sections and tiles never
  overlap); hub: every section the person has is exactly one tile (no nav, so the tiles are the doors).

## Open questions / follow-ups
- **Admin section pages have no way back in hub mode.** `/admin/students`, `/staff`, `/classes`, `/roles`, the
  overview, and `/admin/schools` for the organization admin, show no «خانه» back link — they rely on the nav /
  rail / the phone pill row (`AdminNav`, `isAdminSectionFor` in `ResourceListPage`). Whether the pill row stays
  in hub and whether those pages get `back` is shell work (H1) and was not touched here.
- The overview tile is labelled «نمای کلی» (the section's own name in `nav.ts`); on Home it may read vaguely —
  «مدیریت» or «نمای مدرسه» are alternatives for the owner.
- Classic has the same «حضور و غیاب» ×2 label clash for a teaching principal (pre-existing); `altLabelFa` is only
  set in `HUB_TILES`, so classic is left exactly as it was.
