# Runbook عملیات — فاز ۱

برای ساعت ۰۶:۴۵ و مدیری که پشت خط است. هر بخش: **کی**، **چه دستوری**، **چه چیزی باید ببینی**. همه‌چیز روی سرور در `/srv/school` با کاربر `deploy` است؛ `ssh deploy@SERVER` و `cd /srv/school` فرض شده. ساعت سرور Asia/Tehran، ساعت کانتینرها و نام فایل‌های بکاپ UTC (تهران = UTC+3:30).

## ۰. سی ثانیهٴ اول — وضعیت

```bash
docker compose ps                                  # db / app / caddy همه Up (healthy)؛ migrate و seed باید Exited 0 باشند
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
#  {"ok":true,"db":"up","pendingMigrations":0,"version":"<sha>",...}
docker compose logs --tail=100 app | grep -iE 'error|fatal' | tail -20
tail -20 watchdog.log                              # هشدارهای ۱۰ دقیقه‌ای (دیسک/RAM/بکاپ/health)
df -h / ; free -m                                  # دیسک < ۸۰٪، RAM آزاد > ۳۰۰ MB
```

اگر `app` بالا نیست: بخش ۳. اگر health `db: down`: `docker compose restart db` و ۲۰ ثانیه صبر، دوباره health. اگر کاربر «وارد نمی‌شود»: بخش ۷ و ۸.

## ۱. استقرار (deploy)

از ویندوز (ریشهٴ ریپو، درخت کار تمیز، `pnpm verify` سبز):

```powershell
.\deploy\ship.ps1                           # docker build (ویندوز) → push لایه‌های تازه به رجیستری سرور (تونل ssh) → pull → deploy.sh <sha>
.\deploy\ship.ps1 -Mode save                # جایگزین: کل ایمیج با docker save | ssh docker load (deploy/README.md «رجیستری خصوصی»)
```

`deploy.sh <sha>` روی سرور به ترتیب: تگ فعلی → `.last_tag` · `pg_dump -Fc -U app_backup` → `backups/pre-<ts>.dump` (شکست = توقف **قبل** از migrate) · `APP_IMAGE` در `.env` · `docker compose run --rm migrate` · `docker compose run --rm --no-deps seed` (سید کاتالوگ مجوزها/نقش‌ها؛ idempotent) · `docker compose up -d app caddy` · ۶۰ ثانیه poll روی `/api/health` · در شکست `rollback.sh` خودکار. بعد از پیام `healthy:` از ویندوز:

```powershell
$env:BASE_URL="https://PUBLIC_HOST"; $env:SMOKE_IDENTIFIER="<qa login>"; $env:SMOKE_PASSWORD="<qa pw>"; pnpm smoke:prod
```

۷ تیک سبز = استقرار تمام. کاتالوگ (`iam.permission`، نقش‌های سیستمی و `role_permission`) را خودِ استقرار همگام می‌کند (سرویس `seed`، `scripts/seed-catalog.js`؛ `docker compose logs seed` باید `[seed] catalog: …` را نشان دهد) — دیگر `pnpm seed` از ماشین توسعه لازم نیست؛ `deploy/README.md` «سید کاتالوگ».

## ۲. بازگشت (rollback)

```bash
bash rollback.sh            # APP_IMAGE ← .last_tag ، docker compose up -d --no-deps app
docker compose ps app
```

مهاجرت‌ها افزودنی‌اند؛ ایمیج قبلی با اسکیمای جدید کار می‌کند. بازیابی دیتابیس **لازم نیست** مگر داده خراب شده باشد (بخش ۴). اگر `.last_tag` خالی است: `docker image ls edu-app` و دستی `APP_IMAGE=edu-app:<sha>` در `.env` + `docker compose up -d --no-deps app`.

## ۳. ری‌استارت و لاگ

