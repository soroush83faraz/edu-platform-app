# config

Feature switches («قابلیت‌ها») and settings («تنظیمات») of an organization, overridden per school (owner 2026-10-20,
docs/decisions.md «صف، زمان‌بند و Feature Flag»).

- `flags.ts` / `settings.ts` — the typed registries: key, Persian label and description, default, whether a school may
  override it, `upcoming` for features not built yet. Pure resolvers: school > organization > default.
- `service.ts` — `flagEnabled(tx, key, schoolId?)` / `settingOf(tx, key, schoolId?)` inside any transaction (rows read
  once per transaction); `setFlag` / `setSetting` with the scope rule and the audit row; `settingsView` for the page.
- `queries.ts` — `isEnabled(key, schoolId?)` / `getSetting(key, schoolId?)` for pages, cached per request; the page query.
- `actions.ts` — the two Server Actions (`config.settings.manage`).
- `ui/` — the «تنظیمات» page's rows (src/app/(admin)/admin/settings).

Tables: `config.feature_flag` (school_id since 0026), `config.setting_value` — a row only where an admin set a value.
