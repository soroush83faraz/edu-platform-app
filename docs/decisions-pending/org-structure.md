## 2026-09-27 — organisation structure: no «تنظیمات زیرساختی», a fixed مقطع/پایه/سال catalog, «مدرسه‌ها» first, people on the school hub

Owner, five asks for the organisation admin («مدیر سازمان») and the admin area. To be folded into docs/decisions.md.

- **«تنظیمات زیرساختی» is gone.** `/admin/infrastructure` (page, nav entry, landing row, hint) is deleted. The old
  URLs `/admin/infrastructure`, `/admin/years`, `/admin/terms`, `/admin/levels`, `/admin/grades` redirect to
  `/admin` (a `RETIRED` set in `src/app/(admin)/admin/[resource]/page.tsx` — an old bookmark lands on the hub, not on
  «پیدا نشد»). `yearResource`, `termResource`, `levelResource` and `gradeResource` are removed from `RESOURCES`, so
  `adminResourceMutate` / `MutateInput` refuse them outright (zod enum) — the UI AND the server action lose the
  write path. The tenancy services (`createAcademicYear`, `createGradeLevel`, `deleteGradeLevel`, …) stay: seeds,
  the importer and `ensureCatalogYears` use them, and nothing reaches them from a request any more.
- **The fixed catalog** lives in `src/modules/tenancy/fixed-catalog.ts` (import-free data): مقطع‌ها `ELEM` «دبستان»,
  `SEC1` «متوسطهٴ اول», `SEC2` «متوسطهٴ دوم» (sequence 1–3); پایه‌ها `G1`…`G12` «اول»…«دوازدهم», sequence 1–12,
  1–6 → دبستان, 7–9 → متوسطهٴ اول, 10–12 → متوسطهٴ دوم; years «۱۴۰۵-۱۴۰۶» (2026-09-23…2027-06-21, current, نوبت اول
  …2027-01-20 / نوبت دوم 2027-01-21…) and «۱۴۰۶-۱۴۰۷» (2027-09-23…2028-06-20, نوبت اول …2028-01-20 / نوبت دوم
  2028-01-21…; dates from date-fns-jalali: ۱ مهر / ۳۰ دی / ۱ بهمن / ۳۱ خرداد). Codes are the ones the seeds, the
  pilot and the int fixtures already used (ELEM/SEC1/SEC2, G1…G12), so existing rows are REUSED.
- **Writer:** `ensureOrgCatalogWith(q, orgId)` / `seedOrgCatalogsWith(q)` in `scripts/catalog.ts` (pg-only; one
  transaction per organization with `set_config('app.current_org_id')` for FORCE RLS; every write has its audit
  row, actor NULL, `request_id = 'seed-catalog'`). Matching, two passes: a row whose CODE is a fixed code belongs to
  that entry; otherwise the first unclaimed row whose name matches the entry or an alias (ezafe ٴ/ٔ, ZWNJ, spaces,
  Arabic ي/ك folded — «ابتدایی» → دبستان, «متوسطه اول» → متوسطهٴ اول, «پایه دهم» → دهم). A match is brought to the
  fixed name / sequence / مقطع (update + audit); a missing entry is inserted. Years per school, matched by the
  DIGITS of the name («1405-1406» = «۱۴۰۵–۱۴۰۶»); a matched year is left untouched (dates, terms); a missing one is
  inserted with its two نوبت; «۱۴۰۵-۱۴۰۶» is made current ONLY in a school that has no current year (never flips
  another current year). **Nothing is deleted** (additive-only production): extra levels/grades/years stay and
  remain valid for the classes that use them; the پایه picker still lists an extra grade under its مقطع.