```bash
docker compose restart app                 # ۱۰–۲۰ ثانیه قطعی؛ نشست‌ها در DB هستند، کسی logout نمی‌شود
docker compose restart caddy               # فقط اگر TLS/پروکسی مشکل دارد
docker compose up -d                       # بعد از ریبوت سرور اگر restart: unless-stopped کاری نکرد
docker compose logs -f --tail=200 app      # لاگ JSON (pino)؛ هر خط requestId دارد
docker compose logs --since 30m app | grep '"level":50'      # فقط error
docker compose logs --tail=50 caddy        # certificate obtained / renew
docker compose logs migrate                # خروجی آخرین مهاجرت
docker compose logs seed                   # خروجی سید کاتالوگ ([seed] catalog: …)
docker compose logs -f --tail=100 worker   # کارهای پس‌زمینه (§۳-الف)
journalctl -u docker --since "1 hour ago"  # اگر خود docker مشکوک است
```

اگر برنامه «کند شده» اما health سبز است (روز اول مهر، همه در یک زنگ): `docker stats --no-stream school-app-1 school-db-1` — CPU کانتینر app نزدیک ۱۰۰٪ یعنی به سقف یک هسته رسیده‌ایم (≈ ۵۰ درخواست/ثانیه؛ `docs/ops/capacity.md`)، و `docker compose exec -T db psql -U app_backup -d app -tAc "select state, count(*) from pg_stat_activity where usename='app_rw' group by 1"` — اگر بیش از ۱۰ اتصال `idle in transaction` باشد همان فشار است، نه دیتابیس. خطا نمی‌دهد، فقط کند می‌شود؛ چیزی ری‌استارت نکنید.

لاگ کانتینرها json-file با `max-size 50m × 5` است (compose.yml)؛ دیسک را پر نمی‌کند. سرور بعد از ریبوت (جمعه ۰۴:۰۰ اگر `reboot-required` باشد) خودش برمی‌گردد؛ ۰۹:۰۰ صبح شنبه یک health بزنید.

## ۳-الف. کارهای پس‌زمینه (`worker`)

صف و زمان‌بندِ فقط-Postgres (مالک ۲۰۲۶-۱۰-۲۰؛ `docs/decisions.md` «صف، زمان‌بند و Feature Flag»): سرویس `worker` در `compose.yml` — همان ایمیج `app`، فرمان `node scripts/worker.mjs`، به‌عنوان `app_rw`، با volume فایل‌ها. کارها در جدول `ops.job` (هر کار مال یک سازمان)، زمان‌بندها در `ops.schedule`. بدون حالت: هر وقت لازم شد `docker compose restart worker` — اجرای نیمه‌کاره rollback می‌شود و بعد از تمام شدنِ lease (مهلتِ کار + ۳۰ ثانیه) دوباره برداشته می‌شود.

| زمان‌بند (به وقت تهران) | کار | چه می‌کند |
|---|---|---|
| هر ساعت، دقیقهٔ ۱۷ | `files.sweep_orphans` | جاروی بایت‌های یتیمِ هر سازمان (§۴-الف) |
| هر ساعت، دقیقهٔ ۴۷ | `files.expire_uploads` | بارگذاری‌های پیوست‌نشدهٔ بیش از ۲۴ ساعت → بایگانی + پاک کردن بایت‌ها |
| هر شب ۰۳:۳۰ | `ops.prune_jobs` | پاک کردن کارهای `done` قدیمی‌تر از ۱۴ روز و `dead` قدیمی‌تر از ۹۰ روز |
| هر ۱۵ دقیقه (دقیقه‌های ۰۷، ۲۲، ۳۷، ۵۲) | `workspace.scan_deadlines` | «یادآوری مهلت تکالیف» (اگر روشن باشد): صف کردنِ `workspace.remind_deadline` (یادآوری به گیرندگانِ تمام‌نکرده) و `workspace.notify_overdue` (خبرِ مهلتِ گذشته به دهنده) |
| هر ۱۵ دقیقه (دقیقه‌های ۰۴، ۱۹، ۳۴، ۴۹) | `workspace.check_request_slas` | «مرکز درخواست‌ها» (اگر روشن باشد): یادآوری در ۸۰٪ مهلت پاسخ و ارجاع خودکار به سطح بالاتر در پایان آن، بیرون از ساعت‌های سکوت؛ ساعتِ درخواستِ «در حال بررسی» متوقف است و شمرده نمی‌شود (درخواست‌های مرخصی هم از `0030`) |

