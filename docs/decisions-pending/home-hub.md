# Pending for docs/decisions.md — the «hub» layout (owner, 2026-09-27): the shell, the switch and Home (H1 + H3)

The owner tried a layout with no bottom nav, everything reachable from Home, the profile at the top start and the
notifications at the top end — first as a per-viewer trial beside today's layout (H1, H2), then **adopted it as THE
layout for everyone** with a round of edits (H3, below). The Home tiles are recorded separately in
`docs/decisions-pending/home-hub-tiles.md`.

## The switch — hub for everyone (H3)
- `src/lib/ui-variant.ts`: `getUiVariant()` **returns `"hub"` unconditionally**. It no longer reads the trial's
  `donino-ui` cookie, so a leftover `donino-ui=classic` from testing is ignored — everyone gets the hub, nobody can
  switch. It is a display choice, not data: no table, no action, no audit; authorization never depends on it.
- The **«ظاهر آزمایشی» toggle is gone** from «بیشتر» (`UiVariantToggle.tsx` deleted; it only wrote the cookie).
- **The classic code path is kept on purpose** so the change can be reverted in code: `AppShell` (AppNav + the
  phone header), `PageHeader` (no default back link), `homeTilesFor` → `HOME_TILES`, Home's classic greeting
  (`SchoolBanner` + the `PageHeader` row), the «امروز» line (`TodayStrip`) and the «تکالیف نزدیک» card
  (`NearbyCard`) all still branch on the variant. **To revert: make `getUiVariant()` return `"classic"`** — that
  one function, nothing else. (A per-viewer switch would need the cookie read and a toggle again.)

## «hub» — the shell
- **No nav**: `AppShell` does not render `AppNav` at all (no bottom bar, no rail), and `<main>` drops the `pb-24`
  reserved for the bar (`pb-8` on every size).
- **One top bar on every size** (sticky, `bg-canvas/90` + blur, safe-area inset, 56 px / 64 px from `lg:`). The
  background spans the viewport; the two controls sit on the **content column** — an inner row with exactly
  `ContentWidth`'s cap and gutters (`mx-auto w-full max-w-content px-4 lg:px-8`), so on a wide screen they line up
  with the page's edges, not the window's (H3):
  - START (right): the **profile button** (`src/components/shell/ProfileButton.tsx`) — a 44 px `surface-panel`
    circle with the lucide **`UserRound`** person glyph (H3: an icon, not the first-name initial),
    `aria-label="حساب من"`, linking to `/more`, which acts as the profile page (password, help, privacy, logout).
  - END (left): the **bell** (`NotificationsBell`, same unread `CountBadge`).
  - No school-name box and no role mark in the bar; the school name is the sr-only `<h1>` and, on Home, a meta line
    of the greeting card (below).
- **Every inner page leads back to Home**, implemented once in `PageHeader`: with no `back` prop, hub draws the
  `BackLink` «خانه» → `/home`. An explicit `back` wins; `back={false}` opts out. A `hideTitle` header («کلاس من»)
  stays visible on phones in hub so the back link shows (its title stays sr-only). `/more` passes
  `back={{ href: "/home", label: "بازگشت" }}`.
- **/admin**: with no rail, the admin sections' pill row (`AdminNav everywhere`) shows from `lg:` too.

## «hub» — Home (H3)
- **The greeting is ONE card** on every size (`src/components/home/HubGreeting.tsx`, `surface-work` — the white
  card lifts off the canvas the way the tiles' clay marks do, and with the «تکالیف نزدیک» card gone it is the
  view's one white work surface on phones): «سلام، <first name>» (`text-title`), today's Jalali weekday + date
  (`formatJalaliWeekdayDate`), and the **school name as a muted meta line** — the hub hides it everywhere else and
  the separate school-name box is gone, but which school you are in still matters. The name follows the shell's
  rule: an admin whose scope holds several schools is introduced by the organization. Static (no link, no hover).
- **No «امروز» sentence** (`TodayStrip`, e.g. «۲ تسک عقب‌افتاده») and **no «تکالیف نزدیک» / «تسک‌های نزدیک»
  card** on phones or desktop: «پنل من» is a tile and opens the list (`HomeGrid` and `HomeDashboard` skip the
  card when `resolveHomeTiles().variant` is hub). The desktop board keeps its role panels beside the tiles
  (teacher: «امروز تدریس دارم», «کلاس‌های من», «نیاز به پیگیری»; student: «امروز», «این هفته»).
- No second bell and no back link on Home; no `PageHeader` on hub Home at all (the card IS the header, so the
  desktop context bar «مدرسه · سال · نوبت · date» is not drawn there — the card carries school and date).

## «classic» — kept, unreachable without a code change
Same DOM and classes as before the trial: `AppNav` (bottom bar + rail), the phone header (role mark + school name),
`pb-24` for the bottom bar, the admin pill row `lg:hidden`, `PageHeader` with no back link unless the page gives one,
the Home bell in the greeting (`SchoolBanner`, which lost its trial-only `bell` prop), the «امروز» line and the card.

## Help
`src/app/(public)/help/page.tsx` describes the hub: a new first answer «هر بخش کجاست؟» (no bottom bar; every place
an icon on Home; «خانه» at the top of each page; the person icon top-right → account: password, help, privacy,
logout; the bell top-left → «اعلان‌ها»), and every answer that pointed at a retired door («بیشتر ←», the «تکالیف
نزدیک» card, «همهٴ تکالیف», «کلاس من», «مدیریت») now names the Home icon instead.

## Tests
- `tests/unit/ui-variant.test.ts` — `getUiVariant()` is hub for every cookie value and never reads the cookie;
  «بیشتر» has no toggle and the toggle file is gone.
- `tests/unit/hub-shell.test.ts` — hub is the default of the suite; no nav / rail / `pb-24` in hub, nav in classic;
  the top bar: profile → /more before the bell, badge, the `UserRound` glyph (never the initial), controls on the
  content column (same classes as `ContentWidth`); no school-name box; `PageHeader` default «خانه» back in hub only,
  explicit `back` wins, `back={false}` opts out, `hideTitle` stays visible in hub; the classic banner's bell.
- `tests/unit/hub-home.test.ts` — the default Home (the real `getUiVariant()`): `HubGreeting` first, then the grid
  and the board; no `TodayStrip`, `SchoolBanner`, `PageHeader`, second bell or `NearbyCard`; `HomeGrid` /
  `HomeDashboard` draw no card for any hat; the greeting card's markup (surface-work, name, date, school meta line,
  static), the organization for a multi-school admin or a session with no school.
- `tests/unit/help-copy.test.ts` — the «هر بخش کجاست؟» answer and no retired door in the guide.

## Open questions for the owner
- In hub, admin sub-pages without their own `back` go to «خانه», not to «مدیریت» (the pill row covers the sections).
- The /admin overview («نمای کلی») has no door in hub any more (its tile was removed — see home-hub-tiles.md). An
  admin who types /admin still gets it. Keep it reachable (e.g. a link on «مدرسه»), or retire it?
- `/my-class/info` («کلاس من»: the class card + counts) has no door in hub any more (the tile was removed). Keep the
  page for a later link, or delete it?