- **When it runs:** (1) every deploy — the compiled `scripts/seed-catalog.js` (the `seed` compose service) now
  runs `seedCatalogWith` then `seedOrgCatalogsWith` and prints a second line `[seed] organization catalog: …`
  (all zeros after the first run); (2) `pnpm seed` (`scripts/seed.ts --catalog`) the same; (3) organization
  creation — `seedDemoOrg` and `seedPilotOrg` call `ensureOrgCatalog(db, orgId)` right after the organization row
  and look their grades up by code (they no longer create/update levels or grades — the demo used to reset
  SEC2's sequence to 1 on every run), and give each school the remaining fixed years through
  `ensureCatalogYears`; (4) a school created from «مدرسه‌ها» (`schoolResource.create`) gets both years + نوبت‌ها
  through `ensureCatalogYears` (tenancy service, same rule, same transaction, audited) — without it a new school
  would have no year and no way to get one. `seedCatalog(db)` (what the int tests reseed between files) stays the
  SYSTEM catalog only, so fixture organizations are never touched by other test files.
  Rejected: folding the org catalog into `seedCatalogWith` (would rewrite the fixture organizations' structure
  mid-suite); a migration (tenant rows for every org is data, not schema, and a new org after the migration would
  miss them); creating years inside `createSchool` itself (every int test that creates a school and then its own
  current year would conflict — the resource handler is the UI's one door).
- **Pickers.** The class form's «پایه» is the native `<select>` (`SelectNative` via `ResourceForm`) fed by the new
  `gradeOptions(tx)`: grades ordered by مقطع then sequence, each with `group = مقطع` → one `<optgroup>` per مقطع.
  «سال تحصیلی» was already a native select. The student/staff forms have no grade/level picker (a student's grade
  comes from the class) and no list has a grade filter, so there was nothing else to replace.
- **درس‌ها stay editable** (the owner did not mention them). The entry point moved: `schoolResource.links` = one
  `orgOnly` link «درس‌ها» in the header of the «مدرسه‌ها» page (new `links[].orgOnly`, filtered by the caller's
  scope in `ResourceListPage`); `/admin/subjects` still works and its back link is «مدرسه‌ها» (new `back` on
  `ResourceDef`). School-scoped admins still read it read-only by URL; they get no link.
- **Admin order** (`ADMIN_SECTIONS`): نمای کلی (landing) · **مدرسه‌ها** · دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها.
  «نمای کلی» stays the /admin landing — the rail's «مدیریت» parent, dropped from the rows by `adminNavItems` — so
  the rail, the phone pill row (`AdminNav`) and the landing list all show «مدرسه‌ها» first. «مدرسه‌ها» is still
  `orgOnly`: principals and vice principals keep reaching THEIR school through the Home tile («مدرسه» → the hub),
  unchanged — no conflict with the new order.
- **School hub** (`/admin/schools/[id]`): two new sections, «کارکنان» and «دانش‌آموزان», after «کلاس‌ها»: count, the
  first 8 rows (`HUB_PEOPLE`) of the SAME queries as `/admin/staff?school=` (staff anchored to the school,
  `staff_profile.school_id`) and `/admin/students?school=` (students enrolled in it), rendered with the SAME row
  components (new `src/components/admin/PeopleRows.tsx`: `StaffRow`, `StudentRow`, now used by both list pages
  too), and a ghost «همهٴ N نفر» / «فهرست کامل» link to the filtered list. `schoolHubQuery` loads them only when the
  caller holds `iam.person.read` (the hub itself is gated by `tenancy.structure.read`); otherwise the sections are
  absent and the stat tiles keep linking to the filtered lists. The stat row's «دانش‌آموزان» / «کارکنان» now jump
  to `#students` / `#staff` like «کلاس‌ها» jumps to `#classes`, and show the section totals (so the number and the
  list under it never disagree). «سال تحصیلی» on the hub is read-only (no «سال تحصیلی جدید»).
- **Students list** (`/admin/students`): the three filter chips are gone. A student without a class reads «بدون
  کلاس» in the row meta (muted, was warning-yellow), an account still on its initial password «حساب فعال نشده» in
  the meta (the «رمز اولیه» chip is dropped for students — the meta says it; staff rows keep their chip). Search
  stays. `?pending=1` / `?noclass=1` still work because «نیازمند توجه» and `AdminCounters` link there; such a
  narrowed list names itself in one line («فقط حساب‌های فعال‌نشده» / «فقط دانش‌آموزان بدون کلاس») with «همهٴ
  دانش‌آموزان» back — a way out instead of a tab row.
- **Tests:** `tests/unit/admin-nav.test.ts` (owner's order, no retired door anywhere, درس‌ها under «مدرسه‌ها», only
  schools/subjects/classes/offerings resources), `admin-overview.test.ts` («مدرسه‌ها» first row), `home-tiles.test.ts`;
  new `tests/int/org-catalog.test.ts` (reuse by code and alias, rename «ابتدایی» → «دبستان», extra rows kept, the
  fixture year reused and ۱۴۰۶-۱۴۰۷ added, audit rows, second run writes nothing, the grouped picker, a school
  created from «مدرسه‌ها» gets both years with two نوبت, retired resources refused by `MutateInput`);
  `seed.test.ts` (the bundle now also carries `src/modules/tenancy/fixed-catalog`, two summary lines);
  `admin-resource-form.test.ts` (org-only nav is just «مدرسه‌ها»; the grades schema case removed).
- **Operator:** no migration. The next deploy's `seed` step adds the catalog to every organization and prints
  what it created/updated (expect «ابتدایی»-named levels to be renamed «دبستان», pilot grades re-sequenced 1–12).
  `docs/admin.md` still describes the removed pages (lines ~14, ~82, ~89, ~149–159) and `deploy/README.md` says
  the catalog seed writes no tenant rows — both need a pass when this is merged (not edited here to avoid
  conflicts with parallel work).
