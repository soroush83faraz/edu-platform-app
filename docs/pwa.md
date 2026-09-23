# نصب روی گوشی (PWA) — فاز ۱

منبع حقیقت: `src/app/manifest.ts`، `src/app/layout.tsx` (`appleWebApp`، `viewport`، نوار وضعیت)، `src/app/{icon,apple-icon}.tsx` + `src/app/icons/[file]/route.tsx` + `src/app/splash/[file]/route.tsx` (نشان برنامه و صفحهٴ آغاز از `src/lib/pwa/app-icon.tsx`، جدولِ اندازه‌ها در `src/lib/pwa/splash.ts`)، `src/lib/pwa/{sw,should-cache,client}.ts`، `scripts/build-sw.ts`، `src/components/shell/{ServiceWorkerRegistration,InstallPrompt,LogoutButton}.tsx`، صفحهٴ `src/app/~offline/page.tsx`، سرآیندهای امنیتی در `next.config.ts`. تست: `tests/unit/should-cache.test.ts`، `tests/unit/pwa-install.test.ts`، `tests/unit/brand.test.ts`.

## نصب روی گوشی

نوارِ نشانیِ مرورگر و خطِ سرآیندش **مالِ مرورگر است، نه برنامه**: در یک زبانهٴ معمولیِ کروم یا سافاری هیچ صفحه‌ای نمی‌تواند آن را بردارد. تنها راهِ دیدنِ برنامه **بدون نوار مرورگر** این است که یک‌بار روی صفحهٴ اصلیِ گوشی نصب شود و از همان آیکون باز شود.

- **اندروید (کروم)**: منوی سه‌نقطهٔ کروم ← «افزودن به صفحهٴ اصلی» (یا «نصب برنامه») ← «نصب». یا در صفحهٴ خانه روی کارت «نصب برنامه روی گوشی» دکمهٴ «نصب» را بزنید.
- **آیفون و آی‌پد (سافاری)**: دکمهٴ «هم‌رسانی» (Share) در نوار پایین ← «افزودن به صفحهٴ اصلی» (Add to Home Screen) ← «افزودن». نصب فقط از خودِ سافاری ممکن است. کارت خانه با «راهنمای نصب» همین سه گام را نشان می‌دهد.
- **بعد از نصب** فقط آیکونِ «دانینو» روی صفحهٴ اصلی برنامه را بی‌نوارِ مرورگر باز می‌کند؛ اگر همان نشانی را در زبانهٴ مرورگر باز کنید، نوار نشانی سرِ جایش است — این رفتارِ مرورگر است و از سمت ما برداشتنی نیست.

### چه چیزی آن را بی‌نوار می‌کند

- **مانیفست** (`/manifest.webmanifest`): `display: standalone` با `display_override: ["standalone", "minimal-ui"]` (مرورگری که standalone ندارد، نوارِ کوچکِ برگشت/بارگذاری می‌گیرد نه زبانهٴ کامل)؛ `id: "/"` (شناسهٴ نصب‌های قبلی — عوض نمی‌شود)، `start_url: /home`، `scope: /` (هیچ پیوندی از برنامه بیرون نمی‌افتد)، `orientation: portrait`، `lang: fa`، `dir: rtl`؛ `theme_color` = `#072AC8` (persian-blue — رنگِ نوار وضعیتِ اندروید)، `background_color` = `#E8EEF9` (`canvas`، زمینهٴ صفحه‌ها — صفحهٴ آغازِ اندروید بی‌پرش به اولین نقاشی می‌رسد). نام از `PRODUCT_NAME` (اختیاری؛ پیش‌فرض «دانینو»؛ هرگز «همکلاسی»).
- **آیفون** (`metadata.appleWebApp` در `src/app/layout.tsx`): `apple-mobile-web-app-capable` (Next 16 خودش فقط `mobile-web-app-capable` را می‌نویسد؛ نامِ اپل برای iOS پیش از ۱۶٫۴ از `metadata.other` می‌آید)، `apple-mobile-web-app-status-bar-style: black-translucent` (صفحه زیرِ نوار وضعیت کشیده می‌شود و متنِ نوار سفید است)، `apple-mobile-web-app-title` = «دانینو»، و برای هر اندازهٴ آیفون/آی‌پد یک `apple-touch-startup-image` با media query دقیقِ دستگاه (۱۶ اندازه، فقط عمودی) تا به‌جای صفحهٴ سفید، آیکونِ برنامه روی زمینهٴ `canvas` دیده شود.
- **نوار وضعیت رنگ می‌گیرد، نه نوار سفید**: `viewport-fit=cover` و `theme-color` = persian-blue؛ در `body` یک نوارِ ثابت به بلندیِ `env(safe-area-inset-top)` با `bg-primary-600` هست — روی آیفونِ نصب‌شده همان‌جایی را که نوار وضعیتِ شفاف رویش می‌نشیند آبی می‌کند، و هر جای دیگر (زبانهٴ مرورگر، دسکتاپ، اندروید) بلندی‌اش صفر است. سرآیندِ گوشی در `AppShell` بلندی‌اش `3.5rem + safe-area-inset-top` است و محتوایش را با همان مقدار پایین می‌برد؛ `PublicShell` هم همین را دارد، صفحه‌های ورود با `max(2rem, safe-area-inset-top)` و نوار پایین با `safe-area-inset-bottom`.
- کارت «نصب برنامه روی گوشی» (`InstallPrompt`، فقط در خانه): اندروید رویداد `beforeinstallprompt` را نگه می‌دارد و با «نصب» به مرورگر می‌دهد؛ آیفون برگهٴ سه‌گامی می‌گیرد. «بعداً» کارت را ۷ روز پنهان می‌کند (`localStorage`، در `try/catch`). وقتی برنامه نصب‌شده باز شده (`display-mode: standalone` یا `minimal-ui`، یا `navigator.standalone` در iOS) کارت نیست.
- آیکون‌ها با `ImageResponse` ساخته می‌شوند (بدون فایل PNG در مخزن، بدون وابستگی تازه): `/icons/icon-192.png`، `/icons/icon-512.png` (`purpose: any`)، `/icons/icon-512-maskable.png` (`purpose: maskable`، تمام‌رخ با نشان در ناحیهٴ امنِ ۸۰٪)، `/apple-icon` (۱۸۰، تمام‌رخ — iOS گوشه‌ها را خودش گرد می‌کند)، `/icon/32` و `/icon/192` برای تب مرورگر، و `/splash/apple-splash-<عرض>x<ارتفاع>.png`. نشان: مونوگرامِ «D»ِ «دانینو»، سفید روی مربعِ گردِ persian-blue (هندسه در `src/lib/brand/mark.ts`، همان نشانِ ریل دسکتاپ).

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
