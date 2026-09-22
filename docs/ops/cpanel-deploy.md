# استقرار روی cPanel + Passenger (خط لولهٴ GitHub Actions)

مسیر دوم استقرار، در کنار مسیر VPS/Docker (`deploy/README.md`). این‌جا میزبان یک اکانت **اشتراکی cPanel** است: بدون SSH، بدون Docker، با Node ۲۲ و **Phusion Passenger** از طریق *Application Manager*.

هدف: `git push` روی `main` ⟵ بیلد در GitHub Actions ⟵ آپلود با FTPS ⟵ سوئیچ اتمیک نسخه ⟵ ری‌استارت Passenger ⟵ health check ⟵ در صورت شکست، بازگشت خودکار.

---

## ۱. چرا بیلد روی cPanel اجرا نمی‌شود، و آرتیفکت چیست

`next build` به چند گیگابایت RAM، نصب کامل `node_modules` (بیش از ۱ گیگابایت) و زمان CPU نیاز دارد. اکانت اشتراکی هیچ‌کدام را ندارد (سقف حافظه و CPU مشترک است، فقط ~۱ گیگابایت دیسک آزاد داریم و اپراتور دسترسی شل ندارد). پس بیلد **فقط** روی رانر GitHub انجام می‌شود و چیزی که به سرور می‌رود یک بستهٴ آمادهٴ اجراست.

آرتیفکت را `scripts/package-release.mjs` از خروجی `output: "standalone"` می‌سازد:

| مسیر در بسته | از کجا | توضیح |
|---|---|---|
| `server.js`, `package.json` | `.next/standalone/` | سرور Node بدون نیاز به `next` سراسری |
| `node_modules/` | `.next/standalone/` | فقط وابستگی‌های ردیابی‌شده (نه کل نصب) |
| `drizzle/meta/_journal.json` | `.next/standalone/` | `/api/health` تعداد مهاجرت‌ها را از روی آن می‌شمارد |
| `.next/…` | `.next/standalone/.next/` | خروجی سرور |
| `.next/static/` | `.next/static/` | Next آن را عمداً داخل standalone نمی‌گذارد |
| `public/` | `public/` | `sw.js`، `sw-routing.js` و فایل‌های ثابت |
| `RELEASE.txt` | تولیدشده | `sha`، `built_at`، `node`، `base_path` |

اندازه: **۱۹۶۵ فایل ≈ ۳۰ مگابایت** (روی دیسک ≈ ۳۵ مگابایت). هیچ فایل `.env` داخل بسته نمی‌رود (اسکریپت آن‌ها را فیلتر می‌کند) — تمام مقادیر محیطی از UI خود cPanel می‌آید.

اجرای محلی برای بررسی (بعد از یک `pnpm build` موفق):

```bash
pnpm package:release release      # یا: node scripts/package-release.mjs release
```

> پوشهٴ `release/` در `.gitignore` هست. قبل از `pnpm lint` آن را پاک کنید؛ ESLint فایل‌های gitignore‌شده را نادیده نمی‌گیرد و لینت‌کردن ۳۰ مگابایت جاوااسکریپت بیلدشده کند است.

---

## ۲. ساختاری که روی سرور ساخته می‌شود

```
public_html/extra/66/school/          ← Application Root
├── app.js                            ← از deploy/cpanel/app.js، یک‌بار دستی آپلود می‌شود
├── current.txt                       ← یک خط: نام پوشهٴ نسخهٔ فعال
├── tmp/
│   └── restart.txt                   ← Passenger با تغییر این فایل اپ را ری‌استارت می‌کند
└── releases/
    ├── 20260922T140510Z-b354260/     ← یک بستهٔ کامل (server.js, .next, public, node_modules)
    └── 20260921T101133Z-624b651/     ← نسخهٔ قبلی، برای بازگشت
```

