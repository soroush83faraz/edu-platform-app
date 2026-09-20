# دیتابیس — فاز ۱، گام ۱ (tenancy + iam)

PostgreSQL 16 · Drizzle ORM · مهاجرت‌ها SQL کامیت‌شده در `/drizzle`. منبع حقیقت اسکیما: `src/db/schema/*.ts`.

## نقش‌ها (deploy/db/initdb/01-roles.sh — فقط اولین اجرای کانتینر)

| نقش | مجوز | استفاده |
|---|---|---|
| `app_owner` | مالک همهٴ اسکیماها و جدول‌ها. **بدون BYPASSRLS** (FORCE RLS روی خودش هم اعمال می‌شود) | فقط `scripts/migrate` و seed (`MIGRATION_DATABASE_URL`) |
| `app_rw` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`؛ فقط DML؛ `statement_timeout=10s`, `idle_in_transaction_session_timeout=30s`, `lock_timeout=5s` (role-level؛ روی سرور موجود گام اپراتور) | برنامه (`DATABASE_URL`) |
| `app_backup` | فقط SELECT روی همهٴ اسکیماها (از جمله `drizzle`)، **`BYPASSRLS`** | `pg_dump` (`BACKUP_DATABASE_URL`) |

**تصمیم بکاپ:** `pg_dump` همهٴ جدول‌ها را قفل و می‌خواند؛ نقشی بدون BYPASSRLS روی جدول‌های FORCE RLS خطا می‌دهد (یا خالی می‌خواند) و `app_owner` هم BYPASSRLS ندارد. پس نقشِ dump، `app_backup`، BYPASSRLS دارد اما هیچ مجوز نوشتنی ندارد (تست `tests/int/backup-role.test.ts`: بدون context همهٴ ردیف‌های `iam.person` را می‌بیند، INSERT → `42501`). `BACKUP_DATABASE_URL` یک اعتبارنامهٴ «خواندن همهٴ مستأجرها» است. Restore با `postgres`. **روی سرورِ موجود** این attribute باید یک‌بار دستی داده شود (`deploy/README.md`، «گام‌های یک‌بارهٴ اپراتور»)؛ محلی: `docker compose -f docker-compose.dev.yml exec -T db psql -U postgres -c "ALTER ROLE app_backup BYPASSRLS"`.

دیتابیس‌ها: `app` و `app_test` (هر دو `C.UTF-8`، افزونه‌های `btree_gist` و `pg_trgm`). محلی: `pnpm db:up` (پورت ۵۴۳۳).

## قانون RLS

- هر جدول در اسکیماهای مستأجری (`tenancy, iam, academic, workspace, notif, files, audit, config, integ`) که ستون `organization_id` دارد: `ENABLE` + `FORCE ROW LEVEL SECURITY` و سیاست `tenant_isolation`:
  `USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id())`.
- `app.current_org_id()` مقدار `current_setting('app.current_org_id', true)` است؛ وقتی تنظیم نشده → `NULL` → هیچ سطری دیده/نوشته نمی‌شود (**fail-closed**).
- استثنا: جدول‌هایی که `organization_id` آن‌ها nullable است (امروز فقط `iam.role`؛ ردیف NULL = الگوی سیستمی). این جدول‌ها به‌جای یک سیاست `FOR ALL`، **چهار سیاست به‌ازای هر دستور** می‌گیرند (مهاجرت `0004`):
  - `tenant_isolation_select` — `FOR SELECT USING (organization_id IS NULL OR organization_id = app.current_org_id())`: الگوها برای همهٴ مستأجرها (و تراکنش بدون context، یعنی `withoutTenant`) خواندنی‌اند.
  - `tenant_isolation_write` — `FOR INSERT WITH CHECK (organization_id = app.current_org_id())`.
  - `tenant_isolation_update` — `FOR UPDATE USING (… = current_org) WITH CHECK (… = current_org)` و `tenant_isolation_delete` — `FOR DELETE USING (… = current_org)`: **هیچ سیاستی برای `app_rw` ردیف NULL را هدف UPDATE/DELETE قرار نمی‌دهد** (سیاست قبلیِ `FOR ALL` با `USING (… IS NULL OR …)` اجازه می‌داد هر مستأجر الگوها را حذف یا با `SET organization_id = خودش` تصاحب کند — رفع‌شده در `0004`).
  - `system_templates` — `TO app_owner USING (organization_id IS NULL) WITH CHECK (organization_id IS NULL)`: فقط seed (`app_owner`) الگوها را می‌نویسد.
  تست‌ها: `tests/int/rls-templates.test.ts` و `rls-meta.test.ts` (نام و شکل سیاست‌ها را از کاتالوگ بررسی می‌کند).
- جدول‌های سراسری (بدون RLS): `tenancy.organization`, `iam.user_account`, `iam.auth_identity`, `iam.user_session`, `iam.login_attempt`, `iam.permission`, `iam.role_permission`. دو تای آخر برای `app_rw` فقط‌خواندنی‌اند (seed آن‌ها را می‌نویسد).
- چون `FORCE` روی مالک هم اعمال می‌شود، **seed هم باید قبل از نوشتن در جدول‌های مستأجری `set_config('app.current_org_id', …, true)` بزند** (نمونه: `tests/int/global-setup.ts`).
- در کد فقط `withTenant(ctx, fn)` / `withoutTenant(fn)` از `src/db/client` (اولین دستورِ تراکنش `set_config(..., true)` است؛ با پایان تراکنش پاک می‌شود و از pool به درخواست دیگر نشت نمی‌کند). `withoutTenant` فقط برای جدول‌های سراسری **و الگوهای سیستمی `iam.role`** (ردیف‌های `organization_id IS NULL` بدون context هم خواندنی‌اند؛ هیچ ردیف مستأجری دیده نمی‌شود).
- **`set_config` فقط در `src/db/client.ts`.** `set_config(..., false)` (session-level) هرگز: اتصالِ pool، context یک درخواست را به درخواست بعدی می‌برد؛ و `set_config('app.current_org_id', <ورودی>, true)` در کدِ ماژول‌ها یعنی انتخاب مستأجر توسط کلاینت. ESLint داخل `sql\`…\`` را نمی‌بیند، پس `pnpm verify` با `scripts/check-forbidden.js` هر `set_config(` خارج از `src/db/client.ts` (و `scripts/`, `tests/`, `drizzle/`) را رد می‌کند. تنها bind دیگر، `app.current_user_account_id` برای فهرست عضویت‌ها هنگام ورود، تابع `bindAccountContext(tx, id)` در همان فایل است که فقط از راه `definePublicAction` (`tools.bindAccount`) در دسترس است — با id از ردیفِ تأییدشدهٴ `user_account`، هرگز از ورودی.
- توابع `app.apply_grants()`، `app.apply_rls()` و `app.apply_updated_at_triggers()` idempotent‌اند و **هر مهاجرتی که جدول/اسکیمای جدید می‌سازد باید در انتها `SELECT app.apply_grants();`، `SELECT app.apply_rls();` و `SELECT app.apply_updated_at_triggers();` را (هر یک به‌عنوان یک statement جدا) صدا بزند.** تست `tests/int/rls-meta.test.ts` جدولِ بدون RLS و `tests/int/guards.test.ts` جدولِ دارای `updated_at` بدون تریگر را رد می‌کند.
- `updated_at` را سرور نگه می‌دارد: تریگر `set_updated_at` (`BEFORE UPDATE FOR EACH ROW` → `app.set_updated_at()`، مهاجرت `0009`) روی هر جدولی که این ستون را دارد؛ مقدارِ فرستادهٴ کلاینت نادیده گرفته می‌شود. `$onUpdate` در Drizzle هم می‌ماند (فقط برای type و خوانایی).