```bash
docker compose ps worker                                     # باید (healthy) باشد؛ healthcheck = فایلی که حلقه هر دور لمس می‌کند
docker compose logs --since 1h worker | grep '"msg":"job: '  # هر اجرا یک خط: jobId, kind, organizationId, attempt, ms
docker compose logs --since 1d worker | grep -E 'job: dead|scheduler: tick failed|claim failed'
# وضعیت صف (فقط‌خواندنی، app_backup):
docker compose exec -T db psql -U app_backup -d app -c "select kind, status, count(*) from ops.job group by 1, 2 order by 1, 2"
docker compose exec -T db psql -U app_backup -d app -c "select id, organization_id, kind, attempts, finished_at, last_error from ops.job where status = 'dead' order by finished_at desc limit 20"
docker compose exec -T db psql -U app_backup -d app -c "select name, cron, last_fired_at, next_fire_at from ops.schedule order by name"
```

- **کار مرده (`dead`)** = همهٴ تلاش‌ها شکست خورد (هر شکست: `failed` و تلاش دوباره با فاصلهٔ ۳۰ث، ۱د، ۲د … تا سقف ۱ ساعت)، یا خطای دائمی (`PermanentJobError` / payload نامعتبر)، یا worker در آخرین تلاش مرد. `last_error` یک خطِ پاک‌شده است (نوع خطا + SQLSTATE + پیامِ کوتاه؛ ایمیل/شماره/مقدارِ داخل گیومه حذف شده). watchdog اگر در ۲۴ ساعت اخیر کار مرده‌ای باشد هشدار `worker` می‌دهد. علت را از لاگ همان `jobId` پیدا و رفع کنید، بعد **اجرای دوباره** (به‌عنوان `app_owner`، تنها نقشی که می‌تواند کار هر سازمانی را بی‌context به‌روز کند):
  ```bash
  docker compose exec -T db psql -U app_owner -d app -c "update ops.job set status='queued', attempts=0, run_at=now(), finished_at=null, last_error=null where id='<job id>' and status='dead'"
  ```
- **اجرای فوریِ یک زمان‌بند** (مثلاً جارو بعد از بازیابی): `docker compose exec -T db psql -U app_owner -d app -c "update ops.schedule set next_fire_at=now() where name='files.sweep_orphans.hourly'"` — در ۲۰ ثانیهٔ بعد برای همهٔ سازمان‌ها کار ساخته می‌شود (کلید یکتای هر tick جلوی تکرار را می‌گیرد).
- **توقف موقت همهٔ کارها:** `docker compose stop worker` (و بعد `start`). زمان‌بندِ جاافتاده فقط **یک‌بار** اجرا می‌شود، نه به تعداد دفعاتی که گذشته؛ کارهای صف‌شده منتظر می‌مانند.
- **«صف گیر کرده»** (کارهای `queued` با `run_at` گذشته که برداشته نمی‌شوند): worker سالم است؟ لاگ `worker: claim failed`؟ اتصال دیتابیس؟ `select kind, count(*) from ops.job where status in ('queued','failed') and run_at < now() - interval '10 minutes' group by 1`. سقف هم‌زمانی هر نوع در `src/modules/ops/kinds.ts`، سقف کل فرایند `WORKER_MAX_CONCURRENCY` (پیش‌فرض ۲).
- **حافظه:** `mem_limit: 256m` و `--max-old-space-size=160`؛ `docker stats --no-stream school-worker-1`.

## ۴. بازیابی از بکاپ

بکاپ‌ها: `backups/db-<YYYY-MM-DD>.dump.age` (۷ روز محلی) و باکت آروان `school-backups/<hostname>/` (۳۰ روز)؛ `backups/pre-<ts>.dump` (بدون رمزگذاری، قبل از هر deploy) و `backups/pre-import-*.dump` (قبل از هر import). کلید خصوصی age **روی سرور نیست** (لپ‌تاپ + پاکت).

**اول تمرین، بعد واقعی.** هیچ‌وقت مستقیم روی `app` بازیابی نکنید.

1. فایل را انتخاب کنید: `ls -la backups/ | tail` یا `rclone lsf arvan:school-backups/$(hostname)/ | sort | tail -3` و `rclone copy arvan:school-backups/$(hostname)/db-<date>.dump.age backups/`.
2. تمرین در دیتابیس scratch (کلید age را موقتاً روی سرور با `scp` بگذارید، آخرش `shred -u`):
   ```bash
   AGE_IDENTITY=/home/deploy/key.txt RESTORE_FILE=backups/db-<date>.dump.age bash restore-test.sh
   ```
   خروجی: جدول person / work_item / max(audit.at) «بازیابی» در برابر «زنده» + ثانیه. اگر شمارش‌ها معقول‌اند ادامه دهید.
