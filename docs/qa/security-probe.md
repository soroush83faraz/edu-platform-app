# پروب امنیتی دستی — فاز ۱

چک‌لیستی که قبل از تحویل و بعد از هر استقرارِ مهم روی سرور واقعی اجرا می‌شود. هر بند یک دستور دقیق و نتیجهٴ مورد انتظار دارد. ستون «محلی» = نتیجهٴ اجرا روی `http://localhost:3000` (dev، ۱۴۰۵/۰۶/۲۹، سازمان‌های دمو). روی production `B=https://<PUBLIC_HOST>` بگذارید و با یک حساب QA اجرا کنید.

## آماده‌سازی

```bash
B=http://localhost:3000          # روی سرور: https://school.example.ir
# ورود با فرم واقعی (بدون JS): فیلدهای مخفی $ACTION_* را از صفحهٴ /login می‌خوانیم و همان فرم را POST می‌کنیم
login() {  # login <identifier> <password> <cookiejar>
  curl -s "$B/login" -o /tmp/lp.html
  local id key
  id=$(grep -o 'ACTION_1:0" value="[^"]*"' /tmp/lp.html | head -1 | cut -d'"' -f3 | sed 's/&quot;/"/g')
  key=$(grep -o 'ACTION_KEY" value="[^"]*"' /tmp/lp.html | head -1 | cut -d'"' -f3)
  curl -s -o /dev/null -D - -c "$3" -F "identifier=$1" -F "password=$2" -F '$ACTION_REF_1=' \
       -F "\$ACTION_1:0=$id" -F '$ACTION_1:1=[null]' -F "\$ACTION_KEY=$key" "$B/login" | grep -i '^location'
}
```

ساده‌تر: `pnpm smoke:prod` همین ورود، ساخت کار، انجام، خروج و ریدایرکت را خودکار می‌کند (بند ۱۰).

## چک‌لیست