## گردش کار مهاجرت

1. اسکیما را در `src/db/schema/<schema>.ts` تغییر دهید (و در `src/modules/<ctx>/schema.ts` re-export کنید).
2. `pnpm db:generate` → فایل `drizzle/NNNN_<name>.sql` را **بخوانید**؛ آنچه Drizzle نمی‌تواند (RLS، grant، تابع) را با `pnpm db:generate:custom -- --name <x>` به مهاجرت دستی اضافه کنید. فایل‌ها باید **بدون BOM** و با LF باشند؛ رشتهٴ `--> statement-breakpoint` حتی در کامنت هم جداکنندهٴ statement است.
3. `pnpm db:check` (سازگاری snapshotها) → `pnpm db:reset:test && pnpm test:int` → commit.
4. اعمال: محلی `pnpm db:migrate`؛ روی سرور سرویس `migrate` (`node scripts/migrate.js`) قبل از `app` اجرا می‌شود. همهٴ مهاجرت‌های معوق در **یک تراکنش** اعمال می‌شوند؛ اجرای دوباره no-op است.
5. **هرگز `drizzle-kit push` نه.** مهاجرتِ اعمال‌شده هرگز ویرایش نمی‌شود (تا وقتی فقط محلی است، حذف و دوباره generate کنید). تغییرات production فقط **افزودنی**: ستون جدید nullable یا با DEFAULT؛ تغییر نام با expand/contract.
6. `NOT NULL` در دو گام: (۱) ستون nullable + backfill، (۲) در مهاجرت/ریلیز بعدی `SET NOT NULL`.
7. قواعد ثابت: `timestamptz` (UTC)، `text + CHECK` نه ENUM، بدون `deleted_at` (از `status`/`archived_at`)، UUID v7 از اپ (`uuid.v7()`) یا `app.uuid_generate_v7()` در SQL، هر FK صریح `ON DELETE RESTRICT`، FK ترکیبی `(organization_id, x_id) → x(organization_id, id)` و والدها `UNIQUE(organization_id, id)`.