3. رمزگشایی: `age -d -i /home/deploy/key.txt -o /tmp/restore.dump backups/db-<date>.dump.age` (برای `pre-*.dump` لازم نیست).
4. اپ را بخوابانید و دیتابیس فعلی را هم نگه دارید:
   ```bash
   docker compose stop app
   docker compose exec -T db pg_dump -Fc -U app_backup app > backups/before-restore-$(date -u +%Y%m%dT%H%M%SZ).dump
   ```
5. بازیابی **واقعی** به‌عنوان `postgres` بدون `--no-owner` (مالک اشیا `app_owner` می‌ماند، grant ها برمی‌گردند):
   ```bash
   docker compose exec -T db pg_restore -U postgres -d app --clean --if-exists --exit-on-error < /tmp/restore.dump
   ```
   اگر `--clean` روی اشیای وابسته خطا داد: `DROP DATABASE app` ممکن نیست تا اتصال باز است → `docker compose stop app` کافی است؛ در بدترین حالت `psql -U postgres -c "drop database app with (force)" -c "create database app owner app_owner encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8' template template0"` و بعد `psql -U postgres -d app -c "create extension btree_gist" -c "create extension pg_trgm"` و pg_restore بدون `--clean`.
6. بررسی و بالا آوردن: `docker compose exec -T db psql -U app_backup -d app -tAc "select count(*) from iam.person"` → `docker compose up -d app` → health → `pnpm smoke:prod` → `pnpm sessions:revoke --all --yes` (نشست‌های بعد از زمانِ بکاپ معتبر نیستند؛ همه دوباره وارد می‌شوند).
7. `shred -u /tmp/restore.dump /home/deploy/key.txt`. ثبت در جدول «نتیجهٴ تمرین بازیابی» (`deploy/README.md`).

فایل‌های آپلود (volume `school_files` = `FILES_DIR=/data/files` در کانتینر `app`؛ از ۲۰۲۶-۱۰-۱۹ «پیوست تکلیف و تحویل پاسخ» در آن می‌نویسد و `backup.sh` هر شب آن را tar می‌کند): **همان شبِ** dump را برگردانید تا ردیف‌ها و بایت‌ها با هم بخوانند:
```bash
docker compose stop app
age -d -i /home/deploy/key.txt backups/files-<date>.tar.gz.age | docker run --rm -i -v school_files:/data alpine tar xzf - -C /data
docker run --rm -v school_files:/data alpine sh -c 'chown -R 1001:1001 /data && find /data -type d -exec chmod 750 {} + && find /data -type f -exec chmod 600 {} +'
docker compose up -d app
```
ردیفی که بایتش نیست، در دانلود ۴۰۴ می‌دهد و در لاگ `files: stored bytes missing` (فقط کلید، بدون نام فایل) می‌نویسد؛ بایتی که ردیف ندارد هرگز سرو نمی‌شود (بخش ۴-الف).

### ۴-الف. فایل‌ها (`FILES_DIR`)

