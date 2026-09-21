# استقرار (فاز ۱)

مدل: **ایمیج روی ویندوز بیلد می‌شود و با `docker save | ssh docker load` به سرور می‌رود.** روی سرور هیچ `npm install` یا `docker build` اجرا نمی‌شود. فقط Caddy پورت ۸۰/۴۴۳ دارد؛ Postgres و اپ پورت عمومی ندارند.

## اولین استقرار (یک‌بار)

روی سرور (به‌عنوان root، اوبونتو ۲۴٫۰۴):

```bash
bash bootstrap-server.sh "ssh-ed25519 AAAA... you@laptop"   # کاربر deploy، sshd، ufw، fail2ban، swap، chrony، docker + میرور آروان
```

از ویندوز (Git Bash یا PowerShell)، با کاربر `deploy`:

```bash
scp deploy/compose.yml deploy/Caddyfile deploy/deploy.sh deploy/rollback.sh deploy/watchdog.sh deploy/backup/*.sh deploy@SERVER:/srv/school/
scp deploy/db/initdb/*.sh deploy@SERVER:/srv/school/db/initdb/
scp deploy/.env.example deploy@SERVER:/srv/school/.env
ssh deploy@SERVER 'chmod 600 /srv/school/.env && chmod +x /srv/school/*.sh && nano /srv/school/.env'   # همهٴ CHANGE_ME ها را پر کنید
```

```powershell
.\deploy\ship.ps1 -Server SERVER            # build → save|load → deploy.sh <sha>
```

بررسی: `ssh deploy@SERVER 'cd /srv/school && docker compose ps && docker compose logs --tail=50 caddy'` — باید «certificate obtained» دیده شود. `curl -I https://PUBLIC_HOST/api/health` باید 200 بدهد. `ss -tlnp` فقط 22/80/443.

## استقرار مجدد

```powershell
.\deploy\ship.ps1 -Server SERVER
```

`deploy.sh` به ترتیب: تگ فعلی → `.last_tag`؛ `pg_dump -Fc -U app_backup` در `backups/pre-<ts>.dump` (اگر دیتابیس قبلاً migrate شده و dump شکست بخورد، استقرار **قبل از migrate متوقف می‌شود**)؛ به‌روزرسانی `APP_IMAGE` در `.env`؛ `compose run --rm migrate`؛ `compose run --rm --no-deps seed` (سید کاتالوگ، پایین)؛ `compose up -d app caddy`؛ ۶۰ ثانیه poll روی `/api/health`؛ در شکست خودکار `rollback.sh`.

## گام‌های یک‌بارهٴ اپراتور روی سرور موجود (نقش‌های Postgres)

`db/initdb/01-roles.sh` فقط در اولین اجرای کانتینر `db` (volume خالی) اجرا می‌شود؛ تغییرات بعدیِ آن روی سرورِ موجود باید یک‌بار، به‌عنوان `postgres`، دستی اعمال شوند (نقش‌ها cluster-wide هستند؛ روی `app` و `app_test` هر دو اثر می‌کند):

```bash
docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE app_backup BYPASSRLS;" \
  -c "ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';" \
  -c "ALTER ROLE app_rw SET lock_timeout = '5s';"
```

- `app_backup BYPASSRLS` (۱۴۰۵/۰۶/۲۹): بدون آن `pg_dump -U app_backup` روی همهٴ جدول‌های FORCE RLS خطا می‌دهد یا خالی می‌خواند. این نقش فقط `SELECT` دارد، پس BYPASSRLS فقط خواندن را گسترده می‌کند؛ `BACKUP_DATABASE_URL` را مثل یک اعتبارنامهٴ «خواندن همهٴ مستأجرها» نگه دارید (فقط در `.env` سرور، `chmod 600`).
- `app_rw` timeouts (۱۴۰۵/۰۶/۲۹): تراکنشِ رهاشدهٴ یک درخواستِ crash‌کرده بعد از ۳۰ ثانیه بسته می‌شود (وگرنه context RLS و قفل‌ها را روی اتصالِ pool نگه می‌داشت) و انتظار برای قفل بعد از ۵ ثانیه شکست می‌خورد (`statement_timeout=10s` از قبل بود). `ALTER ROLE … SET` فقط برای session‌های جدید اثر دارد؛ بعد از آن `docker compose restart app`.
- مجوزهای schema `drizzle` برای `app_backup` را خودِ مهاجرت (`app.apply_grants()` در `0007`) می‌دهد؛ گام دستی ندارد.