| # | چه چیزی | دستور | انتظار | محلی |
|---|---|---|---|---|
| ۱ | کار سازمانِ دیگر با UUID → ۴۰۴ | `login 09123000103 <pw> /tmp/j-noor.txt` (دبیر سازمان نور) سپس `curl -s -o /dev/null -w '%{http_code}' -b /tmp/j-noor.txt "$B/inbox/<uuid کاری از سازمان دانش>"` | صفحهٴ «چنین موردی پیدا نشد» (`notFound()`؛ RLS ردیف را نمی‌بیند). **توجه:** App Router صفحهٴ not-found را با کد HTTP **200** و digest `NEXT_HTTP_ERROR_FALLBACK;404` در بدنه می‌فرستد؛ برای پروب `grep -c 'NEXT_HTTP_ERROR_FALLBACK;404'` را بگیرید، نه status | ☑ بدنه not-found، هیچ عنوانی از کار لو نرفت |
| ۲ | کار هم‌کلاسی/فرد دیگرِ همان سازمان → ۴۰۴ | همان دستور با `login 09123000005 …` (دانش‌آموز سارا) روی todo شخصیِ دبیر کریمی | همان صفحهٴ not-found (`canViewWorkItem` false → `notFound()`؛ صفحه هیچ‌وقت «مال شما نیست» و «وجود ندارد» را از هم جدا نمی‌کند) | ☑ |
| ۳ | اکشن بدون کوکی → UNAUTHENTICATED | `curl -s -X POST "$B/inbox/new" -H "Next-Action: <id>" -H "Accept: text/x-component" -H "Content-Type: text/plain;charset=UTF-8" --data-raw '[{"typeCode":"todo","title":"x","priority":"normal","recipients":{"kind":"self"}}]'` — با کوکی جعلی: `-H 'Cookie: session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'` (production: `__Host-session`) | بدون کوکی: proxy 307 → `/login`. با کوکی جعلی/باطل: `{"ok":false,"code":"UNAUTHENTICATED","message":"برای ادامه وارد حساب خود شوید."}` (مرز امنیتی DB است، نه proxy). همین برای `GET $B/api/inbox/summary` → 401 | ☑ 307 / ☑ UNAUTHENTICATED / ☑ 401 |
| ۴ | نشستِ باید-رمز-را-تغییر-دهد → PASSWORD_CHANGE_REQUIRED | `update iam.user_account set must_change_password=true where login_identifier='+98912…'` → login → `curl -b jar "$B/api/inbox/summary"` و اکشن بالا و `curl -o /dev/null -w '%{http_code} %{redirect_url}' -b jar "$B/home"` | ورود → `Location: /change-password`؛ summary → `403 {"code":"PASSWORD_CHANGE_REQUIRED"}`؛ اکشن → `PASSWORD_CHANGE_REQUIRED` «ابتدا رمز خود را تغییر دهید.»؛ `/home` → 307 `/change-password` | ☑ همهٴ چهار مورد |
| ۵ | فقط ۲۲/۸۰/۴۴۳ گوش می‌دهند | روی سرور: `ss -tlnp \| awk 'NR==1 \|\| /LISTEN/'` | فقط `:22`, `:80`, `:443` (sshd، caddy). هیچ `:5432` یا `:3000` روی `0.0.0.0`/`[::]`؛ `docker ps --format '{{.Ports}}'` فقط برای caddy پورت منتشر دارد | — (سرور) |
| ۶ | هدرهای امنیتی | `curl -sI "$B/login" \| grep -iE 'strict-transport\|content-security\|x-content-type\|x-frame\|referrer-policy'` | production (Caddy): `Strict-Transport-Security: max-age=31536000; includeSubDomains`، `X-Content-Type-Options: nosniff`، `X-Frame-Options: DENY`، `Referrer-Policy: strict-origin-when-cross-origin`، `Server` حذف‌شده. **CSP هنوز نیست** — بلوک PWA/هدرها آن را در Next اضافه می‌کند (`default-src 'self'` بدون هاست خارجی؛ Vazirmatn self-hosted). | ☐ dev: هیچ‌کدام (هدرها را Caddy می‌گذارد؛ CSP امروز غایب) |
| ۷ | `http://` → 301 به `https://` و گواهی > ۶۰ روز | `curl -sI http://<host>/ \| head -1` و `echo \| openssl s_client -connect <host>:443 -servername <host> 2>/dev/null \| openssl x509 -noout -enddate` | `HTTP/1.1 308` یا `301` با `Location: https://…`؛ `notAfter` بیش از ۶۰ روز بعد | — (سرور) |
| ۸ | مخزن بدون secret | `gitleaks detect --source . --no-banner` (نصب: `winget install gitleaks` / `apt install gitleaks` یا باینری GitHub) | `no leaks found`. `.env*` در `.gitignore` است؛ رمزهای دمو (`Demo-1405-pass`) عمداً در docs هستند و باید بعد از تحویل تغییر کنند | ☐ gitleaks روی این ماشین نصب نیست (`git grep -n 'app_rw_dev\|SESSION_SECRET=' -- ':!*.example' ':!docs'` خالی است) |
| ۹ | `rolbypassrls` فقط برای `app_backup` | `docker compose exec -T db psql -U postgres -tAc "select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'app_%' order by 1"` | `app_backup\|t\|f`, `app_owner\|f\|f`, `app_rw\|f\|f` | ☑ |
| ۱۰ | RLS fail-closed بدون context | `docker compose exec -T db psql -U app_rw -d app -tAc "select count(*) from iam.person"` | `0` (بدون `app.current_org_id` هیچ ردیفی) | ☑ 0 |
| ۱۱ | RLS drift = ۰ ردیف | کوئری زیر | خالی | ☑ 0 |
| ۱۲ | smoke سبز | `BASE_URL=$B SMOKE_IDENTIFIER=<qa> SMOKE_PASSWORD=<pw> pnpm smoke:prod` | ۷ تیک، `exit 0` | ☑ 7/7 (dev، ۷٫۳ ثانیه) |
| ۱۳ | قفل نرم بعد از ۵ رمز غلط | ۶ بار `login <شمارهٴ qa> wrong-pass /dev/null` سپس یک‌بار با رمز درست | ۶ پاسخ بدون `Location` (فرم با «شماره یا رمز اشتباه است.»)؛ رمز درست هم تا ۱۵ دقیقه رد می‌شود (`docs/auth.md`، جدول محدودسازی)؛ `select outcome, count(*) from iam.login_attempt where identifier='+98…' group by 1` | ☐ (روی dev اجرا نشد تا حساب دمو قفل نشود) |
| ۱۴ | نشستِ باطل‌شده بی‌اثر است | `pnpm sessions:revoke --user <qa>` سپس `curl -b jar "$B/api/inbox/summary"` | `401 UNAUTHENTICATED` | ☑ (دانش‌آموز ۰۹۱۲۳۰۰۰۰۰۵: قبل 200، بعد 401) |
| ۱۵ | بعد از خروج صفحهٴ خصوصی از کش نمی‌آید | خروج در مرورگر گوشی → دکمهٴ برگشت / باز کردن `/inbox` | `/login`؛ پاسخ `/login?out=1` هدر `Clear-Site-Data: "cache", "storage"` دارد (`curl -sI "$B/login?out=1"`) و صفحه‌های خصوصی `Cache-Control: private, no-store` | ☑ هدرها (dev) / ☐ روی گوشی واقعی |

### کوئری RLS drift (بند ۱۱)

جدول‌های اسکیماهای مستأجری که `organization_id` دارند اما RLS آن‌ها فعال/اجباری نیست یا سیاست ندارند:

```sql
select c.relnamespace::regnamespace || '.' || c.relname as tbl,
       c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
where c.relkind = 'r'
  and c.relnamespace::regnamespace::text in ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
  and (not c.relrowsecurity or not c.relforcerowsecurity
       or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
```

(`tests/int/rls-meta.test.ts` همین را در CI می‌پرسد؛ این نسخه برای اجرای مستقیم روی production است.)

### یادداشت‌های اجرای محلی ۱۴۰۵/۰۶/۲۹

- بندهای ۱–۴، ۹–۱۲، ۱۴ روی dev سبز. بند ۶: dev هیچ هدر امنیتی ندارد چون هدرها در Caddyfile اند؛ **CSP در هیچ لایه‌ای نیست** و باید پیش از go-live اضافه شود (بلوک PWA/هدرها). بند ۸: gitleaks نصب نبود؛ grep دستی خالی بود.
- شناسهٴ اکشن (`Next-Action`) در dev از chunk صفحه خوانده می‌شود (`createServerReference("<id>", …, "createWorkItemAction")`); روی production همان روش را `smoke-prod.ts` انجام می‌دهد.