- **کجا:** volume `school_files` → `/data/files` در `app` (`FILES_DIR` در `compose.yml`). چیدمان `<org id>/<yyyy>/<file id>` + پوشهٔ موقت `.tmp/` (فایل‌های `.part` نیمه‌کاره؛ بیش از یک ساعت ⇐ با بارگذاری بعدی پاک می‌شوند). نام فایلِ کاربر هرگز در مسیر نیست؛ در `files.file_object.original_name` است.
- **قابل نوشتن برای uid 1001 (`nextjs`)؟** `docker compose exec -T app sh -c 'id; ls -ld /data/files; touch /data/files/.w && rm /data/files/.w && echo writable'` — اگر `Permission denied`: `docker run --rm -v school_files:/data alpine chown -R 1001:1001 /data`.
- **بارگذاریِ کند** (بازبینی امنیتی ۲۰۲۶-۱۰-۱۹، D2): هر شخص فقط **یک** بارگذاریِ هم‌زمان؛ هر فرایند ۸ تا، که ۲ تای آخرش فقط برای کسی است که در ۱۰ دقیقهٔ اخیر بارگذاریِ کندِ قطع‌شده نداشته. بدنه‌ای که ۱۵ ثانیه هیچ بایتی نفرستد، بعد از ۱۰ ثانیه میانگینش زیر ۱۰۰ کیلوبایت بر ثانیه باشد، یا روی هم بیش از ۹۰ ثانیه طول بکشد، قطع می‌شود (۴۰۸، لاگ `files: upload aborted — too slow` با `pace` = `idle`/`slow`/`total`)؛ سه بار در ۱۰ دقیقه ⇐ ۴۲۹ تا آخر همان پنجره. Caddy هر درخواست را حداکثر ۱۲۰ ثانیه می‌خواند (`servers › timeouts › read_body` در `deploy/Caddyfile`) و Node ۳۰۰ ثانیه (`requestTimeout`). اعداد در `src/modules/files/limits.ts`.
- **دیسک:** بارگذاری زیر ۱ گیگابایت فضای آزاد متوقف می‌شود («فضای ذخیره‌سازی سرور پر است»، لاگ `files: upload refused — the files volume is below the free-space floor`)؛ watchdog بالای ۸۰٪ هشدار می‌دهد (volumeهای Docker روی همان دیسکِ ریشه‌اند). حجم: `docker run --rm -v school_files:/data alpine du -sh /data`.
- **پاک‌سازی:** بارگذاری‌های پیوست‌نشده بعد از ۲۴ ساعت با بارگذاریِ بعدیِ همان سازمان **و** هر ساعت سرِ دقیقهٔ ۴۷ در `worker` (کار `files.expire_uploads`) بایگانی و پاک می‌شوند (`app.expire_stale_uploads`، مهاجرت `0025`)؛ فایلِ برداشته‌شده همان لحظه پاک می‌شود. **یتیم‌ها** (فقط بعد از crash بین rename و commit، یا بین commit و پاک‌کردن): بایتِ بدون ردیفِ زنده هرگز سرو نمی‌شود، و **جاروی یتیم‌ها** (`src/modules/files/sweep.ts`؛ بازبینی امنیتی ۲۰۲۶-۱۰-۱۹، D6) پاکشان می‌کند: هر ساعت سرِ دقیقهٔ ۱۷ (به وقت تهران) برای هر سازمان، در سرویس `worker` (کار `files.sweep_orphans`؛ §۳-الف — تا ۲۰۲۶-۱۰-۲۰ بعد از بارگذاری‌ها اجرا می‌شد)، فقط پوشه‌های امسال و پارسالِ **همان** سازمان، حداکثر ۵۰۰ فایل در هر دور؛ فقط فایلی با نامِ شناسهٔ فایل که **هیچ ردیفِ زنده‌ای** (pending / attached) ندارد و **بیش از ۲۴ ساعت** پیش نوشته شده پاک می‌شود. اگر پرسش از پایگاه داده شکست بخورد هیچ چیز پاک نمی‌شود؛ اگر در یک دور بیشترِ فایل‌ها (از دست‌کم ۱۰ تا) یتیم به نظر برسند — `FILES_DIR` اشتباه، پایگاه دادهٔ دیگر، بازیابیِ ناهم‌زمان — هیچ چیز پاک نمی‌شود و لاگ `files: orphan sweep braked` می‌آید. هر پاک‌کردن یک خط لاگِ `files: orphan sweep` با کلیدها (بدون نام فایل).
  دستی (همان قاعده، برای همهٔ سازمان‌ها یا یکی؛ اول `--dry-run`):
  ```bash
  pnpm files:sweep --dry-run                     # روی ماشین توسعه، با FILES_DIR و DATABASE_URL همان محیط
  pnpm tsx scripts/build-seed-bundles.ts         # روی سرور: build/seed-bundles/sweep-files.mjs را بسازید و بفرستید
  scp build/seed-bundles/sweep-files.mjs deploy@SERVER:/srv/school/tools/
  docker compose run --rm --no-deps -v /srv/school/tools:/app/tools:ro app node /app/tools/sweep-files.mjs --dry-run
  docker compose run --rm --no-deps -v /srv/school/tools:/app/tools:ro app node /app/tools/sweep-files.mjs   # بعد از بررسیِ خروجی
  ```
  هر سازمان یک خط JSON: `examined` / `orphans` / `deleted` / `braked` / `lookupFailed`؛ `--org <uuid>`، `--max-files <n>`، و `--force` (فقط بعد از یک dry-run بررسی‌شده، وقتی `braked` درست است). بررسیِ فقط‌خواندنیِ دستی (به‌عنوان `app_backup`):
  ```bash
  docker compose exec -T db psql -U app_backup -d app -tAc "select storage_key from files.file_object where status <> 'archived'" | sort > /tmp/live.txt
  docker run --rm -v school_files:/data alpine sh -c 'cd /data && find . -type f ! -path "./.tmp/*" | sed "s|^./||"' | sort > /tmp/disk.txt
  comm -13 /tmp/live.txt /tmp/disk.txt   # روی دیسک ولی بدون ردیفِ زنده
  ```