`app.js` هیچ کاری جز انتخاب نسخه نمی‌کند: `current.txt` را می‌خواند، نام را با `^[A-Za-z0-9._-]+$` اعتبارسنجی می‌کند (جلوگیری از path traversal)، وجود `releases/<name>/server.js` را بررسی می‌کند، یک خط لاگ روی stderr می‌نویسد و سپس آن فایل را `require` می‌کند. اگر `current.txt` نباشد یا نامعتبر باشد، با پیام صریح fail می‌کند و همان پیام در صفحهٔ خطای Passenger و `stderr.log` دیده می‌شود.

---

## ۳. تنظیمات دقیق cPanel → Application Manager

| فیلد | مقدار |
|---|---|
| Application Root | `public_html/extra/66/school` |
| Application URL | `app.3d-ul.ir` (**پیشنهادی**) یا `/extra/66/school` |
| Application Startup File | `app.js` |
| Application Mode | `Production` |
| Node.js version | `22` (مفسر: `/opt/cpanel/ea-nodejs22/bin/node`) |

### ساب‌دامین یا زیرمسیر؟ — ساب‌دامین را انتخاب کنید

با **ساب‌دامین** (`https://app.3d-ul.ir`) اپ در ریشهٔ دامنه سرو می‌شود و متغیر `BASE_PATH` باید **خالی** بماند.

با **زیرمسیر** (`https://3d-ul.ir/extra/66/school`) باید متغیر مخزن `BASE_PATH=/extra/66/school` را ست کنید تا `next.config.ts` مقدار `basePath` و `assetPrefix` را در زمان بیلد بگذارد؛ وگرنه همهٔ `/_next/*` ها ۴۰۴ می‌شوند. حتی با `BASE_PATH` درست، این سه مورد هنوز مسیر ریشه را hard-code کرده‌اند و روی زیرمسیر خراب می‌مانند:

- ثبت سرویس‌ورکر در `src/components/shell/ServiceWorkerRegistration.tsx` → `register("/sw.js", { scope: "/" })`
- `src/app/manifest.ts` → `start_url: "/home"`، `scope: "/"`، `icons: "/icons/…"`
- در نتیجه PWA (نصب روی گوشی و کش آفلاین) روی زیرمسیر کار نمی‌کند.

اصلاح این سه مورد تغییر کد اپلیکیشن است و از دامنهٔ این کار بیرون بود. **بنابراین برای PWA سالم، ساب‌دامین بسازید.**

### Cloudflare

برای ساب‌دامین یک رکورد `A` با نام `app` به IP اشتراکی `195.110.39.222` بسازید و پروکسی را **خاکستری (DNS only)** بگذارید. با ابر نارنجی، Cloudflare یک لایهٔ کش/TLS اضافه می‌کند که هم گواهی AutoSSL خود cPanel را بی‌اثر می‌کند و هم پاسخ‌های `no-store` سرویس‌ورکر را مبهم می‌کند. HSTS هم در این معماری کار Apache/Cloudflare است، نه اپ.

### متغیرهای محیطی (cPanel → Application Manager → Environment Variables)

همهٔ این‌ها را در UI خود cPanel وارد کنید (نه در مخزن، نه در بسته). اسکیمای معتبرشان `src/lib/env.ts` است و اپ اگر یکی نباشد بالا نمی‌آید:

| نام | الزامی | توضیح |
|---|---|---|
| `DATABASE_URL` | بله | رشتهٔ اتصال نقش `app_rw` (NOSUPERUSER NOBYPASSRLS). حتماً `?sslmode=require` چون دیتابیس روی همین هاست نیست |
| `MIGRATION_DATABASE_URL` | بله | رشتهٔ اتصال `app_owner`. اپ از آن استفادهٔ عملیاتی نمی‌کند ولی اسکیمای env آن را لازم دارد |
| `SESSION_SECRET` | بله | حداقل ۳۲ کاراکتر تصادفی؛ مبنای کلید نشست/CSRF |
| `INITIAL_PASSWORD_KEY` | بله | دقیقاً ۶۴ کاراکتر hex (۳۲ بایت) — کلید AES-256-GCM رمزهای اولیه |
| `PUBLIC_ORIGIN` | بله | دقیقاً همان URL نهایی، بدون اسلش پایانی: `https://app.3d-ul.ir` |
| `NODE_ENV` | بله | `production` |
| `DB_POOL_MAX` | پیشنهادی | روی هاست اشتراکی `5` (پیش‌فرض ۲۰ برای این حافظه زیاد است) |
| `APP_VERSION` | پیشنهادی | sha کوتاه نسخه؛ در `/api/health` و لاگ `app.js` دیده می‌شود |
| `PRODUCT_NAME` | اختیاری | پیش‌فرض «سامانهٴ مدرسه» |
| `LOG_LEVEL` | اختیاری | پیش‌فرض `info` |
| `FILES_DIR` | اختیاری | پیش‌فرض `/data/files`؛ روی cPanel به مسیری داخل هوم ست کنید، مثلاً `/home/dul/app-files` |
| `TZ` | اختیاری | `UTC` — تاریخ‌ها UTC ذخیره می‌شوند و در نمایش به Asia/Tehran تبدیل می‌شوند |

`PORT` را ست نکنید؛ Passenger خودش آن را به فرایند می‌دهد و `server.js` همان را می‌خواند.

---

## ۴. حساب FTP و تنظیمات GitHub

### حساب FTP (cPanel → FTP Accounts)

1. **Log In**: مثلاً `deploy` (نام کامل می‌شود `deploy@3d-ul.ir`).
2. **Directory**: `public_html/extra/66/school` — حتماً محدود به همین پوشه، نه هوم.
3. **Quota**: `Unlimited` (یا دست‌کم ۲۰۰ مگابایت).
4. رمز را تصادفی و طولانی بسازید و **فقط از حروف و ارقام** استفاده کنید؛ کاراکترهای `"`، `\` و `,` در اسکریپت `lftp` دردسر نقل‌قول می‌سازند.

### Secrets (GitHub → Settings → Secrets and variables → Actions → *Secrets*)

| نام | مقدار |
|---|---|
| `FTP_HOST` | فقط نام میزبان، بدون `ftp://` — مثلاً `3d-ul.ir` |
| `FTP_USERNAME` | نام کامل حساب FTP |
| `FTP_PASSWORD` | رمز همان حساب |

### Variables (همان صفحه → *Variables*)

| نام | مقدار |
|---|---|
| `FTP_SERVER_DIR` | مسیر اپ **از دید همان حساب FTP**. اگر حساب به پوشهٔ اپ محدود شده باشد `/` است؛ اگر حساب اصلی را بدهید `/public_html/extra/66/school/` |
| `BASE_PATH` | خالی برای ساب‌دامین؛ `/extra/66/school` برای زیرمسیر |
| `HEALTH_URL` | `https://app.3d-ul.ir/api/health` (با زیرمسیر: `https://3d-ul.ir/extra/66/school/api/health`) |
| `FTP_TLS_VERIFY` | اختیاری. پیش‌فرض `true`. فقط اگر گواهی FTP هاست با نام میزبان نخواند، `false` بگذارید — رمز همچنان رمزنگاری می‌شود ولی در برابر MITM محافظت نمی‌شوید |

هیچ‌وقت مقدار این‌ها را در issue، commit یا لاگ ننویسید. ورک‌فلو روی رمز `::add-mask::` می‌زند و خود GitHub هم secrets را در لاگ ماسک می‌کند.

---

## ۵. اولین استقرار (یک‌بار، دستی)

1. اپلیکیشن را در Application Manager با تنظیمات بخش ۳ بسازید (هنوز start نکنید).
2. با File Manager یا FTP، فایل `deploy/cpanel/app.js` را در ریشهٔ اپ آپلود کنید (نامش دقیقاً `app.js`).
3. پوشهٔ خالی `tmp/` را بسازید.
4. متغیرهای محیطی را وارد و ذخیره کنید.
5. مهاجرت‌ها و سید کاتالوگ را **از ماشین توسعه** اجرا کنید (بخش ۶).
6. در GitHub، ورک‌فلو `Deploy to cPanel (Passenger)` را با *Run workflow* اجرا کنید (`restart_only` = false). اولین اجرا `current.txt` را می‌سازد.
7. چک‌لیست بخش ۸ را انجام دهید.

