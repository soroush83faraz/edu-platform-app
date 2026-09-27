# Pending for docs/decisions.md — nav round 2026-09-27 (owner): three nav items, the کارتابل from Home, the back pill

Reverses the part of the 2026-09-27 UX review that made «پنل من» a fourth nav cell.

## Nav: three items, no «پنل من»
- Phone bottom bar AND desktop rail, every role, RTL DOM order: **role item · «خانه» · «بیشتر»** — the role item on
  the right («کلاس من» student / «کلاس‌ها» teacher / «مدیریت» admin / «راهنما» with no hat; multi-hat unchanged:
  `navRoleFor`, admin > teacher > student), «خانه» in the middle (still the bigger bare house glyph), «بیشتر» on the
  left. Three columns, the sliding tinted cell is a third wide. `src/components/shell/AppNav.tsx`.
- The nav carries **no unread badge** any more (it rode on «پنل من»); the bell on Home keeps its badge.
- On `/inbox*` no nav cell is current (the sliding cell fades out, as on `/change-password`).
- `/inbox` now has `PageHeader back={{ href: "/home", label: "خانه" }}` — it is an inner page reached from Home.

## The کارتابل's one door: the Home card
- `/inbox` is reached from Home's «تکالیف نزدیک» / «تسک‌های نزدیک» card and its «همهٴ …» link — not a nav cell, not
  a tile. `NearbyCard` is rendered for every hat holding `workspace.work_item.read`, on phones (`HomeGrid`) and on
  the desktop dashboard (`HomeDashboard`) alike. Guarded by `tests/unit/home-inbox-door.test.ts`; the one-door tile
  tests in `tests/unit/home-tiles.test.ts` still forbid an /inbox tile.

## Desktop rail
- The «دانینو» wordmark and monogram left the top of the rail (owner: clutter). The rail opens with the school line
  only — the role mark (`RoleMark tone="line"`) and the school/organization name. `AppNav` lost its `productName`
  prop. The product still introduces itself on the auth pages and `/~offline`.

## Desktop Home layout (`HomeDashboard`)
Every board opens the same way: the tiles, and UNDER them the tasks card, full width of that column. The work column
is `TwoColumn`'s main (7 tracks, start/right side; `asideWidth="wide"`), the role panels sit in the 5-track aside.
- Teacher — main: tiles (4 cols, 6 from `xl:`) → «تکالیف نزدیک» → «نیاز به پیگیری»; aside: «امروز تدریس دارم» →
  «کلاس‌های من».
- Student — main: tiles → «تکالیف نزدیک»; aside: «امروز» (today's زنگ‌ها) → «این هفته».
  **«فوری‌ها» (`UrgentItems`) was removed**: it listed the same overdue/due-today rows the card now leads with,
  twice on one screen, and its trailing link was a second «پنل من» door.
- Everyone else (admins): one column, full width — tiles (6 cols, 8 from `xl:`) → «تسک‌های نزدیک».
- `DashboardAside.tsx` → `DashboardTiles.tsx` (`DashboardTiles`, `MyClassesCompact`); `DashboardSkeleton` follows
  the 7 + 5 shape.

## Back control («بازگشت»)
- One `BackLink` (`src/components/layout/BackLink.tsx`) draws `PageHeader`'s `back` and `PublicBackLink`: a quiet
  pill — `ChevronRight` + label in `text-primary-700 font-semibold text-sm`, `bg-surface-sunken` with a
  `ring-primary-100` hairline, `rounded-full`, 44 px (`min-h-11`) on every breakpoint (the desktop `lg:min-h-9` is
  gone), hover `primary-50`. Never a filled button, so it does not compete with the page's one primary action.

## Help
- `/help` no longer names «پنل من» as a destination: the student and teacher answers point to «تکالیف نزدیک» in خانه
  and its «همهٴ تکالیف» (the فهرست تکالیف). «بیشتر ← راهنما» hint: «ورود، تکالیف، مدیریت».

## «پنل من» returns as a Home tile (owner, 2026-09-27)
- Partial reversal, same day: the owner asked for «پنل من» back as a Home TILE, beside «حضور و غیاب» — the two
  side by side as the first tiles, in that order (RTL: «پنل من» to the right of «حضور و غیاب»). It is shown to
  every student, teacher and admin holding `workspace.work_item.read` (`HOME_TILES` in `src/lib/modules-registry.ts`,
  code `inbox`, href `/inbox`, `Inbox` glyph).
- The nav itself is UNCHANGED — still the three items above; this is a tile only, not a fourth nav cell.
- The کارتابل now has two accepted doors: this tile and the «همهٴ …» link of Home's «تکالیف نزدیک» card. The
  owner was asked and accepts both; the Home card and its link are untouched.
- Guarded by `tests/unit/home-tiles.test.ts` (tile presence, order, permission gate) and left alone by
  `tests/unit/home-inbox-door.test.ts` (the card's door, which still exists unmodified).

## Open questions for the owner
- The `/inbox` page is still TITLED «پنل من» (and its detail/new pages' back links say «پنل من»). Reaching it via
  «همهٴ تکالیف» and landing on «پنل من» is a small naming seam; renaming the page title (e.g. to «تکالیف» /
  «تسک‌ها» by voice) was not requested and is left as is. CLAUDE.md's vocabulary line «the nav label stays «پنل من»»
  is now stale (there is no such nav label) and should be reworded when this note is merged.
