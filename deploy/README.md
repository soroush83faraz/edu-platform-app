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

`deploy.sh` به ترتیب: تگ فعلی → `.last_tag`؛ `pg_dump -Fc` در `backups/pre-<ts>.dump`؛ به‌روزرسانی `APP_IMAGE` در `.env`؛ `compose run --rm migrate`؛ `compose up -d app caddy`؛ ۶۰ ثانیه poll روی `/api/health`؛ در شکست خودکار `rollback.sh`.

## بازگشت دستی

```bash
ssh deploy@SERVER 'bash /srv/school/rollback.sh'
```

مهاجرت‌ها فقط افزودنی‌اند؛ ایمیج قبلی با اسکیمای جدید کار می‌کند، بازیابی دیتابیس لازم نیست.

## بازیابی دیتابیس (اضطراری)

```bash
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