---

## ۶. مهاجرت و سید — فقط دستی، از ماشین توسعه

**خط لوله هیچ‌وقت به دیتابیس دست نمی‌زند**: نه migration، نه seed، نه `drizzle-kit`. دلیلش ساده است: یک استقرار خودکار نباید بتواند اسکیمای تولید را عوض کند، و رانر GitHub اصلاً نباید اعتبارنامهٔ `app_owner` را ببیند.

از ویندوز، با `.env` لوکالی که `MIGRATION_DATABASE_URL` آن به دیتابیس تولید اشاره می‌کند:

```powershell
pnpm db:migrate     # فایل‌های SQL پوشهٔ drizzle/ — قبل از استقرار نسخه‌ای که به آن نیاز دارد
pnpm seed           # سید کاتالوگ (مجوزها، نقش‌های سیستمی)؛ idempotent است
```

ترتیب درست برای یک تغییر اسکیما: **اول** `pnpm db:migrate` (مهاجرت‌ها additive هستند و با کد قدیمی هم کار می‌کنند)، **بعد** push روی `main`. مقدار `pendingMigrations` در `/api/health` باید بعدش `0` شود.

---

## ۷. بازگشت (rollback) و نگه‌داری نسخه‌ها

### خودکار

ورک‌فلو **قبل از** نوشتن `current.txt` جدید، `current.txt` فعلی را دانلود و نگه می‌دارد. اگر health check بعد از ری‌استارت سبز نشود، همان فایل قدیمی را دوباره آپلود می‌کند، `tmp/restart.txt` را می‌زند و بعد جاب را fail می‌کند. یعنی سایت به نسخهٔ سالم قبلی برمی‌گردد ولی استقرار «موفق» علامت نمی‌خورد.

### دستی (File Manager)

1. `releases/` را باز کنید و نام نسخهٔ سالم را بردارید.
2. `current.txt` را ویرایش کنید: همان یک خط، بدون فاصلهٔ اضافه.
3. `tmp/restart.txt` را ویرایش و ذخیره کنید (یا حذف و دوباره بسازید) تا mtime عوض شود.
4. `/api/health` را چک کنید.

### نگه‌داری

**فقط ۳ نسخهٔ آخر را نگه دارید.** هر نسخه ≈ ۳۵ مگابایت و کل فضای آزاد ~۱ گیگابایت است. پوشه‌های قدیمی‌تر را در File Manager پاک کنید (هیچ‌وقت پوشه‌ای را که نامش در `current.txt` است پاک نکنید). خط لوله عمداً چیزی را حذف نمی‌کند (`dangerous-clean-slate` معادل ندارد؛ `mirror` بدون `--delete` اجرا می‌شود) تا یک اشتباه در مسیر، اپ را نابود نکند.

---

## ۸. چک‌لیست تأیید بعد از هر استقرار

**فرانت‌اند**
- [ ] `/login` باز می‌شود و RTL و فونت Vazirmatn درست است (نه فونت پیش‌فرض سیستم).
- [ ] CSS لود شده (کارت‌های سفید روی زمینهٔ `canvas`)، یعنی `/_next/static/**` ۲۰۰ می‌دهد.
- [ ] کنسول مرورگر بدون خطا؛ به‌خصوص بدون ۴۰۴ روی `/_next/*` (نشانهٔ `BASE_PATH` غلط).

**بک‌اند**
- [ ] `curl -s https://app.3d-ul.ir/api/health` ⟵ `{"ok":true,"db":"up","pendingMigrations":0,…}`
- [ ] `version` در همان پاسخ با sha نسخه‌ای که منتشر کردید بخواند (اگر `APP_VERSION` ست شده باشد).

**احراز هویت**
- [ ] ورود با یک حساب واقعی.
- [ ] مسیر «تغییر اجباری رمز» برای حسابی که تازه ساخته شده کار کند.
- [ ] خروج (logout) و برگشتن به `/login`.

