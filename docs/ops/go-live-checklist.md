# چک‌لیست راه‌اندازی — ۱ مهر ۱۴۰۵، ۰۶:۳۰ تا ۱۰:۰۰

ترتیب مهم است: اول چیزهایی که اگر قرمز باشند **راه‌اندازی را متوقف می‌کنند** (■)، بعد چیزهایی که باید تا ۰۹:۰۰ سبز شوند (□). هر بند: دستور، انتظار، تیک. روی سرور در `/srv/school` با `deploy`؛ «لپ‌تاپ» = ماشین توسعه در ریشهٴ ریپو. `H=<PUBLIC_HOST>`.

## ۰۶:۳۰ — داده و بکاپ (■)

| | بند | دستور | انتظار |
|---|---|---|---|
| ☐ | ■ dump تازهٴ همین صبح | `docker compose exec -T db pg_dump -Fc -U app_backup app > backups/golive-$(date -u +%Y%m%dT%H%M%SZ).dump && ls -la backups/golive-*` | فایل > ۰ بایت؛ `age -r $AGE_RECIPIENT` اگر می‌خواهید بیرون از سرور نگه دارید |
| ☐ | ■ dump رمزشدهٴ دیشب در باکت هست | `ls -la backups/db-$(date -u -d yesterday +%F).dump.age backups/LAST_OK && rclone lsl arvan:school-backups/$(hostname)/ \| tail -3` | فایل دیشب محلی **و** در باکت با همان اندازه؛ `LAST_OK` < ۲۶ ساعت؛ `LAST_FAILURE` نیست |
| ☐ | ■ تمرین بازیابی انجام و ثبت شده | `cat backups/LAST_RESTORE_TEST` و جدول `deploy/README.md` | سطر `OK person=… elapsed=…`؛ تاریخ در جدول با امضا |
| ☐ | □ کلید age در پاکت مهرشده + password manager | — | دو نسخه؛ روی سرور **نیست** (`ls ~deploy/*.txt` خالی) |

## ۰۶:۴۵ — سرور و شبکه (■)

| | بند | دستور | انتظار |
|---|---|---|---|
| ☐ | ■ فقط ۲۲/۸۰/۴۴۳ | `ss -tlnp \| awk 'NR==1 \|\| /LISTEN/'` و `sudo ufw status numbered` | فقط `:22 :80 :443`؛ ufw: 22/tcp, 80/tcp, 443/tcp, 443/udp |
| ☐ | ■ گواهی > ۶۰ روز، http → https | `echo \| openssl s_client -connect $H:443 -servername $H 2>/dev/null \| openssl x509 -noout -enddate` و `curl -sI http://$H/ \| head -3` | `notAfter` بعد از ۱ آذر؛ `308`/`301` + `Location: https://` |
| ☐ | ■ هدرها | `curl -sI https://$H/login \| grep -iE 'strict-transport\|x-content-type\|x-frame\|referrer\|content-security\|^server'` | HSTS, nosniff, DENY, strict-origin-when-cross-origin, **CSP موجود** (بلوک PWA/هدرها)، بدون `Server:` |
| ☐ | □ ساعت و منطقهٴ زمانی | `timedatectl \| grep -E 'Time zone\|synchronized'` و `docker compose exec -T app env \| grep -E '^TZ=\|^NODE_ENV='` | میزبان `Asia/Tehran` sync شده؛ کانتینر `TZ=UTC`, `NODE_ENV=production` |
| ☐ | □ دیسک/RAM/سواپ | `df -h / ; free -m ; swapon --show` | دیسک < ۵۰٪، RAM آزاد > ۱ GB، سواپ ۲G |
| ☐ | □ لاگ کانتینرها محدود | `docker inspect school-app-1 --format '{{json .HostConfig.LogConfig}}'` | `max-size 50m`, `max-file 5` |
| ☐ | □ watchdog زنده | `crontab -l -u deploy` و `tail -5 watchdog.log` | سه سطر cron؛ آخرین اجرا < ۱۰ دقیقه بدون `ALERT` |

## ۰۷:۰۰ — دیتابیس (■)

