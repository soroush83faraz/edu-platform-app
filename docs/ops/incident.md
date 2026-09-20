# رسیدگی به رخداد (Incident) — فاز ۱

یک صفحه؛ چاپ کنید و کنار لپ‌تاپ بگذارید. دستورها روی سرور در `/srv/school` با کاربر `deploy` اجرا می‌شوند مگر گفته شود «ماشین توسعه». جزئیات هر دستور در `docs/ops/runbook.md`.

## سطح‌ها

| سطح | یعنی | واکنش | مثال |
|---|---|---|---|
| **S1 — نشت یا دستکاری داده** | احتمال دیده‌شدن دادهٴ یک مدرسه توسط غیر، دسترسی ناخواسته به سرور/DB، secret بیرون رفته، حساب مدیر در دست غریبه | **همین حالا**: «۳۰ دقیقهٴ اول» کامل + اطلاع به مدیر مدرسه در همان ساعت | کاربری کار مدرسهٴ دیگر را می‌بیند؛ `.env` در چت/ریپو؛ ورود ناشناس با حساب مدیر |
| **S2 — سرویس پایین یا رفتار غلط گسترده** | هیچ‌کس وارد نمی‌شود، health قرمز، دیتابیس پر/خراب، گواهی TLS منقضی | تا ۱۵ دقیقه شروع؛ بازگشت به آخرین ایمیج/بکاپ سالم | ۵۰۰ روی همهٴ صفحه‌ها بعد از deploy؛ دیسک پر |
| **S3 — یک کاربر / یک قابلیت** | حساب قفل، رمز فراموش، یک کار دیده نمی‌شود، بکاپ دیشب شکست خورده | همان روز؛ runbook §۶–۹ | «سارا وارد نمی‌شود»؛ `LAST_FAILURE` |

اگر شک دارید S1 است یا نه: S1 فرض کنید. ابطال نشست‌ها و تغییر رمز اجباری برگشت‌پذیرند؛ نشت نه.

## ۳۰ دقیقهٴ اول (S1) — به همین ترتیب

زمان شروع را بنویسید: `date -u` → ............

1. **جلوی گسترش را بگیر (۲ دقیقه)**
   ```bash
   pnpm sessions:revoke --all --yes                 # ماشین توسعه، DATABASE_URL سرور — یا روی سرور:
   docker compose exec -T db psql -U app_owner -d app -c "update iam.user_session set revoked_at = now() where revoked_at is null"
   ```
   اگر حسابِ مشخصی مشکوک است، فقط او را قفل کنید: `update iam.user_account set status='locked' where login_identifier='+98912…'`.
2. **تغییر رمز اجباری سازمان‌گستر (۱ دقیقه)** — به‌عنوان `app_owner`؛ ورود بعدی همه به `/change-password` می‌رود، هیچ اکشنی تا تغییر رمز اجرا نمی‌شود:
   ```sql
   update iam.user_account set must_change_password = true
    where id in (select user_account_id from iam.organization_membership m
                 join tenancy.organization o on o.id = m.organization_id
                where o.slug = '<slug>' and m.status = 'active');
   -- همهٴ سازمان‌ها: where id in (select user_account_id from iam.organization_membership where status='active')
   ```
   (`organization_membership` زیر FORCE RLS است و `app_owner` هم مشمول؛ برای این کوئری در همان تراکنش `select set_config('app.current_org_id','<uuid سازمان>',true)` بزنید یا مسیر «همهٴ سازمان‌ها» را با `iam.user_account` مستقیم: `update iam.user_account set must_change_password = true where status = 'active'`.)
   اگر رمزهای اولیه در خطرند (برگه‌ها گم شده): علاوه بر آن `update iam.auth_identity set initial_password_enc = null` و `INITIAL_PASSWORD_KEY` را بچرخانید (runbook §۸).
3. **چرخش secret ها (۵ دقیقه)** — runbook §۸: `SESSION_SECRET` (بی‌ضرر، همیشه)، `INITIAL_PASSWORD_KEY` اگر برگه/DB لو رفته، رمزهای Postgres اگر `.env` یا dump بدون رمزگذاری بیرون رفته (`ALTER ROLE … PASSWORD` + `.env` + `docker compose up -d app`)، کلیدهای S3 اگر `rclone.conf` لو رفته. بعد: health + `pnpm smoke:prod`.
4. **اسنپ‌شات و شواهد (۵ دقیقه)** — قبل از هر «تمیزکاری»:
   - پنل آروان → سرور → **Snapshot** (نام: `incident-<date>`).
   - `mkdir -p /srv/school/incident-$(date -u +%Y%m%dT%H%M) && cd $_`
   - `docker compose logs --no-color --since 72h app > app.log; docker compose logs --no-color --since 72h caddy > caddy.log; docker compose logs --no-color --since 72h db > db.log`
   - `sudo journalctl --since "3 days ago" > journal.log; sudo cp /var/log/auth.log* . ; last -a > last.txt; ss -tunap > ss.txt; docker ps -a > ps.txt`
   - `docker compose exec -T db pg_dump -Fc -U app_backup app > db-incident.dump` و `docker compose exec -T db psql -U app_backup -d app -c "\copy (select * from iam.login_attempt where at > now() - interval '3 days' order by at) to 'login_attempt.csv' csv header"` (خروجی داخل کانتینر است؛ با `docker compose cp db:/login_attempt.csv .` بیرون بیاورید) و همین برای `audit.audit_log`.
   - `chmod -R 600 .`؛ به سرور دیگری کپی نکنید مگر رمزگذاری‌شده (`age -r`).
