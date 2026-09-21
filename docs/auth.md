# احراز هویت — فاز ۱

منبع حقیقت: `src/modules/iam/{actions,session,repo,throttle,password,next-path,can,permissions}.ts`، `src/lib/{ctx,actions}`، `src/proxy.ts`. تست‌ها: `tests/int/auth.test.ts`، `tests/unit/{can,password,throttle,next-path}.test.ts`.

## اصل

امنیت در **لایهٴ داده** اعمال می‌شود: `getRequestContext()` (کوکی → نشست زنده در DB → حساب فعال → عضویت → نقش‌ها) و `defineAction`/`defineQuery` که هر اکشن و هر کوئری صفحه از آن می‌گذرد. `proxy.ts` فقط `x-request-id` می‌سازد و بدون کوکی به `/login?next=<مسیر>` می‌فرستد (راحتی، نه امنیت). `next` فقط مسیر نسبیِ همین مبدأ است (`safeNextPath` در `next-path.ts`: یک `/` در آغاز، نه `//` یا `/\`، بدون بک‌اسلش و نویسهٴ کنترلی — بازهٴ `\x00-\x1f\x7f` به‌صورت escape نوشته شده، نه بایت خام —، ≤ ۵۱۲ نویسه، نه صفحه‌های ورود/تغییر رمز)؛ هر چیز دیگری نادیده گرفته می‌شود و مقصد `/home` است. `loginAction` همین اعتبارسنجی را دوباره روی ورودی فرم انجام می‌دهد؛ URL مطلق هیچ‌وقت پذیرفته نمی‌شود. **کوکیِ مرده** (نشست باطل/منقضی/جعلی) از proxy می‌گذرد و در layout گروه‌های `(app)` و `(admin)` به `null` می‌رسد؛ آن‌جا هم مقصد `/login?next=<مسیر>` است: proxy مسیرِ درخواست را (همان `safeNextPath`) در هدر `x-next-path` به layout می‌دهد — همیشه بازنویسی/حذف می‌شود، پس کلاینت نمی‌تواند مقداری بفرستد — و `loginRedirectHref` (`src/lib/ctx.ts`) آن را دوباره می‌سنجد. راحتی است، نه ورودیِ مجوز؛ بدون proxy (تست‌ها) مقصد `/login` ساده است.

**صفحه‌های عمومی**: `/login`, `/help`, `/privacy`, `/~offline` (فهرست `PUBLIC_PATHS` در proxy). راهنما و حریم خصوصی در گروه `(public)` (`src/app/(public)/layout.tsx`) بدون نشست رندر می‌شوند — پوستهٴ سبکِ `PublicShell` با پیوند «ورود» — و از صفحهٴ ورود لینک دارند؛ با نشستِ زنده همان صفحه داخل `AppShell` می‌آید و با تغییر رمزِ معلق باز پوستهٴ عمومی (راهی به دور زدنِ `/change-password` نمی‌دهد).

## گردش ورود (`loginAction`)

1. یک فیلد «موبایل یا نام‌کاربری»: اگر شبیه شماره باشد → `normalizePhoneIR` → `+989…`؛ وگرنه نام‌کاربری کوچک‌شده. جست‌وجو در `user_account.login_identifier`.
2. یک کوئری تجمعی روی `iam.login_attempt` + جست‌وجوی حساب و هش (تراکنش سراسری).
3. **دقیقاً یک** `argon2id.verify` — با هش واقعی یا `DUMMY_HASH` وقتی حساب نیست/غیرفعال است/محدود شده. زمان پاسخ و بدنهٴ پاسخ برای همهٴ شکست‌ها یکی است: `{ ok:false, code:"UNAUTHENTICATED", message:"شماره یا رمز اشتباه است." }`.
4. ثبت تلاش همیشه (`iam.login_attempt`): `outcome` می‌گوید چرا — `bad_password` / `unknown` / `disabled` = رمز سنجیده شد و اشتباه بود؛ `locked` = **بدون داوری دربارهٴ رمز رد شد** (شناسه یا IP محدود شده، `locked_until` در آینده، `status='locked'`). فقط شکستِ سنجیده‌شده `failed_login_count++` می‌کند و پله‌های قفل را پیش می‌برد؛ تلاشِ ردشده فقط در سابقه می‌ماند.
5. در موفقیت: `failed_login_count=0`, `locked_until=NULL`, `last_login_at`، عضویت فعال (`is_default_org` اول، بعد قدیمی‌ترین) → `user_session.current_org_id`؛ بدون عضویت → «حساب شما به هیچ مدرسه‌ای متصل نیست» (بدون نشست).
6. کوکی + ریدایرکت: `must_change_password` → `/change-password`، وگرنه `next` معتبر یا `/home`.
7. فرم ورود پس از شکست شناسه را نگه می‌دارد و فقط رمز را خالی می‌کند (ورودیِ شناسه controlled است). `/login?out=1` یک اعلان «خارج شدید.» نشان می‌دهد.

## محدودسازی (`throttle.ts`)

| قاعده | پنجره | حد | اثر |
|---|---|---|---|
| شکستِ شمرده‌شده برای یک شناسه | ۱۵ دقیقه | ≥۵ | رد (قفل نرم؛ پاسخ همان پیام عمومی) |
| شکستِ شمرده‌شده برای یک شناسه | ۱ ساعت | ≥۱۰ | رد؛ دهمین شکستِ شمرده‌شده `locked_until = now()+1h` می‌گذارد |
| شکستِ شمرده‌شده برای یک شناسه | ۲۴ ساعت | ≥۲۰ | رد؛ بیستمین شکستِ شمرده‌شده `status='locked'` می‌گذارد (فقط مدیر باز می‌کند) |
| شکستِ شمرده‌شده برای (شناسه, IP) | ۱۵ دقیقه | ≥۵ | رد |
| شکست از یک IP (هر شناسه‌ای، ردشده‌ها هم) | ۱۰ دقیقه | ≥۳۰۰ | **فقط کُند** می‌شود: هر ورود از آن IP (موفق یا ناموفق) ۱ ثانیه (`slowDelayMs`) دیرتر پاسخ می‌گیرد |
| شکست از یک IP (هر شناسه‌ای، ردشده‌ها هم) | ۱۰ دقیقه | ≥۱۰۰۰ | رد (≈ ۱٫۷ شکست در ثانیه به‌طور پیوسته — هیچ مدرسه‌ای با دست به این‌جا نمی‌رسد) |

**چه چیزی شمرده می‌شود** (`countsForIdentifier` / `countsForIp` در `throttle.ts`، آینهٴ SQL همان فایل): ردیفِ `succeeded=false` که مدیر آن را پاک نکرده باشد (`cleared_at IS NULL`). پنجره‌های **شناسه** فقط شکستِ سنجیده‌شده را می‌شمارند (`outcome` غیر از `locked`؛ `NULL` = ردیف‌های قدیمی، شمرده می‌شوند): تلاشِ ردشده — حتی با رمزِ درست در میانِ قفل نرم — پنجره را طولانی‌تر نمی‌کند و به قفل یک‌ساعته/دائمی نمی‌رسد. پنجرهٴ **IP** ردشده‌ها را هم می‌شمارد تا حمله‌کننده‌ای که با وجودِ رد ادامه می‌دهد، محدود بماند. قاعدهٴ IP از آنجا که یک مدرسهٴ کامل پشتِ یک NAT است، تا ۱۰۰۰ فقط کُند می‌کند، نه رد.

**«رفع قفل»** (`unlockAccount`): `status='active'`, `failed_login_count=0`, `locked_until=NULL` **و** روی همهٴ شکست‌های پاک‌نشدهٴ ۲۴ ساعت اخیرِ همان شناسه `cleared_at=now()` می‌گذارد (مهاجرت `0014`)؛ ردیف‌ها برای سابقه می‌مانند و شمارشگرها آن‌ها را نمی‌بینند، پس ورود بلافاصله ممکن است. شمارِ ردیف‌های پاک‌شده در `audit` (`iam.account.unlocked`, `clearedAttempts`) ثبت می‌شود.

**«تعیین رمز موقت»** (`resetInitialPassword`) هم همین را می‌کند (دور دوم QA): رمز موقت باید همان لحظه کار کند، پس علاوه بر رمز جدید و ابطال همهٴ نشست‌ها، `failed_login_count=0`, `locked_until=NULL`, `status='locked'` → `'active'` (فقط قفلِ محدودسازی؛ حساب `disabled` — تصمیم مدیر — دست نمی‌خورد) و `clearRecentFailures` روی همان شناسه؛ ممیزی `iam.account.password_reset {personId, status, revokedSessions, clearedAttempts}` با `before` وضعیت/شمارنده/قفل.

IP از اولین مقدار `x-forwarded-for` (Caddy)، وگرنه `x-real-ip`، وگرنه `0.0.0.0`.

## نشست (`session.ts`)

- توکن: ۳۲ بایت تصادفی base64url؛ در DB فقط `sha256(token)`.
- کوکی: production → `__Host-session; Secure; HttpOnly; SameSite=Lax; Path=/`؛ development → نام `session` بدون Secure (مرورگرها پیشوند `__Host-` بدون Secure را رد می‌کنند).
- اعتبار: ۳۰ روز، لغزنده (وقتی کمتر از ۷ روز مانده، سطر تمدید و کوکی در اکشن بعدی دوباره صادر می‌شود). «این دستگاه عمومی است» → ۸ ساعت، کوکی نشستی (بدون Max-Age)، بدون تمدید.
- `last_seen_at` حداکثر هر ۵ دقیقه یک‌بار.
- خروج: `revoked_at=now()` + پاک‌کردن کوکی + ریدایرکت به `/login?out=1` که proxy روی آن `Clear-Site-Data: "cache", "storage"` می‌گذارد. `logoutAllAction` («خروج از همهٴ دستگاه‌ها») همهٴ سطرهای حساب را باطل می‌کند — اکشن و سرویس (`revokeAllForUser`) می‌مانند (تغییر رمز، «تعیین رمز موقت»، `pnpm sessions:revoke`)، اما ردیف آن در «بیشتر» فعلاً به تصمیم مالک (دور دوم QA) نشان داده نمی‌شود؛ فقط «خروج» با نشان قرمز.
- نشست باطل/منقضی/کوکی خراب → `getRequestContext()` = `null` → صفحه‌ها به `/login`، اکشن‌ها `UNAUTHENTICATED`.

## تغییر رمز (اجباری و اختیاری)

- **اجباری:** `user_account.must_change_password=true` (پیش‌فرض حساب جدید و خروجی seed). `defineAction`/`defineQuery` هر چیزی جز اکشن‌های `allowPasswordChangePending` (تغییر رمز، خروج) را با `PASSWORD_CHANGE_REQUIRED` رد می‌کند؛ layout گروه `(app)` هم به `/change-password` می‌فرستد. پرچم از DB خوانده می‌شود، پس دور زدن با کوکی ممکن نیست. فرم دو فیلد دارد (رمز جدید، تکرار) — رمز موقت همین الان در `/login` تایپ شده است.
- **اختیاری** («تغییر رمز» از «بیشتر»): فرم فیلد «رمز فعلی» را هم دارد و سرور — بر پایهٴ `must_change_password` در DB، نه شکل فرم — آن را الزامی می‌کند و با argon2 می‌سنجد (دقیقاً یک verify، محدودشده یا نه). رمز فعلیِ اشتباه = یک شکستِ ورودِ شمرده‌شده برای همان شناسه (`login_attempt` با `bad_password`، `failed_login_count++`، همان پله‌های قفل) و ممیزی `iam.account.password_change_rejected {reason: wrong_current}`؛ حسابِ محدودشده با **همان** پیام «رمز فعلی اشتباه است.» رد می‌شود (`outcome=locked`, `reason: throttled`). پس دستگاهِ بازمانده نمی‌تواند رمز فعلی را حدس بزند: همان بودجهٴ ۵ در ۱۵ دقیقهٴ فرم ورود، و با بیستم `status='locked'` که نشستِ همان دستگاه را هم می‌کُشد. این رد به‌جای throw **برگردانده** می‌شود تا تراکنشِ `defineAction` ردیفِ شکست را commit کند.
- سیاست رمز جدید (`password.ts`) در هر دو مسیر: حداقل ۸ (حداکثر ۱۲۸)، نه برابر شماره/نام‌کاربری (در همهٴ املاها، حتی با ارقام فارسی)، نه در فهرست رمزهای رایج، نه تکراری/ترتیبی، `newPassword === confirm`، و **نه برابر رمز فعلی** («رمز جدید نباید با رمز قبلی یکی باشد.» — رمز جدید با هشِ فعلی سنجیده می‌شود؛ پیش‌تر تغییر اجباری همان رمز موقت را می‌پذیرفت). پیام‌ها ارقام فارسی دارند («۸ نویسه»).
- پس از تغییر: هش جدید، `must_change_password=false`, `password_changed_at`, `initial_password_enc=NULL`، **همهٴ نشست‌های دیگرِ حساب باطل** می‌شوند (نشست جاری می‌ماند)؛ ممیزی `iam.account.password_changed {revokedSessions, forced}`.

## Cache-Control

`src/proxy.ts` روی هر مسیرِ غیرعمومی `Cache-Control: private, no-store` می‌گذارد. در production (`next start`) این هدر روی پاسخ‌های HTML/RSC و Route Handlerها می‌ماند: Next پیش‌فرضِ خودش را فقط وقتی می‌گذارد که هدری نباشد (`send-payload.js`: «if cache control is already set … we don't override it»؛ `send-response.js` هدرِ موجود را نگه می‌دارد). پاسخِ Server Actionها هدرِ بی‌قیدِ Next را می‌گیرد: `no-cache, no-store, max-age=0, must-revalidate` (`action-handler.js`) — باز هم `no-store`. فقط `next dev` پاسخِ صفحه‌ها را با `no-cache, must-revalidate` بازنویسی می‌کند (`base-server.js`، برای بازگردانیِ back/forward در توسعه) — همان چیزی که QA روی سرور توسعه دید؛ در production رخ نمی‌دهد (روی build آمادهٴ production تأیید شد: `/home`، `/inbox` و `/api/inbox/summary` با نشست → `private, no-store`).

## مجوزها

- کاتالوگ در `permissions.ts`؛ `pnpm seed` آن را با `iam.permission` و نقش‌های سیستمی همگام می‌کند.
- `iam.account.self` مجوز **ضمنی** است (رمز و نشست‌های خود)؛ در `role_permission` ذخیره نمی‌شود و `can()` برای هر عضو تأییدشده `true` می‌دهد.
- `can(tx, ctx, permission, ref?)`: زنجیرهٴ دامنهٴ `ref` با یک کوئری زیر RLS حل می‌شود (`class_offering → class_group → branch → school → organization`)؛ بدون `ref` = سطح سازمان. تخصیصِ `organization` همه‌چیز را می‌پوشاند؛ تخصیصِ محدود (مثلاً `school`) فقط اهدافی را که آن مدرسه در زنجیره‌شان است.

## بازنشانی رمز توسط مدیر (تا اکشن گام ۲)

اکشن `iam.account.reset_password` در گام ۲ می‌آید. تا آن زمان روی سرور با نقش `app_owner`:

```sql
-- هش جدید را با `tsx -e "import('./src/modules/iam/password.ts').then(m=>m.hashPassword('12345678x').then(console.log))"` بسازید
UPDATE iam.auth_identity SET secret_hash = '<PHC>' WHERE provider = 'password'
  AND user_account_id = (SELECT id FROM iam.user_account WHERE login_identifier = '+98912…');
UPDATE iam.user_account SET must_change_password = true, status = 'active', locked_until = NULL, failed_login_count = 0
  WHERE login_identifier = '+98912…';
UPDATE iam.user_session SET revoked_at = now() WHERE revoked_at IS NULL
  AND user_account_id = (SELECT id FROM iam.user_account WHERE login_identifier = '+98912…');
```

## دمو

`SEED_DEMO=1 pnpm seed:demo` (اختیاری: `SEED_DEMO_PASSWORD`, `SEED_DEMO_NO_FORCE=1`). جدول حساب‌ها و رمز یک‌بار چاپ می‌شود؛ اجرای دوباره رمزها را بازنشانی می‌کند.