## جدول‌ها و کلید طبیعی

### tenancy (۱۰)
| جدول | کلید طبیعی / یکتایی | یادداشت |
|---|---|---|
| organization (سراسری) | `slug` (`^[a-z0-9-]{3,40}$`) | `status ∈ active,suspended,trial` |
| school | `(organization_id, code)` | `gender_policy ∈ girls,boys,mixed` |
| branch | — (`(organization_id, id)`) | FK ترکیبی به school |
| academic_year | `(school_id) WHERE is_current` | `starts_on < ends_on` |
| term | `(academic_year_id, sequence)` | |
| education_level | `(organization_id, code)` | |
| grade_level | `(organization_id, code)` | FK ترکیبی به education_level |
| subject | `(organization_id, code)` | `parent_subject_id` خودارجاع ترکیبی |
| class_group | `(academic_year_id, branch_id, name)` | `homeroom_staff_id` بدون FK تا گام ۲؛ `status ∈ active,archived`؛ ایندکس‌های `(organization_id, academic_year_id)`, `(organization_id, grade_level_id)` |
| class_offering | `(class_group_id, subject_id, term_id)` | `status ∈ planned,active,closed`؛ ایندکس‌های `(organization_id, subject_id)`, `(organization_id, term_id)` |

### iam (۱۳)
| جدول | کلید طبیعی / یکتایی | یادداشت |
|---|---|---|
| user_account (سراسری) | `login_identifier`؛ `phone_e164` (partial) | `status ∈ active,locked,disabled` |
| auth_identity (سراسری) | `(user_account_id, provider)` | `provider ∈ password,sms_otp` |
| user_session (سراسری) | `token_hash` | ایندکس `(user_account_id) WHERE revoked_at IS NULL` |
| login_attempt (سراسری) | — | ایندکس `(identifier, at)`, `(ip, at)` |
| organization_membership | `(organization_id, user_account_id)`؛ `person_id` | `status ∈ invited,active,suspended,left`؛ ایندکس `(user_account_id)` (جست‌وجوی عضویت‌ها هنگام ورود) |
| person | `(organization_id, external_ref)` (partial) | `search_text` تولیدی (STORED) = `app.fa_norm(first_name ‖ ' ' ‖ last_name)` + ایندکس GIN trgm. `fa_norm` (از `0009`): حذف اعراب U+064B–U+0652 و کشیده U+0640 (`محمّد` → `محمد`)، ZWNJ → فاصله، ي/ك/ة/ى/أ/إ → فارسی، ارقام → ASCII، فشرده‌سازی فاصله، `lower`. **توجه:** `CREATE OR REPLACE` تابع، مقادیر STORED موجود را بازمحاسبه نمی‌کند؛ امروز ردیف واقعی نداریم. اگر بعداً تغییر کرد: PG16 حذف و افزودن دوبارهٴ ستون + ایندکس (PG17: `ALTER COLUMN … SET EXPRESSION AS (…)`) |
| contact_point | — | `kind ∈ mobile,landline,email,address` |
| student_profile | `(organization_id, student_number)`؛ `person_id` | `status ∈ prospective,active,graduated,withdrawn` |
| staff_profile | `person_id` | `employment_type ∈ full_time,part_time,contractor` |
| role | `(organization_id, code)` **NULLS NOT DISTINCT** | `organization_id NULL` = الگوی سیستمی؛ `cloned_from_role_id` فقط الگو یا نقشِ همان سازمان (تریگر `role_cloned_from_tenant_trg`) |
| permission (سراسری) | `code` (PK) | فقط‌خواندنی برای app_rw |
| role_permission | `(role_id, permission_code)` (PK) | فقط‌خواندنی برای app_rw؛ ایندکس `(permission_code)` |
| role_assignment | `(person_id, role_id, scope_type, scope_id) WHERE revoked_at IS NULL` | `scope_id` تولیدی = `coalesce(…, organization_id)`؛ CHECK قوس انحصاری (دقیقاً ستونِ متناظر با `scope_type` پر باشد)؛ CHECK `valid_to IS NULL OR valid_from <= valid_to`؛ `role_id` فقط الگو یا نقشِ همان سازمان (تریگر `role_assignment_role_tenant_trg`)؛ ایندکس‌های `(role_id)` و `(organization_id, <scope>_id) WHERE … IS NOT NULL` برای هر ستون scope |