- **`seed:pilot --reset`** ردیف‌های سه سازمانِ آزمایشی را پاک می‌کند، نه بایت‌هایشان را: بعد از آن `docker run --rm -v school_files:/data alpine rm -rf /data/<org id>`.
- **cPanel:** `FILES_DIR` را به مسیری بیرون از پوشهٔ انتشار بدهید (مثلاً `/home/<user>/app-files`) — هر انتشار پوشهٔ اپ را عوض می‌کند — و آن را جدا بکاپ کنید (`backup.sh` مسیرِ Docker است). سقف بدنهٔ درخواستِ Apache/LiteSpeed باید ≥ ۱۱ مگابایت باشد.

## ۵. افزودن مدرسه / سازمان

- **مدرسهٴ جدید در سازمانِ موجود:** مدیر سازمان در `/admin/schools` → «مدرسهٴ جدید» (کد با حرف انگلیسی؛ بعداً تغییر نمی‌کند — پیشوند نام‌کاربری‌های بدون موبایل مثل `g-14050021`). شعبهٴ «مرکزی» خودکار ساخته می‌شود. بعد: سال تحصیلی (+ «دو نوبت استاندارد») → پایه‌ها → درس‌ها → کلاس‌ها → ارائهٴ درس (درس × نوبت × دبیر) یا **ورود از اکسل** (`docs/admin.md`):
  ```bash
  pnpm tsx scripts/import.ts file.xlsx --org <slug> --school <code> --as <موبایل مدیر> --dry-run
  pnpm tsx scripts/import.ts file.xlsx --org <slug> --school <code> --as <موبایل مدیر> --commit
  ```
  رمزهای اولیه فقط در `backups/credentials-<batchId>.csv` (پاک کنید بعد از توزیع) و چاپ از `/admin/classes/<id>/credentials`.
- **سازمان (مستأجر) جدید:** پنلی ندارد (فاز ۱ یک سازمان واقعی است). با نقش `app_owner` در یک تراکنش: `tenancy.organization` (slug `^[a-z0-9-]{3,40}$`) → `iam.person` + `iam.user_account` + `iam.auth_identity(password)` + `iam.organization_membership(status=active, is_default_org)` + `iam.role_assignment(role=org_admin الگو, scope_type=organization)`؛ قبل از هر INSERT مستأجری `select set_config('app.current_org_id','<uuid>',true)`. الگو: تابع `ensureDemoOrganization` در `scripts/seed.ts`. ساده‌تر: نسخهٴ کپی‌شدهٴ seed با نام‌های واقعی و `SEED_ALLOW=1`. **`SEED_DEMO` هرگز روی production.**

## ۶. بازنشانی رمز و رفع قفل

**راه اصلی (پنل):** مدیر → `/admin/students` یا `/admin/staff` → فرد → کارت حساب → «تعیین رمز موقت» (رمز ۸ رقمی یک‌بار نمایش، `must_change_password=true`، همهٴ نشست‌های آن حساب باطل) یا «رفع قفل» (`status=active`, `failed_login_count=0`, `locked_until=NULL`). «چاپ اعتبارنامه» همان رمز را روی برگه می‌آورد.

**فالبک SQL (اگر مدیر خودش قفل شده یا پنل بالا نیست)** — به‌عنوان `app_owner`، شناسه E.164 (`+98912…`) یا نام‌کاربری کوچک‌شده:

```bash
# هش argon2id یک رمز موقت (روی ماشین توسعه):
pnpm tsx -e "import('./src/modules/iam/password.ts').then(m=>m.hashPassword('Temp-1405-pass').then(console.log))"
docker compose exec -T db psql -U app_owner -d app -v ON_ERROR_STOP=1 -v who="'+98912…'" -v hash="'<PHC>'" <<'SQL'
UPDATE iam.auth_identity SET secret_hash = :hash, initial_password_enc = NULL
  WHERE provider = 'password' AND user_account_id = (SELECT id FROM iam.user_account WHERE login_identifier = :who);
UPDATE iam.user_account SET must_change_password = true, status = 'active', locked_until = NULL, failed_login_count = 0
  WHERE login_identifier = :who;
UPDATE iam.user_session SET revoked_at = now() WHERE revoked_at IS NULL
  AND user_account_id = (SELECT id FROM iam.user_account WHERE login_identifier = :who);
SQL
```

فقط رفع قفل: دو دستور دوم و سوم بدون تغییر هش. قفل نرم ۱۵ دقیقه‌ای (۵ رمز غلط) خودش باز می‌شود؛ `locked_until` ۱ ساعت؛ `status='locked'` (۲۰ شکست در ۲۴ ساعت) فقط با همین راه یا «رفع قفل» پنل.

## ۷. ابطال نشست‌ها

```bash
pnpm sessions:revoke --user 0912…          # یک حساب (گوشیِ گم‌شده)
pnpm sessions:revoke --org <slug> --yes    # همهٴ اعضای یک سازمان
pnpm sessions:revoke --all --yes           # همه — بعد از نشت DB/secret، یا بعد از بازیابی بکاپ
```

از ماشین توسعه با `DATABASE_URL` سرور (تونل: `ssh -L 5433:<db container ip>:5432 deploy@SERVER` یا `docker compose exec` + `psql` مستقیم: `update iam.user_session set revoked_at=now() where revoked_at is null`). کاربران در اکشن بعدی `UNAUTHENTICATED` می‌گیرند و به `/login` می‌روند. (ردیف «خروج از همهٴ دستگاه‌ها» در «بیشتر» فعلاً پنهان است — تصمیم مالک، دور دوم QA؛ `logoutAllAction` در کد مانده. کاربر با «تغییر رمز» همهٴ نشست‌های دیگرِ خودش را می‌بندد.)

## ۸. چرخش secret ها

| چه | اثر | چطور |
|---|---|---|
| `SESSION_SECRET` | امروز هیچ چیزی با آن امضا نمی‌شود (نشست‌ها opaque در DB هستند)؛ چرخش بی‌ضرر است و **نشست‌ها را باطل نمی‌کند** — برای آن `sessions:revoke --all` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` → `.env` → `docker compose up -d --no-deps app` |
| `INITIAL_PASSWORD_KEY` (AES-256-GCM، **الزامی**؛ اپ بدون آن بالا نمی‌آید) | رمزهای اولیهٴ ذخیره‌شده (`auth_identity.initial_password_enc`) ناخوانا می‌شوند → برگهٴ اعتبارنامه برای آن حساب‌ها «— تغییر داده شده» چاپ می‌کند؛ **ورود اثری نمی‌بیند** (argon2). قبل از چرخش برگه‌های لازم را چاپ کنید | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → `.env` → `up -d --no-deps app` |
| رمزهای Postgres (`APP_RW_PASSWORD`, `APP_OWNER_PASSWORD`, `APP_BACKUP_PASSWORD`, `POSTGRES_PASSWORD`) | نقش‌ها cluster-wide؛ `initdb` فقط اولین بار خوانده می‌شود، پس **هم `ALTER ROLE` هم `.env`** | `docker compose exec -T db psql -U postgres -c "ALTER ROLE app_rw PASSWORD 'new'"` (و بقیه) → همان مقدار در `.env` (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BACKUP_DATABASE_URL`, `*_PASSWORD`) → `docker compose up -d app` → health → `backup.sh` دستی برای اطمینان |
| کلید age بکاپ | بکاپ‌های قدیمی با کلید قدیمی باز می‌شوند؛ کلید قدیمی را **نگه دارید** تا ۳۰ روز | `age-keygen` روی لپ‌تاپ → `AGE_RECIPIENT` جدید در `.env` سرور → پاکت جدید برای مدرسه |
| کلیدهای S3 آروان | فقط `rclone.conf` | پنل آروان → `~deploy/.config/rclone/rclone.conf` → `rclone lsd arvan:` |
| `KAVENEGAR_API_KEY` / `ALERT_WEBHOOK` | فقط watchdog | `.env` |

