# Pending for docs/decisions.md — the «hub» layout trial (owner, 2026-09-27): the shell and the toggle (H1)

The owner wants to TRY a layout with no bottom nav, everything reachable from Home, the profile at the top start
and the notifications at the top end. It is an experiment, so it is **reversible and coexists with today's layout**:
both are built, the viewer switches at runtime. The Home tiles half of the trial is recorded separately in
`docs/decisions-pending/home-hub-tiles.md` (H2).

## The switch
- `src/lib/ui-variant.ts`: `getUiVariant()` reads the `donino-ui` cookie — `"hub"` only for that exact value,
  anything else (or no cookie) is `"classic"`. Server-only (it uses `cookies()` from `next/headers`).
- It is a per-viewer DISPLAY preference, not data: no table, no server action, no audit. Nothing about
  authorization depends on it (the proxy and `getRequestContext()` ignore it).
- **Toggle «ظاهر آزمایشی: همه‌چیز در خانه»** on «بیشتر», between the account links and «خروج»
  (`src/components/shell/UiVariantToggle.tsx`): a two-segment radio pair «کلاسیک / هاب», 44 px segments, the current
  one white with `primary-700` text. Choosing writes `donino-ui=<variant>; path=/; max-age=31536000; samesite=lax`
  and does a FULL load of `/home` — a soft `router.push` would keep the shared (app)/(admin) layouts and any shell
  the client router cached, so the frame would not switch (the one justified `eslint-disable` for
  `no-location-assign-relative-destination`). The client file mirrors the cookie name (`UI_VARIANT_COOKIE_NAME`)
  because it cannot import a `next/headers` module; a unit test keeps the two equal.
- The toggle is shown in both layouts (it is how a classic viewer opts in).

## «classic» (default) — unchanged
Same DOM and classes as before: `AppNav` (bottom bar + rail), the phone header (role mark + school name),
`pb-24` for the bottom bar, the admin pill row `lg:hidden`, `PageHeader` with no back link unless the page gives one,
the Home bell in the greeting.

## «hub»
- **No nav**: `AppShell` does not render `AppNav` at all (no bottom bar, no rail), and `<main>` drops the `pb-24`
  reserved for the bar (`pb-8` on every size).
- **One top bar on every size** (sticky, `bg-canvas/90` + blur, safe-area inset, 56 px / 64 px from `lg:`, full width):
  - START (right): the **profile button** (`src/components/shell/ProfileButton.tsx`) — a 44 px `surface-panel` circle
    with the first letter of the viewer's first name (the lucide `CircleUser` glyph when there is none),
    `aria-label="حساب من"`, linking to `/more`, which acts as the profile page.
  - END (left): the **bell** (`NotificationsBell`, same unread `CountBadge`).
  - No school-name box and no role mark; the school name stays only as the sr-only `<h1>`.
- **Home** draws no second bell (the greeting row's `PageHeader` actions and the phone `SchoolBanner` both skip it:
  `SchoolBanner bell={false}`), and takes no back link (`PageHeader back={false}`).
- **Every inner page leads back to Home**, implemented once in `PageHeader`: with no `back` prop, hub draws the
  `BackLink` «خانه» → `/home`. An explicit `back` wins; `back={false}` opts out (Home). A `hideTitle` header («کلاس من»)
  stays visible on phones in hub so the back link shows (its title stays sr-only). `/more` passes
  `back={{ href: "/home", label: "بازگشت" }}` in hub (none in classic).
- **/admin**: with no rail, the admin sections' pill row (`AdminNav everywhere`) shows from `lg:` too.
- Desktop: content is centred by `ContentWidth` as usual under the full-width top bar.

## How to switch back
- Per viewer: «بیشتر» → «ظاهر آزمایشی» → «کلاسیک» (or delete the `donino-ui` cookie).
- To end the trial for everyone: delete `UiVariantToggle` from «بیشتر» (classic is the default, so every viewer
  without the cookie is already classic; a stale `hub` cookie can be neutralised by making `getUiVariant()` return
  `"classic"`). To adopt hub for everyone instead: make the default `"hub"`.

## Tests
- `tests/unit/hub-shell.test.ts` — nav in classic and not in hub; hub top bar: profile → /more before the bell,
  badge, initial / `CircleUser` fallback; no school-name box in hub; `PageHeader` default «خانه» back in hub only,
  explicit `back` wins, `back={false}` opts out, `hideTitle` stays visible in hub; `SchoolBanner` bell on/off.
- `tests/unit/ui-variant.test.ts` — `getUiVariant` cookie parsing; the toggle writes the cookie; the client/server
  cookie names agree; the radio pair's labels, checked state and 44 px segments.

## Open questions for the owner
- In hub, admin sub-pages without their own `back` go to «خانه», not to «مدیریت» (the pill row covers the sections).
  Should they default to `/admin` instead?
- `/help`, `/privacy`, `/change-password` are public-shell pages with their own `PublicBackLink`; unchanged.