| | بند | دستور | انتظار |
|---|---|---|---|
| ☐ | ■ مهاجرت‌ها = ریپو | سرور: `docker compose exec -T db psql -U app_backup -d app -tAc "select count(*), max(created_at) from drizzle.__drizzle_migrations"` · لپ‌تاپ: `node -e "console.log(require('./drizzle/meta/_journal.json').entries.length)"` و `curl -s https://$H/api/health` | دو عدد برابر؛ health `"pendingMigrations":0` |
| ☐ | ■ RLS drift = ۰ ردیف | `docker compose exec -T db psql -U postgres -d app -f - < docs/qa/rls-drift.sql` (کوئری زیر) | `(0 rows)` |
| ☐ | ■ RLS fail-closed | `docker compose exec -T db psql -U app_rw -d app -tAc "select count(*) from iam.person"` | `0` |
| ☐ | ■ BYPASSRLS فقط app_backup | `docker compose exec -T db psql -U postgres -tAc "select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'app_%' order by 1"` | `app_backup\|t\|f`, `app_owner\|f\|f`, `app_rw\|f\|f` |
| ☐ | □ timeouts نقش app_rw | `… -tAc "select rolconfig from pg_roles where rolname='app_rw'"` | `statement_timeout=10s`, `idle_in_transaction_session_timeout=30s`, `lock_timeout=5s` |
| ☐ | □ کاتالوگ seed شده | `docker compose logs seed` و `… -U app_backup -d app -tAc "select count(*) from iam.permission; select count(*) from iam.role where organization_id is null"` | خط `[seed] catalog: …`؛ شمارش برابر `PERMISSIONS.length` و ۶ نقش سیستمی (سرویس `seed` در هر استقرار خودکار اجرا می‌شود؛ گام دستی ندارد) |

کوئری RLS drift (همان `docs/qa/security-probe.md`):

```sql
select c.relnamespace::regnamespace || '.' || c.relname
from pg_class c
join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
where c.relkind = 'r'
  and c.relnamespace::regnamespace::text in ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
  and (not c.relrowsecurity or not c.relforcerowsecurity
       or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
```

## ۰۷:۱۵ — اپ و secret ها (■)

| | بند | دستور | انتظار |
|---|---|---|---|
| ☐ | ■ `.env` کامل و خصوصی | `stat -c %a .env` و `grep -cE '^(SESSION_SECRET\|INITIAL_PASSWORD_KEY\|DATABASE_URL\|MIGRATION_DATABASE_URL\|BACKUP_DATABASE_URL\|PUBLIC_ORIGIN\|PUBLIC_HOST\|APP_IMAGE\|AGE_RECIPIENT\|POSTGRES_PASSWORD\|APP_OWNER_PASSWORD\|APP_RW_PASSWORD\|APP_BACKUP_PASSWORD)=' .env` | `600`؛ **۱۳**؛ هیچ `CHANGE_ME`/`replace-with` (`grep -c 'CHANGE_ME\|replace-with' .env` → 0)؛ `INITIAL_PASSWORD_KEY` ۶۴ هگز (اپ بدون آن بالا نمی‌آید) |
| ☐ | ■ `SEED_DEMO` خالی | `grep -E '^SEED_' .env` | هیچ سطر `SEED_DEMO=1`/`SEED_ALLOW=1`؛ اگر سازمان دمو روی production هست: نامش واضح («دمو») و رمز مدیر آن تغییر کرده |
| ☐ | ■ هیچ هاست خارجی در باندل | لپ‌تاپ، روی ایمیجی که deploy شده: `docker run --rm --entrypoint sh edu-app:<sha> -c "grep -rhoE 'https?://[a-zA-Z0-9.-]+' .next/static \| sort -u"` | فقط `localhost`/`schemas`/`w3.org`/`reactjs.org`-گونه‌های داخل لایبرری؛ **هیچ** `googleapis`, `gstatic`, `cdn`, `unpkg`, `jsdelivr`, `fonts.` |
| ☐ | ■ gitleaks تمیز | لپ‌تاپ: `gitleaks detect --source . --no-banner` (یا `git grep -nE 'app_rw_dev\|INITIAL_PASSWORD_KEY=[0-9a-f]{64}\|SESSION_SECRET=[A-Za-z0-9_-]{32,}' -- ':!*.example'`) | `no leaks found` / خالی |
| ☐ | ■ health و smoke | `curl -s https://$H/api/health` · لپ‌تاپ: `BASE_URL=https://$H SMOKE_IDENTIFIER=<qa> SMOKE_PASSWORD=<pw> pnpm smoke:prod` | `ok:true, db:up, pendingMigrations:0, version:<sha امروز>`؛ ۷/۷ سبز |
| ☐ | □ تگ قبلی برای rollback | `cat .last_tag && docker image inspect $(cat .last_tag) --format '{{.Id}}'` | تگ قبلی موجود و ایمیجش روی دیسک |
| ☐ | □ `git tag phase1-freeze` روی همان sha | لپ‌تاپ: `git describe --tags --exact-match` و `curl -s https://$H/api/health \| grep -o '"version":"[^"]*"'` | sha ایمیج = sha تگ |

## ۰۷:۴۵ — امنیت رفتاری (□ اما قبل از ۰۹:۰۰)