بررسی: `docker compose exec -T db psql -U postgres -c "select rolname, rolbypassrls, rolconfig from pg_roles where rolname like 'app_%'"` → فقط `app_backup` باید `rolbypassrls = t` باشد و `app_rw` سه تنظیم را در `rolconfig` داشته باشد. سپس `docker compose exec -T db pg_dump -Fc -U app_backup app > /dev/null && echo ok`.

## بازگشت دستی

```bash
ssh deploy@SERVER 'bash /srv/school/rollback.sh'
```

مهاجرت‌ها فقط افزودنی‌اند؛ ایمیج قبلی با اسکیمای جدید کار می‌کند، بازیابی دیتابیس لازم نیست.

## بکاپ و بازیابی دیتابیس

نقش‌ها ثابت‌اند: **dump با `app_backup`** (همان `BACKUP_DATABASE_URL`؛ فقط‌خواندنی + BYPASSRLS)، **restore با `postgres`** (بازسازی اشیای متعلق به `app_owner` نیازمند superuser است). `deploy.sh` و بکاپ شبانه (`backup/backup.sh`) هر دو از `app_backup` استفاده می‌کنند؛ در صورت شکست dump با این نقش، ابتدا «گام‌های یک‌بارهٴ اپراتور» بالا را بررسی کنید.

```bash
# بکاپ دستی
docker compose exec -T db pg_dump -Fc -U app_backup app > backups/manual-$(date -u +%Y%m%dT%H%M%SZ).dump

# بازیابی (اضطراری)
docker compose stop app
docker compose exec -T db pg_restore -U postgres -d app --clean --if-exists < backups/pre-<ts>.dump
docker compose up -d app
```

## بکاپ شبانهٴ رمزگذاری‌شده + تمرین بازیابی + watchdog (`backup/backup.sh`، `backup/restore-test.sh`، `watchdog.sh`)

زنجیره: `pg_dump -Fc` با `app_backup` + tar از volume `school_files` → `age -r AGE_RECIPIENT` (کلید عمومی؛ **کلید خصوصی هرگز روی سرور نیست**: فقط لپ‌تاپ توسعه‌دهنده + یک نسخهٴ چاپی در پاکتِ مهرشدهٴ مدرسه) → `rclone copy` به باکت آروان `school-backups/<hostname>/` → حذف فایل‌های محلی قدیمی‌تر از ۷ روز. موفقیت = timestamp در `backups/LAST_OK`؛ شکست = خروج غیرصفر + `backups/LAST_FAILURE` (watchdog هر دو را می‌خواند).

### نصب یک‌بارهٴ اپراتور (اوبونتو ۲۴٫۰۴؛ `bootstrap-server.sh` جدید این‌ها را خودش انجام می‌دهد)

```bash
sudo apt-get install -y age rclone                     # age 1.1.x، rclone 1.60+ از مخزن اوبونتو
scp deploy/backup/*.sh deploy/watchdog.sh deploy@SERVER:/srv/school/
ssh deploy@SERVER 'chmod +x /srv/school/*.sh'
```

کلید age (روی **لپ‌تاپ**، نه سرور):

```bash
age-keygen -o school-backup-key.txt      # خروجی: "Public key: age1..." — فایل را در password manager + نسخهٴ چاپی در پاکت نگه دارید
```

روی سرور در `/srv/school/.env` (chmod 600):

```
AGE_RECIPIENT=age1...                    # فقط کلید عمومی
RCLONE_REMOTE=arvan:school-backups       # پیش‌فرض همین است
# اختیاری برای watchdog:
ALERT_WEBHOOK=https://...                # POST JSON {host,check,message,at}
KAVENEGAR_API_KEY=...                    # + ALERT_PHONE=0912... (و ALERT_SENDER اختیاری) → پیامک هشدار
```

`rclone config` به‌عنوان کاربر `deploy` (فایل در `~deploy/.config/rclone/rclone.conf`، chmod 600) — یا مستقیم بنویسید:

```ini
[arvan]
type = s3
provider = Other
access_key_id = <ACCESS_KEY>
secret_access_key = <SECRET_KEY>
endpoint = https://s3.ir-thr-at1.arvanstorage.ir
acl = private
no_check_bucket = true
```

