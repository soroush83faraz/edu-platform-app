# احراز هویت — فاز ۱

منبع حقیقت: `src/modules/iam/{actions,session,repo,throttle,password,can,permissions}.ts`، `src/lib/{ctx,actions}`، `src/proxy.ts`. تست‌ها: `tests/int/auth.test.ts`، `tests/unit/{can,password,throttle}.test.ts`.

## اصل

امنیت در **لایهٴ داده** اعمال می‌شود: `getRequestContext()` (کوکی → نشست زنده در DB → حساب فعال → عضویت → نقش‌ها) و `defineAction`/`defineQuery` که هر اکشن و هر کوئری صفحه از آن می‌گذرد. `proxy.ts` فقط `x-request-id` می‌سازد و بدون کوکی به `/login` می‌فرستد (راحتی، نه امنیت).

## گردش ورود (`loginAction`)

1. یک فیلد «موبایل یا نام‌کاربری»: اگر شبیه شماره باشد → `normalizePhoneIR` → `+989…`؛ وگرنه نام‌کاربری کوچک‌شده. جست‌وجو در `user_account.login_identifier`.
2. یک کوئری تجمعی روی `iam.login_attempt` + جست‌وجوی حساب و هش (تراکنش سراسری).
3. **دقیقاً یک** `argon2id.verify` — با هش واقعی یا `DUMMY_HASH` وقتی حساب نیست/غیرفعال است/محدود شده. زمان پاسخ و بدنهٴ پاسخ برای همهٴ شکست‌ها یکی است: `{ ok:false, code:"UNAUTHENTICATED", message:"شماره یا رمز اشتباه است." }`.
4. ثبت تلاش (موفق/ناموفق) همیشه؛ در شکست `failed_login_count++` و پله‌های قفل (جدول زیر).
5. در موفقیت: `failed_login_count=0`, `last_login_at`، عضویت فعال (`is_default_org` اول، بعد قدیمی‌ترین) → `user_session.current_org_id`؛ بدون عضویت → «حساب شما به هیچ مدرسه‌ای متصل نیست» (بدون نشست).
6. کوکی + ریدایرکت: `must_change_password` → `/change-password`، وگرنه `/home`.

## محدودسازی (`throttle.ts`)

| قاعده | پنجره | حد | اثر |
|---|---|---|---|
| شکست برای یک شناسه | ۱۵ دقیقه | ≥۵ | رد (قفل نرم؛ پاسخ همان پیام عمومی) |
| شکست برای یک شناسه | ۱ ساعت | ≥۱۰ | رد + با شکست بعدی `locked_until = now()+1h` |
| شکست برای یک شناسه | ۲۴ ساعت | ≥۲۰ | رد + با شکست بعدی `status='locked'` (فقط مدیر باز می‌کند) |
| شکست برای (شناسه, IP) | ۱۵ دقیقه | ≥۵ | رد |
| شکست از یک IP | ۱۰ دقیقه | ≥۶۰ | رد |

IP از اولین مقدار `x-forwarded-for` (Caddy)، وگرنه `x-real-ip`، وگرنه `0.0.0.0`.

## نشست (`session.ts`)

- توکن: ۳۲ بایت تصادفی base64url؛ در DB فقط `sha256(token)`.
- کوکی: production → `__Host-session; Secure; HttpOnly; SameSite=Lax; Path=/`؛ development → نام `session` بدون Secure (مرورگرها پیشوند `__Host-` بدون Secure را رد می‌کنند).
- اعتبار: ۳۰ روز، لغزنده (وقتی کمتر از ۷ روز مانده، سطر تمدید و کوکی در اکشن بعدی دوباره صادر می‌شود). «این دستگاه عمومی است» → ۸ ساعت، کوکی نشستی (بدون Max-Age)، بدون تمدید.
- `last_seen_at` حداکثر هر ۵ دقیقه یک‌بار.
- خروج: `revoked_at=now()` + پاک‌کردن کوکی + ریدایرکت به `/login?out=1` که proxy روی آن `Clear-Site-Data: "cache", "storage"` می‌گذارد. «خروج از همهٴ دستگاه‌ها» همهٴ سطرهای حساب را باطل می‌کند.
- نشست باطل/منقضی/کوکی خراب → `getRequestContext()` = `null` → صفحه‌ها به `/login`، اکشن‌ها `UNAUTHENTICATED`.

## تغییر رمز اجباری

- `user_account.must_change_password=true` (پیش‌فرض حساب جدید و خروجی seed). `defineAction`/`defineQuery` هر چیزی جز اکشن‌های `allowPasswordChangePending` (تغییر رمز، خروج) را با `PASSWORD_CHANGE_REQUIRED` رد می‌کند؛ layout گروه `(app)` هم به `/change-password` می‌فرستد. پرچم از DB خوانده می‌شود، پس دور زدن با کوکی ممکن نیست.
- سیاست رمز جدید (`password.ts`): حداقل ۸ (حداکثر ۱۲۸)، نه برابر شماره/نام‌کاربری (در همهٴ املاها، حتی با ارقام فارسی)، نه در فهرست رمزهای رایج، نه تکراری/ترتیبی؛ `newPassword === confirm`.
- پس از تغییر: هش جدید، `must_change_password=false`, `password_changed_at`, `initial_password_enc=NULL`، **همهٴ نشست‌های دیگرِ حساب باطل** می‌شوند.

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