| | بند | دستور | انتظار |
|---|---|---|---|
| ☐ | ۶ رمز غلط → قفل نرم | با حساب QA: تابع `login` در `docs/qa/security-probe.md` ۶ بار با رمز غلط، بعد یک‌بار درست | ۶ خطای عمومی؛ رمز درست هم ۱۵ دقیقه رد می‌شود؛ `iam.login_attempt` ۷ ردیف `bad_password`/`locked`؛ بعد «رفع قفل» لازم نیست (خودش باز می‌شود) |
| ☐ | کار سازمان/فرد دیگر → پیدا نشد | `docs/qa/security-probe.md` بند ۱–۲ | not-found |
| ☐ | اکشن بدون کوکی / نشستِ باید-رمز | بند ۳–۴ | `UNAUTHENTICATED` / `PASSWORD_CHANGE_REQUIRED` |
| ☐ | ابطال نشست کار می‌کند | `pnpm sessions:revoke --user <qa>` → `curl -b jar …/api/inbox/summary` | `401` |

## ۰۸:۱۵ — داده، کاغذ، گوشی (□)

| | بند | چطور | انتظار |
|---|---|---|---|
| ☐ | دادهٴ واقعی وارد شده **یا** فالبک اعلام‌شده | `pnpm tsx scripts/import.ts <file>.xlsx --org <slug> --school <code> --as <موبایل مدیر> --dry-run` → `--commit` → دوباره `--commit` | dry-run ۰ خطا؛ commit؛ اجرای دوم `inserted: — (total 0)`؛ `/admin/onboarding` همه سبز. اگر فایل مدرسه نرسیده: **فالبک** = مدیر امروز کلاس‌ها/دانش‌آموزان را در پنل می‌سازد؛ در صورتجلسه بنویسید |
| ☐ | برگه‌های اعتبارنامه در پاکت | `/admin/classes/<id>/credentials` → چاپ → بریدن → پاکت به نام کلاس؛ `backups/credentials-<batchId>.csv` بعد از چاپ **پاک** (`shred -u`) | پاکت‌ها به مدیر مدرسه دست‌به‌دست؛ رسید در صورتجلسه |
| ☐ | PWA روی گوشی خودِ مدیر مدرسه | نصب از Chrome/Safari (بند ۱۱ پذیرش) + ورود + خروج + برگشت | آیکون روی هوم؛ بعد از خروج صفحهٴ ورود |
| ☐ | کانال پشتیبانی فعال | گروه پیام‌رسان یا شمارهٴ مستقیم: مدیر + معاون + شما؛ پین: «برای رمز فراموش‌شده → معاون → پنل مدیریت → تعیین رمز موقت» | یک پیام آزمایشی رفت و برگشت |
| ☐ | اسنپ‌شات VPS | پنل آروان → Snapshot `golive-1405-07-01` | تمام شد |
| ☐ | رمزهای دمو/QA تغییر کرده یا حساب‌های دمو غیرفعال | `update iam.user_account set status='disabled' where login_identifier in (…)` یا `SEED_DEMO_PASSWORD` تازه | هیچ حسابی با `Demo-1405-pass` وارد نمی‌شود |

## ۰۹:۰۰ — ورود مدیر مدرسه (شما پشت خط)

- مدیر با موبایل خودش وارد می‌شود → تغییر رمز اجباری → خانهٴ مدیر → `/admin/onboarding`.
- شما: `docker compose logs -f app | grep -E '"level":(40|50)'` و هر ۱۰ دقیقه: `docker compose exec -T db psql -U app_backup -d app -tAc "select outcome, count(*) from iam.login_attempt where at > now() - interval '1 hour' group by 1"`.

## ۱۰:۰۰ — اولین کلاس اعتبارنامه می‌گیرد

- معاون برگه‌ها را می‌دهد؛ دانش‌آموزان روی گوشی وارد می‌شوند و رمز عوض می‌کنند.
- شما تا ۱۱:۰۰: تعداد `password_changed` در `audit.audit_log` (`select count(*) from audit.audit_log where action='iam.account.password_changed' and at > now() - interval '2 hours'`) و شمار `locked` در `login_attempt`؛ هر حساب قفل → معاون «رفع قفل».
- ۱۱:۰۰: پیام کوتاه به مدیر: «X نفر وارد شدند، Y رمز تغییر داد، مشکلی نبود/بود: …».

## اگر یکی از ■ ها قرمز است

راه‌اندازی را **به تعویق بیندازید** تا سبز شود؛ مدیر مدرسه را با قالب S2 در `docs/ops/incident.md` مطلع کنید («تا ساعت … برمی‌گردد»). اگر deploy امروز صبح مقصر است: `bash rollback.sh` و راه‌اندازی با ایمیج قبلی (مهاجرت‌ها افزودنی‌اند).