**دیتابیس**
- [ ] یک صفحهٔ فهرست با داده باز شود (مثلاً فهرست کاربران یا کارها) — یعنی RLS و اتصال `app_rw` سالم است.

**PWA و فایل‌های ثابت**
- [ ] `/manifest.webmanifest` ۲۰۰ و JSON معتبر.
- [ ] `/sw.js` ۲۰۰ با هدر `Service-Worker-Allowed: /` و `Cache-Control: no-cache`.
- [ ] `/icons/icon-192.png` و `/icons/icon-512.png` ۲۰۰.
- [ ] روی اندروید «افزودن به صفحهٔ اصلی» پیشنهاد شود.

**هدرهای امنیتی**

```bash
curl -I https://app.3d-ul.ir/login
```
- [ ] `Content-Security-Policy` (از `next.config.ts`)، `X-Content-Type-Options: nosniff`، `X-Frame-Options: DENY`، `Referrer-Policy`، `Permissions-Policy`.
- [ ] `Strict-Transport-Security` را **اپ نمی‌فرستد**؛ روی این میزبان کار Apache/cPanel (AutoSSL + `.htaccess`) یا Cloudflare است. اگر لازم است، در `.htaccess` ریشهٔ دامنه اضافه شود.

**زیرمسیر (فقط اگر ساب‌دامین نساختید)**
- [ ] `/extra/66/school/_next/static/...` ۲۰۰ می‌دهد.
- [ ] می‌دانید که PWA روی زیرمسیر کار نمی‌کند (بخش ۳).

---

## ۹. محدودیت‌های شناخته‌شدهٔ این میزبان

- **دیتابیس روی این cPanel نیست.** این اکانت PostgreSQL ندارد؛ فقط MySQL/MariaDB. کل اپ روی Postgres ۱۶ با RLS بنا شده و MySQL جایگزین نیست. یعنی `DATABASE_URL` باید به یک Postgres بیرونی (همان VPS فعلی یا یک سرویس مدیریت‌شده) با `sslmode=require` وصل شود و تأخیر شبکه به هر کوئری اضافه می‌شود. **تا وقتی این Postgres آماده نباشد، استقرار cPanel بالا نمی‌آید.**
- **حافظه و CPU مشترک.** Passenger ممکن است فرایند را در اوج مصرف بکشد. `DB_POOL_MAX=5` و پرهیز از گزارش‌های سنگین ضروری است.
- **خوابیدن اپ در بی‌کاری.** Passenger بعد از چند دقیقه بی‌درخواستی فرایند را خاموش می‌کند؛ اولین درخواست بعدی چند ثانیه طول می‌کشد (به همین دلیل health check تا ۱۰ بار تلاش می‌کند). اگر آزاردهنده شد، یک مانیتور بیرونی هر ۵ دقیقه `/api/health` را بزند.
- **بدون SSH و بدون cron قابل اتکا برای بکاپ.** بکاپ دیتابیس باید از جای دیگری (VPS یا ماشین توسعه) گرفته شود — `deploy/backup/` و `docs/ops/runbook.md`. هیچ بکاپی از این اکانت گرفته نمی‌شود.
- **بدون دسترسی شل برای اپراتور.** تنها ابزارهای عملیاتی: File Manager، Application Manager و لاگ‌های Passenger (`stderr.log` در ریشهٔ اپ).
- **FTPS نه SFTP.** آپلود روی TLS صریح است ولی FTP روی هاست اشتراکی از SFTP ضعیف‌تر است؛ رمز حساب FTP را فقط به همین پوشه محدود نگه دارید و دوره‌ای عوض کنید.
- **بدون deploy اتمیک کامل.** آپلود ۳۰ مگابایت چند دقیقه طول می‌کشد، ولی چون نسخه در پوشهٔ جدید می‌نشیند و فقط `current.txt` سوئیچ می‌کند، کاربر هیچ‌وقت نسخهٔ نیمه‌آپلودشده نمی‌بیند.