باکت `school-backups` را **خصوصی** بسازید و در پنل آروان یک **Lifecycle rule** برای انقضای اشیای قدیمی‌تر از **۳۰ روز** بگذارید (اسکریپت خودش چیزی از باکت حذف نمی‌کند). نگه‌داری عملی: ۷ نسخهٴ روزانهٴ محلی روی سرور + ۳۰ نسخهٴ روزانه در باکت (که ۴ هفتهٴ اخیر را پوشش می‌دهد). آزمایش: `rclone lsd arvan:` و `rclone lsf arvan:school-backups/`.

### cron (کاربر `deploy`؛ ساعت سرور Asia/Tehran است — بدون تغییر ساعت تابستانی)

```cron
# m  h  dom mon dow  command
30   2  *   *   *    /srv/school/backup.sh       >> /srv/school/backups/backup.log 2>&1      # 02:30 تهران = 23:00 UTC
30   6  *   *   5    /srv/school/restore-test.sh >> /srv/school/backups/restore-test.log 2>&1 # جمعه‌ها 06:30 تهران = 03:00 UTC
*/10 *  *   *   *    /srv/school/watchdog.sh                                                  # هر ۱۰ دقیقه
```

اگر cron را با TZ=UTC می‌نویسید (مثلاً داخل کانتینر): `00 23 * * *` و `0 3 * * 5`.

### restore-test.sh چه می‌کند

آخرین `db-*.dump.age` (محلی، یا با `RESTORE_FROM_REMOTE=1` از باکت) را با `AGE_IDENTITY` باز می‌کند، در دیتابیس scratch `app_restore_test` (هر بار ساخته و حذف می‌شود، به‌عنوان `postgres`، با `--no-owner --no-privileges`) بازیابی می‌کند، `count(*)` از `iam.person` و `workspace.work_item` و `max(at)` از `audit.audit_log` را با دیتابیس زنده (به‌عنوان `app_backup`) مقایسه می‌کند و زمان را چاپ می‌کند. اگر شمارشی صفر باشد در حالی که زندهٴ آن غیرصفر است → خروج غیرصفر. نتیجه در `backups/LAST_RESTORE_TEST`.

چون کلید خصوصی روی سرور نیست، تمرین هفتگی روی سرور فقط وقتی کار می‌کند که `AGE_IDENTITY` موقتاً آن‌جا باشد؛ **راه پیشنهادی**: تمرین را از لپ‌تاپ اجرا کنید (`RESTORE_FROM_REMOTE=1 AGE_IDENTITY=~/school-backup-key.txt APP_DIR=/srv/school` با تونل ssh به docker، یا ساده‌تر: فایل `.age` را با `rclone copy` بگیرید و روی Postgres محلی بازیابی کنید). اگر cron هفتگی روی سرور می‌خواهید، کلید را با `chmod 600` فقط برای کاربر `deploy` بگذارید و این ریسک را در runbook ثبت کنید.

اجرای محلی روی دیتابیس توسعه (Git Bash روی ویندوز؛ `age`/`rclone` با `winget install FiloSottile.age Rclone.Rclone`):

```bash
AGE_RECIPIENT=age1... APP_DIR=. COMPOSE_FILE=docker-compose.dev.yml BACKUP_SKIP_UPLOAD=1 BACKUP_SKIP_FILES=1 bash deploy/backup/backup.sh
AGE_IDENTITY=key.txt  APP_DIR=. COMPOSE_FILE=docker-compose.dev.yml bash deploy/backup/restore-test.sh
```

### watchdog.sh

هر ۱۰ دقیقه: دیسک > ۸۰٪، RAM آزاد < ۳۰۰ MB، `backups/LAST_OK` قدیمی‌تر از ۲۶ ساعت یا `LAST_FAILURE` موجود، `/api/health` از داخل کانتینر `app` غیر ok یا `pendingMigrations > 0`. هر هشدار در `/srv/school/watchdog.log` نوشته می‌شود؛ webhook/پیامک برای هر چک حداکثر هر ۶ ساعت یک‌بار تکرار می‌شود (`WATCHDOG_REALERT_MIN`) و بازگشت به حالت عادی هم اعلام می‌شود. خطای یک چک، چک‌های دیگر را متوقف نمی‌کند.

### نتیجهٴ تمرین بازیابی (بعد از اولین اجرای واقعی پر کنید)

