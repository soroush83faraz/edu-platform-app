# استقرار (فاز ۱)

مدل: **ایمیج روی ویندوز بیلد می‌شود و با `docker save | ssh docker load` به سرور می‌رود.** روی سرور هیچ `npm install` یا `docker build` اجرا نمی‌شود. فقط Caddy پورت ۸۰/۴۴۳ دارد؛ Postgres و اپ پورت عمومی ندارند.

## اولین استقرار (یک‌بار)

روی سرور (به‌عنوان root، اوبونتو ۲۴٫۰۴):

```bash
bash bootstrap-server.sh "ssh-ed25519 AAAA... you@laptop"   # کاربر deploy، sshd، ufw، fail2ban، swap، chrony، docker + میرور آروان
```

از ویندوز (Git Bash یا PowerShell)، با کاربر `deploy`:

```bash
scp deploy/compose.yml deploy/Caddyfile deploy/deploy.sh deploy/rollback.sh deploy@SERVER:/srv/school/
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

`deploy.sh` به ترتیب: تگ فعلی → `.last_tag`؛ `pg_dump -Fc -U app_backup` در `backups/pre-<ts>.dump` (اگر دیتابیس قبلاً migrate شده و dump شکست بخورد، استقرار **قبل از migrate متوقف می‌شود**)؛ به‌روزرسانی `APP_IMAGE` در `.env`؛ `compose run --rm migrate`؛ `compose up -d app caddy`؛ ۶۰ ثانیه poll روی `/api/health`؛ در شکست خودکار `rollback.sh`.

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

نقش‌ها ثابت‌اند: **dump با `app_backup`** (همان `BACKUP_DATABASE_URL`؛ فقط‌خواندنی + BYPASSRLS)، **restore با `postgres`** (بازسازی اشیای متعلق به `app_owner` نیازمند superuser است). `deploy.sh` و بکاپ شبانه (روز ۳) هر دو از `app_backup` استفاده می‌کنند؛ در صورت شکست dump با این نقش، ابتدا «گام‌های یک‌بارهٴ اپراتور» بالا را بررسی کنید.

```bash
# بکاپ دستی
docker compose exec -T db pg_dump -Fc -U app_backup app > backups/manual-$(date -u +%Y%m%dT%H%M%SZ).dump

# بازیابی (اضطراری)
docker compose stop app
docker compose exec -T db pg_restore -U postgres -d app --clean --if-exists < backups/pre-<ts>.dump
docker compose up -d app
```

## سید کاتالوگ (بعد از هر migrate)

کاتالوگ مجوزها و نقش‌های سیستمی (`iam.permission`, `iam.role`, `iam.role_permission`) با `scripts/seed.ts --catalog` ساخته می‌شود و باید بعد از `migrate` و قبل از بالا آمدن `app` اجرا شود. **TODO:** ایمیج standalone `tsx` ندارد و کاتالوگ در TypeScript است (`src/modules/iam/permissions.ts`)، پس هنوز `scripts/seed.js` (pg-only مثل `migrate.js`) وجود ندارد. تا آن زمان روی سرور:

```bash
# از ماشین توسعه، با اتصال مالک اسکیما به دیتابیس سرور (تونل ssh به پورت 5432 کانتینر db):
MIGRATION_DATABASE_URL=postgres://app_owner:...@localhost:5433/app NODE_ENV=production SEED_ALLOW=1 pnpm seed
```

وقتی `scripts/seed.js` ساخته شد، دستور استقرار می‌شود: `docker compose run --rm app node scripts/seed.js --catalog` (بعد از `compose run --rm migrate`). سازمان‌های دمو (`--demo`) هرگز روی production اجرا نمی‌شوند.

## یادداشت‌ها
- `scripts/migrate.js` (اجرای مهاجرت‌ها در سرویس `migrate`) و `db/initdb/01-roles.sh` (ساخت نقش‌ها و دیتابیس‌ها در اولین اجرای `db`) آماده‌اند؛ جزئیات در `docs/db.md`.
- بکاپ شبانه/رمزگذاری/آپلود به آروان: روز ۳.