بعد از هر چرخش: `docker compose exec -T app env | grep -E 'NODE_ENV|TZ'` باید `production` و `UTC` باشد و `pnpm smoke:prod` سبز.

## ۹. cron ها (کاربر `deploy`، ساعت تهران)

| زمان | دستور | چه می‌کند | کجا نتیجه را ببینم |
|---|---|---|---|
| هر روز ۰۲:۳۰ (۲۳:۰۰ UTC) | `backup.sh` | pg_dump + tar volume → age → rclone آروان → prune ۷ روز | `backups/backup.log`, `backups/LAST_OK` (timestamp), `backups/LAST_FAILURE` |
| جمعه ۰۶:۳۰ (۰۳:۰۰ UTC) | `restore-test.sh` | بازیابی آخرین dump در `app_restore_test` + مقایسهٴ شمارش‌ها (نیازمند `AGE_IDENTITY`؛ بدون کلید روی سرور خطای پیکربندی می‌دهد → از لپ‌تاپ اجرا کنید) | `backups/restore-test.log`, `backups/LAST_RESTORE_TEST` |
| هر ۱۰ دقیقه | `watchdog.sh` | دیسک > ۸۰٪، RAM < ۳۰۰ MB، بکاپ > ۲۶ ساعت، health، `worker` (نبودن/ناسالم، کار مرده در ۲۴ ساعت) | `watchdog.log` + webhook/پیامک (اگر تنظیم شده) |
| جمعه ۰۴:۰۰ (systemd timer `reboot-window`) | `shutdown -r +5` فقط اگر `/var/run/reboot-required` | ریبوت بعد از unattended-upgrades | `systemctl list-timers`, `journalctl -u reboot-window` |
| روزانه (apt timer) | `unattended-upgrades` | وصله‌های امنیتی اوبونتو | `/var/log/unattended-upgrades/` |
| — (هفتهٴ ۱) | پاک‌سازی `initial_password_enc` بعد از ۷۲ ساعت | هنوز نیست؛ تا آن زمان دستی: `update iam.auth_identity set initial_password_enc=null where initial_password_enc is not null and updated_at < now() - interval '72 hours'` (به‌عنوان `app_owner`؛ `updated_at` با هر تعیین رمز موقت تازه می‌شود) | — |

`crontab -l -u deploy` لیست فعلی؛ `bootstrap-server.sh` آن را می‌نویسد.

زمان‌بندهای **داخل برنامه** (جاروی فایل‌ها، انقضای بارگذاری‌ها، پاک‌سازی صف) crontab نیستند: سرویس `worker` آن‌ها را اجرا می‌کند (§۳-الف).

## ۱۰. تماس‌ها و مسیرها

- مدیر مدرسه / معاون: ............ · توسعه‌دهنده (شما): ............ · آروان (تیکت): panel.arvancloud.ir
- اگر ۱۵ دقیقه گذشت و حل نشد → `docs/ops/incident.md`.

### نقشِ دیتابیسِ کارگر (`app_worker`، مهاجرت `0032`)

کارگر با نقشِ خودش وصل می‌شود (`WORKER_DATABASE_URL`)؛ فقط او `app.claim_jobs` را اجرا و `ops.schedule` را می‌نویسد، و `app_rw` (وب) هیچ‌کدام را ندارد. نشانهٔ اشکال: در لاگ کارگر `permission denied for function claim_jobs` (کارگر با `app_rw` وصل شده — `WORKER_DATABASE_URL` تنظیم نیست یا `compose.yml` قدیمی است) یا هشدارِ `WORKER_DATABASE_URL is not set` (نقش هنوز ساخته نشده یا متغیر نیست). راه‌حل و بررسی: deploy/README.md «نقش app_worker».