### نگهبان‌های بین‌مستأجری (مهاجرت `0006`)

FK سادهٴ `role_assignment.role_id → role(id)` و `role.cloned_from_role_id → role(id)` نمی‌تواند ترکیبی `(organization_id, role_id)` باشد (الگوها `organization_id` NULL دارند) و بررسی FK در PostgreSQL RLS را نادیده می‌گیرد؛ پس سازمان الف می‌توانست نقش خصوصی سازمان ب را با id به کاربر خود وصل یا آن را clone کند. **Constraint trigger**های `app.check_role_assignment_role_tenant()` و `app.check_role_cloned_from_tenant()` (SECURITY DEFINER، مالک `app_owner`، `SET search_path = pg_catalog, app`، `NOT DEFERRABLE`) نقشِ ارجاع‌شده را می‌خوانند و فقط «الگو (NULL) یا همان سازمانِ ردیف» را می‌پذیرند؛ چون `app_owner` هم FORCE RLS دارد، نقشِ مستأجر دیگر برای تابع دیده نمی‌شود و NOT FOUND هم رد می‌شود (fail-closed). خطا با SQLSTATE `23503` و `constraint = <نام تریگر>` برمی‌گردد (اپ آن را مثل FK به `INVALID_REFERENCE` نگاشت می‌کند). تست: `tests/int/tenant-guards.test.ts`.

## دستورها

`pnpm db:up` · `pnpm db:generate` · `pnpm db:generate:custom -- --name <x>` · `pnpm db:check` · `pnpm db:migrate` · `pnpm db:migrate:test` · `pnpm db:reset:test` · `pnpm db:studio` · `pnpm test:int` · `pnpm verify:full`
