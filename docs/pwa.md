# نصب روی گوشی (PWA) — فاز ۱

منبع حقیقت: `src/app/manifest.ts`، `src/app/{icon,apple-icon}.tsx` + `src/app/icons/[file]/route.tsx` (نشان برنامه از `src/lib/pwa/app-icon.tsx`)، `src/lib/pwa/{sw,should-cache,client}.ts`، `scripts/build-sw.ts`، `src/components/shell/{ServiceWorkerRegistration,InstallPrompt,LogoutButton}.tsx`، صفحهٴ `src/app/~offline/page.tsx`، سرآیندهای امنیتی در `next.config.ts`. تست: `tests/unit/should-cache.test.ts`.

## نصب

- **اندروید / کروم**: در صفحهٴ خانه کارت «نصب برنامه روی گوشی» نشان داده می‌شود (رویداد `beforeinstallprompt` نگه داشته می‌شود و با دکمهٴ «نصب» به مرورگر داده می‌شود). «بعداً» کارت را ۷ روز پنهان می‌کند (`localStorage`، در `try/catch`). کروم خودش هم گزینهٴ «افزودن به صفحهٴ اصلی» را در منو دارد.
- **آیفون / سافاری**: همان کارت با دکمهٴ «راهنمای نصب» یک برگهٴ سه‌مرحله‌ای نشان می‌دهد: هم‌رسانی ← «افزودن به صفحهٴ اصلی» ← «افزودن». سافاری رویداد نصب ندارد؛ راه دیگری نیست.
- وقتی برنامه از صفحهٴ اصلی باز شود (`display-mode: standalone`) کارت پنهان است.
- مانیفست: `/manifest.webmanifest` با `lang: fa`، `dir: rtl`، `start_url: /home`، `display: standalone`، رنگ تم `#072AC8` (persian-blue)، پس‌زمینه `#F4F7FD`. نام از `PRODUCT_NAME` (اختیاری؛ پیش‌فرض «دانینو»؛ هرگز «همکلاسی»).
- آیکون‌ها با `ImageResponse` در زمان build ساخته می‌شوند (بدون فایل PNG در مخزن، بدون وابستگی تازه): `/icons/icon-192.png`، `/icons/icon-512.png`، `/icons/icon-512-maskable.png`، `/apple-icon` (۱۸۰) و `/icon/32` برای تب مرورگر. نشان: مربع گردِ آبی با کتاب باز سفید و نقطهٴ زرد.

## چه چیزی روی گوشی نگه داشته می‌شود؟ (فقط پوسته)

سرویس‌ورکر (`/sw.js`، ماژول ES، دامنهٴ `/`) **هیچ داده‌ای** را ذخیره نمی‌کند. تصمیم مسیریابی یک تابع خالص است (`shouldCache(url, request, origin)` در `src/lib/pwa/should-cache.ts`، با تست واحد):

| درخواست | رفتار |
|---|---|
| فایل‌های ایستای هش‌شدهٴ `/_next/static/*` | cache-first (`shell-static`؛ فونت‌ها در `shell-fonts`) |
| `/icons/*`، `/icon*`، `/apple-icon*`، `/favicon.ico` | cache-first (`shell-icons`) |
| **پیمایش صفحه‌ها، پاسخ‌های RSC (`?_rsc`، سرآیند `RSC`)، `/api/*`، هر درخواست غیر GET، هر دامنهٴ دیگر** | فقط شبکه — هرگز کش نمی‌شود |
| پیمایش بدون اینترنت | صفحهٴ ایستای `/~offline` («اتصال اینترنت برقرار نیست») از کش `shell-offline`؛ هنگام نصب ورکر همراه فایل‌های CSS/JS خودش ذخیره می‌شود |

بنابراین «پنل من» (کارتابل)، اعلان‌ها و صفحه‌های مدیریتی هیچ‌وقت آفلاین دیده نمی‌شوند و در گوشیِ مشترک، دانش‌آموز بعدی چیزی از نفر قبلی نمی‌بیند. Background Sync و Push در فاز ۱ نیست.

چرا نه `@serwist/next`؟ افزونهٴ وب‌پک آن زیر Turbopack (باندلر پیش‌فرض Next 16؛ `next build` با تنظیم `webpack` بدون `turbopack` با خطا خارج می‌شود) کار نمی‌کند و حالت پیکربندی‌اش بستهٴ `@serwist/cli` می‌خواهد که نداریم. ورکر ~۹۰ خط TypeScript است و `pnpm build` آن را با `scripts/build-sw.ts` (فقط `typescript.transpileModule`، بدون باندل) به `public/sw.js` + `public/sw-routing.js` تبدیل می‌کند؛ این دو فایل خروجیِ build و gitignore هستند. ثبت ورکر فقط در production انجام می‌شود (`ServiceWorkerRegistration`). `/sw.js` با `Cache-Control: no-cache` سرو می‌شود تا نسخهٴ تازه زود جای قبلی را بگیرد؛ در `activate` کش‌های ناشناخته پاک می‌شوند.

## خروج = پاک‌شدن همه‌چیز

دکمهٴ «خروج» (`LogoutButton`؛ ردیف «خروج از همهٴ دستگاه‌ها» فعلاً پنهان است — تصمیم مالک، دور دوم QA) اول همهٴ کش‌های Cache Storage این دامنه را حذف می‌کنند (`caches.keys()` ← `caches.delete`)، بعد اکشن سرور نشست را باطل و به `/login?out=1` هدایت می‌کند که سرور با `Clear-Site-Data: "cache", "storage"` پاسخ می‌دهد. ورکر ثبت‌شده می‌ماند (بی‌ضرر؛ فقط پوسته را دوباره می‌سازد).

## سرآیندهای امنیتی

برای هر مسیر (`next.config.ts › headers`): `Content-Security-Policy` (`default-src 'self'`؛ اسکریپت و استایل با `'unsafe-inline'` که بوت‌استرپ درون‌خطی Next لازم دارد — nonce به بعد موکول شد؛ در dev `'unsafe-eval'` و `ws:` هم برای React Refresh)، `X-Content-Type-Options: nosniff`، `X-Frame-Options: DENY`، `Referrer-Policy: strict-origin-when-cross-origin`، `Permissions-Policy: camera=(), microphone=(), geolocation=()`. HSTS را Caddy می‌دهد. `frame-ancestors 'none'`، `form-action 'self'`، `manifest-src 'self'`، `worker-src 'self'`.

بررسی: `curl -I https://<host>/login` باید همهٴ سرآیندهای بالا را نشان دهد؛ `curl https://<host>/manifest.webmanifest` باید `"dir":"rtl"` داشته باشد؛ در DevTools › Application › Service Workers ورکر `/sw.js` فعال و پس از خروج `caches.keys()` در کنسول `[]` باشد.