5. **مسیر ورود را ببند (۵ دقیقه)** — اگر مشخص است: کلید ssh مشکوک از `authorized_keys`، `ufw status`، `docker compose ps` (کانتینر ناشناس؟)، `crontab -l`، `git status` روی ماشین توسعه (کد تغییر کرده؟). اگر خود سرور مشکوک است: ترافیک را نگه دارید (`docker compose stop caddy`) و از اسنپ‌شات/سرور تازه با `bootstrap-server.sh` بازسازی کنید — بکاپ رمزشدهٴ آروان + کلید age در پاکت برای همین لحظه است.
6. **اطلاع (۵ دقیقه)** — تماس با مدیر مدرسه (قالب پایین)؛ زمان و آنچه می‌دانید/نمی‌دانید را صادقانه؛ چه کاری از کاربران می‌خواهید (رمز جدید در اولین ورود). وعدهٴ زمان بعدی‌ گزارش بدهید (مثلاً ۲ ساعت بعد).

بعد از ۳۰ دقیقه: بازگشت کد به آخرین commit سالم (`git tag phase1-freeze`، `rollback.sh`)، یا بازیابی داده از بکاپ (runbook §۴) اگر داده دستکاری شده. ۲۴ ساعت بعد: گزارش کوتاه (چه شد، از کی تا کی، چه دیده شد، چه تغییر کرد) در همین پوشه `docs/ops/incidents/<date>.md`.

## S2 — سرویس پایین

1. `docker compose ps` + health (runbook §۰). `df -h` — اگر دیسک پر: `docker system prune -f`, حذف `backups/pre-*.dump` قدیمی، `journalctl --vacuum-size=200M`.
2. تازه deploy شده؟ → `bash rollback.sh` (۱ دقیقه). نه؟ → `docker compose restart app`، بعد `db`.
3. TLS: `docker compose logs --tail=50 caddy`؛ اگر «certificate» خطا دارد: DNS و پورت ۸۰/۴۴۳ (`ufw status`); Caddy خودش ZeroSSL را هم می‌آزماید.
4. DB خراب/پر: بکاپ دیشب + runbook §۴. هیچ‌وقت `pgdata` را دستی حذف نکنید.
5. اگر ۳۰ دقیقه گذشت: به مدیر مدرسه بگویید سرویس تا ساعت … پایین است و کارها را روی کاغذ/پیام‌رسان ادامه دهند.

## چه چیزهایی را **نباید** کرد

- رمز، `.env`، dump یا کلید age را در چت/ایمیل/پیام‌رسان نفرستید — حتی به خودتان.
- قبل از اسنپ‌شات و کپی لاگ، کانتینر یا سرور را پاک نکنید.
- روی production چیزی «تست» نکنید؛ dump رمزشده را روی لپ‌تاپ بازیابی کنید.
- `SEED_DEMO` یا `drizzle-kit push` هرگز.

## کی را صدا بزنم

| نقش | نام | تلفن | کِی |
|---|---|---|---|
| توسعه‌دهنده / مسئول فنی | ............ | ............ | همیشه اول |
| مدیر مدرسه | ............ | ............ | S1 در همان ساعت؛ S2 بعد از ۳۰ دقیقه |
| معاون (کانال پشتیبانی) | ............ | ............ | S3 |
| پشتیبانی آروان | تیکت / ۱۰۰۰-۰۲۱ | panel.arvancloud.ir | سرور بالا نمی‌آید، اسنپ‌شات، شبکه |
| ثبت‌کنندهٴ دامنه | ............ | ............ | DNS |

## قالب پیام به مدرسه (S1 — نشت احتمالی)

> سلام آقای/خانم ............، ............ هستم، مسئول فنی سامانهٴ مدرسه.
> امروز ساعت ...... متوجه شدیم که احتمال دارد ............ (مثلاً: «حساب یکی از کاربران بدون اجازه استفاده شده» / «یک دستگاه با دسترسی به سامانه گم شده»). برای احتیاط، **همهٴ کاربران را از سامانه خارج کردیم و در ورود بعدی از همه خواسته می‌شود رمز تازه‌ای انتخاب کنند.**
> تا این لحظه نشانه‌ای از ............ (خروج/تغییر داده‌ها) ندیده‌ایم / دیده‌ایم که ............ .
> از شما می‌خواهم: (۱) به دبیران و دانش‌آموزان بگویید در ورود بعدی رمز جدید بگذارند؛ (۲) اگر کسی پیام یا رفتار مشکوکی دید به شما یا من خبر دهد؛ (۳) برگه‌های رمز اولیهٴ توزیع‌نشده را دور از دسترس نگه دارید.
> ساعت ...... دوباره تماس می‌گیرم و نتیجهٴ بررسی را می‌گویم. اطلاعات دانش‌آموزان طبق اطلاعیهٴ حریم خصوصی فقط در سرور ایران است و نسخهٴ پشتیبان رمزگذاری‌شده داریم.

## قالب پیام (S2 — قطعی)

> سلام، سامانهٴ مدرسه از ساعت ...... در دسترس نیست. علت ............ است و در حال رفع آن هستیم. پیش‌بینی می‌کنم تا ساعت ...... برگردد. کارهای امروز از دست نمی‌رود؛ لطفاً تا آن زمان ثبت جدید انجام ندهید. به‌محض برگشت خبر می‌دهم.