| تاریخ | فایل | person (بازیابی/زنده) | work_item (بازیابی/زنده) | max(audit.at) | ثانیه | نتیجه | امضا |
|---|---|---|---|---|---|---|---|
| ۱۴۰۵/۰۶/۲۹ (dev، ویندوز) | db-2026-09-20.dump.age | ۲۴/۲۴ | ۲/۲ | 2026-09-20 17:56:34+00 | ۱۲ | OK | — |
|  |  |  |  |  |  |  |  |

## سید کاتالوگ (خودکار در هر استقرار)

کاتالوگ مجوزها، نقش‌های سیستمی و `role_permission` آن‌ها، نوع‌ها و وضعیت‌های سیستمی کار و نوع‌های اعلان (`iam.permission`, `iam.role`, `iam.role_permission`, `workspace.work_item_type/_status`, `notif.notification_type`) در TypeScript تعریف شده است (`scripts/catalog.ts` + `src/modules/iam/permissions.ts`). `pnpm build` (مرحلهٴ builder در Dockerfile) آن را با `scripts/build-seed-catalog.ts` به یک فایل JavaScript ساده، `scripts/seed-catalog.js`، کامپایل می‌کند که مثل `migrate.js` فقط به `pg` نیاز دارد و داخل ایمیج standalone است. سرویس **`seed`** در `compose.yml` آن را با `MIGRATION_DATABASE_URL` (نقش `app_owner`) اجرا می‌کند و `deploy.sh` بعد از `migrate` و قبل از `app` آن را می‌زند (`docker compose run --rm --no-deps seed`؛ `app` هم با `depends_on` به پایان موفق آن وابسته است):

```
[seed] catalog: 18 permissions, 6 system roles, 5 system work item types, 19 statuses, 6 notification types
```

- **idempotent و مرجع**: اجرای دوباره چیزی را عوض نمی‌کند؛ ردیف‌های `role_permission` نقش سیستمی که دیگر در `SYSTEM_ROLES` نیست پاک می‌شوند. پس هر انتشاری که مجوز تازه یا تغییر ماتریس نقش‌ها دارد، بدون گام دستی به دیتابیس می‌رسد (پیش‌تر `pnpm seed` از ماشین توسعه با تونل ssh لازم بود).
- برخلاف `pnpm seed` به `SEED_ALLOW=1` نیاز ندارد: فقط کاتالوگ را می‌نویسد — نه حساب، نه ردیف مستأجر. سازمان‌های دمو (`--demo`) و پایلوت همچنان هرگز روی production اجرا نمی‌شوند.
- شکست سید = شکست استقرار (`rollback.sh`؛ مهاجرت اعمال‌شده افزودنی است و ایمیج قبلی با آن کار می‌کند). خروجی: `docker compose logs seed`.
- **یک‌بار برای سرورِ موجود** (۱۴۰۵/۰۶/۳۱): `ship.ps1` فقط ایمیج را می‌فرستد؛ `compose.yml` (سرویس `seed`) و `deploy.sh` (گام سید) را پیش از استقرار بعدی دوباره کپی کنید: `scp deploy/compose.yml deploy/deploy.sh deploy@SERVER:/srv/school/`. بدون آن `deploy.sh` قدیمی سرویس `seed` را نمی‌شناسد و کاتالوگ همگام نمی‌شود.
- اجرای دستی روی سرور (مثلاً بعد از بازیابی دیتابیس): `cd /srv/school && docker compose run --rm --no-deps seed`. همان کد را `pnpm seed` (TypeScript، `scripts/seed.ts --catalog`) روی ماشین توسعه اجرا می‌کند — یک پیاده‌سازی (`seedCatalogWith` در `scripts/catalog.ts`)، دو ورودی؛ `tests/int/seed.test.ts` باندل را می‌سازد، با `node` اجرا می‌کند و برابریِ خروجی و صفر بودن تفاوت جدول‌ها را می‌سنجد.

## یادداشت‌ها
- `scripts/migrate.js` (اجرای مهاجرت‌ها در سرویس `migrate`)، `scripts/seed-catalog.js` (سید کاتالوگ در سرویس `seed`؛ تولیدشده در build) و `db/initdb/01-roles.sh` (ساخت نقش‌ها و دیتابیس‌ها در اولین اجرای `db`) آماده‌اند؛ جزئیات در `docs/db.md`.
- بکاپ شبانه/رمزگذاری/آپلود به آروان: `backup/backup.sh` (بالا).
