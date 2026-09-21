# تغییرات امن اسکیما در production — دستور پخت‌ها

قاعده‌های پایه در `docs/db.md` («گردش کار مهاجرت»)؛ این سند فقط **چطور** هر تغییر رایج را بی‌خطر انجام دهیم. سه اصل که هیچ‌وقت نمی‌شکنند:

1. **فقط افزودنی.** هر مهاجرتِ production باید با ایمیجِ *قبلی* هم کار کند، چون `rollback.sh` فقط ایمیج را برمی‌گرداند و مهاجرت را نه. پس در یک ریلیز: ستون/جدول/ایندکس اضافه کنید؛ چیزی حذف یا تغییرِ معنی ندهید.
2. **هرگز مهاجرتِ اعمال‌شده را ویرایش نکنید** (`drizzle/NNNN_*.sql` بعد از commit + deploy ثابت است). اشتباه؟ مهاجرت جدید برای اصلاح. `drizzle-kit push` هرگز.
3. **هر مهاجرت با سه تابع idempotent تمام می‌شود**، هر یک یک statement جدا:
   ```sql
   --> statement-breakpoint
   SELECT app.apply_grants();
   --> statement-breakpoint
   SELECT app.apply_rls();
   --> statement-breakpoint
   SELECT app.apply_updated_at_triggers();
   ```
   بدون آن جدول جدید برای `app_rw` بی‌مجوز، بدون RLS (تست `rls-meta` قرمز) و بدون تریگر `updated_at` می‌ماند. رشتهٴ `--> statement-breakpoint` حتی در کامنت جداکننده است؛ فایل بدون BOM و LF.

**شبکهٴ ایمنی خودکار:** `deploy.sh` قبل از `migrate` یک `pg_dump -Fc` با `app_backup` در `backups/pre-<ts>.dump` می‌گیرد و اگر dump شکست بخورد، مهاجرت اجرا **نمی‌شود**. همهٴ مهاجرت‌های معوق در یک تراکنش اعمال می‌شوند؛ شکست = هیچ تغییری. با این حال یک `ALTER TABLE` که قفل طولانی می‌گیرد اپ را (statement_timeout=10s, lock_timeout=5s برای `app_rw`) چند ثانیه خطا می‌دهد — مهاجرت‌های بزرگ را ۰۲:۰۰–۰۶:۰۰ بزنید.

## گردش استاندارد

```bash
# 1. اسکیما را در src/db/schema/<schema>.ts تغییر دهید (و re-export در src/modules/<ctx>/schema.ts)
pnpm db:generate                       # drizzle/NNNN_<name>.sql — بخوانید؛ فقط CREATE/ADD/ALTER … ADD انتظار دارید
pnpm db:generate:custom -- --name x    # برای SQL دستی (backfill، RLS، تابع) اگر لازم است
# 2. سه SELECT app.apply_* را به انتهای فایل اضافه کنید (generate خودش نمی‌گذارد)
pnpm db:check                          # سازگاری snapshot ها
pnpm db:reset:test && pnpm test:int    # rls-meta / guards / migrate تست‌ها
pnpm db:migrate                        # محلی
git add drizzle src && git commit
# 3. deploy (ship.ps1) → deploy.sh: dump → migrate → up → health
```

## دستور پخت‌ها

### الف) ستون جدید (nullable یا با DEFAULT) — یک ریلیز

```sql
ALTER TABLE "workspace"."work_item" ADD COLUMN "estimated_minutes" integer;
--> statement-breakpoint
ALTER TABLE "workspace"."work_item" ADD CONSTRAINT "work_item_estimated_minutes_chk" CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" BETWEEN 1 AND 6000);
```

- `DEFAULT` ثابت روی PG16 بدون بازنویسی جدول است (فقط متادیتا). `DEFAULT now()`/تابعِ volatile جدول را بازنویسی می‌کند — روی جدول بزرگ در ساعت خلوت.
- ایمیج قبلی ستون را نمی‌بیند و مشکلی ندارد (`select` های ما ستونی‌اند، `insert` ها فیلدهای صریح).

### ب) ستون `NOT NULL` — دو ریلیز

ریلیز ۱ (مهاجرت `NNNN_add_x`):
```sql
ALTER TABLE "iam"."person" ADD COLUMN "display_name" text;
```
کد ریلیز ۱ ستون را همیشه پر می‌کند (سرویس). سپس backfill **دسته‌ای** (به‌عنوان `app_owner`، خارج از مهاجرت، یا در مهاجرت custom با حلقه؛ زیر FORCE RLS باید context بزنید یا از تابع SECURITY DEFINER استفاده کنید — ساده‌تر: اسکریپت `tsx` که برای هر سازمان `withTenant` می‌گیرد):
```sql
-- تکرار تا وقتی UPDATE 0
WITH batch AS (
  SELECT id FROM iam.person WHERE display_name IS NULL LIMIT 5000 FOR UPDATE SKIP LOCKED
)
UPDATE iam.person p SET display_name = p.first_name || ' ' || p.last_name FROM batch WHERE p.id = batch.id;
```
ریلیز ۲ (بعد از تأیید `select count(*) … where display_name is null` = 0):
```sql
ALTER TABLE "iam"."person" ADD CONSTRAINT "person_display_name_nn" CHECK ("display_name" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "iam"."person" VALIDATE CONSTRAINT "person_display_name_nn";
--> statement-breakpoint
ALTER TABLE "iam"."person" ALTER COLUMN "display_name" SET NOT NULL;   -- PG12+: با CHECK معتبرِ موجود، اسکن کامل نمی‌کند
--> statement-breakpoint
ALTER TABLE "iam"."person" DROP CONSTRAINT "person_display_name_nn";
```
`NOT VALID` + `VALIDATE` قفل کوتاه می‌گیرد؛ `SET NOT NULL` مستقیم روی جدول بزرگ `ACCESS EXCLUSIVE` طولانی است.

### پ) تغییر نام ستون — expand/contract (سه ریلیز)

هرگز `RENAME COLUMN` روی production (ایمیج قبلی می‌شکند).

1. **Expand:** ستون جدید nullable + تریگر همگام‌سازی دوطرفه (یا کد که هر دو را می‌نویسد) + backfill دسته‌ای.
   ```sql
   ALTER TABLE "tenancy"."school" ADD COLUMN "display_name" text;
   --> statement-breakpoint
   CREATE OR REPLACE FUNCTION app.sync_school_name() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN
     IF NEW.display_name IS NULL THEN NEW.display_name := NEW.name; END IF;
     IF NEW.name IS NULL THEN NEW.name := NEW.display_name; END IF;
     RETURN NEW;
   END $fn$;
   --> statement-breakpoint
   CREATE TRIGGER school_sync_name BEFORE INSERT OR UPDATE ON "tenancy"."school" FOR EACH ROW EXECUTE FUNCTION app.sync_school_name();
   ```
2. **Migrate reads:** کد از ستون جدید می‌خواند و در آن می‌نویسد (ریلیز بعدی؛ تریگر ستون قدیمی را پر نگه می‌دارد).
3. **Contract:** یک ریلیز بعد، وقتی هیچ ایمیجی ستون قدیمی را نمی‌خواند: `DROP TRIGGER`, `DROP FUNCTION`, و ستون قدیمی را **فعلاً نگه دارید** (بند ت).

### ت) حذف ستون/جدول — هیچ‌وقت در همان ریلیزی که کد آن را رها می‌کند

- ریلیز N: کد دیگر به ستون دست نمی‌زند (`select` صریح آن را نمی‌خواند، `insert` نمی‌نویسد؛ ستون nullable یا DEFAULT دارد).
- ریلیز N+1 یا بعدتر، **بعد از این‌که `.last_tag` هم ستون را نمی‌خواند**: `ALTER TABLE … DROP COLUMN` (سریع؛ داده در بازیابی بکاپ‌های قدیمی می‌ماند). جدول: قبل از `DROP TABLE` یک `pg_dump -t` جدا.
- FK به جدولِ حذف‌شونده: اول `DROP CONSTRAINT`.

### ث) ایندکس روی جدول بزرگ

Drizzle `CREATE INDEX` عادی می‌سازد (قفل نوشتن تا پایان). برای جدول‌های پرتردد (`work_item`, `inbox_entry`, `notification`, `audit_log`):
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notification_recipient_unread_idx" ON "notif"."notification" ("organization_id","recipient_person_id") WHERE read_at IS NULL;
```
`CONCURRENTLY` داخل تراکنش ممکن نیست و `migrate` همه را در یک تراکنش می‌زند → این را **خارج از مهاجرت** با `psql -U app_owner` در ساعت خلوت اجرا کنید و سپس مهاجرتی با همان `CREATE INDEX IF NOT EXISTS` (بدون CONCURRENTLY) commit کنید تا snapshot و محیط‌های تازه هم داشته باشند (`IF NOT EXISTS` روی production no-op است).

### ج) CHECK جدید یا تغییر مقدارهای مجاز (`text + CHECK`)

- اضافه‌کردن مقدار: `DROP CONSTRAINT` + `ADD CONSTRAINT … CHECK (col IN (…)) NOT VALID` + `VALIDATE CONSTRAINT` (سه statement با breakpoint). ایمیج قبلی مقدار جدید را نمی‌فرستد؛ اگر آن را می‌خواند، UI باید مقدار ناشناخته را تحمل کند (فالبک «—»).
- حذف مقدار: اول داده را مهاجرت دهید، بعد CHECK را سخت کنید.

### چ) جدول جدید مستأجری

Drizzle SQL را می‌سازد؛ شما فقط مطمئن شوید: `organization_id uuid NOT NULL` با FK به `tenancy.organization`, `UNIQUE (organization_id, id)` اگر والدِ FK ترکیبی است، FKهای ترکیبی `(organization_id, x_id)` با `ON DELETE RESTRICT`, ستون‌های `timestamptz`, `status text CHECK`, و سه `SELECT app.apply_*()` در انتها (RLS + grant + updated_at خودکار). جدول سراسری (بدون `organization_id`) استثناست و باید در `docs/db.md` فهرست شود؛ `apply_grants()` مجوز آن را می‌دهد ولی RLS ندارد — آگاهانه.

### ح) تابع / تریگر / سیاست RLS دستی

همیشه `CREATE OR REPLACE FUNCTION` (idempotent) و برای سیاست `DROP POLICY IF EXISTS` + `CREATE POLICY` در همان مهاجرت. توابعِ `SECURITY DEFINER` فقط با `SET search_path = pg_catalog, app` و مالک `app_owner` (نمونه: `0006`). تغییر `app.fa_norm` مقادیر STORED را بازمحاسبه نمی‌کند (`docs/db.md`).

### خ) دادهٴ کاتالوگ (permission, role, work_item_type, notification_type)

مهاجرت نه؛ `scripts/catalog.ts` (+ `src/modules/iam/permissions.ts`) منبع حقیقت است و در هر deploy خودکار اجرا می‌شود — سرویس `seed` نسخهٴ کامپایل‌شدهٴ آن (`scripts/seed-catalog.js`، تولیدشده در `pnpm build`) را بعد از `migrate` می‌زند (idempotent، حذف ردیف اضافی نقش‌های سیستمی). مجوز جدید = افزودن به `PERMISSIONS` + نقش‌ها در `SYSTEM_ROLES` + محلی `pnpm seed`؛ روی سرور هیچ گام دستی ندارد.

## چک‌لیست قبل از commit مهاجرت

- [ ] فایل با سه `SELECT app.apply_*();` (هر یک بعد از `--> statement-breakpoint`) تمام می‌شود.
- [ ] هیچ `DROP`/`RENAME`/`SET NOT NULL` مستقیم/`ALTER TYPE` روی چیزی که ایمیجِ فعلی production استفاده می‌کند.
- [ ] ستون جدید nullable یا DEFAULT ثابت؛ backfill جدا و دسته‌ای.
- [ ] `pnpm db:check` و `pnpm db:reset:test && pnpm test:int` سبز (rls-meta، guards، migrate).
- [ ] روی dump تازهٴ production (بازیابی‌شده در `app_restore_test`، `restore-test.sh` با `RESTORE_KEEP_DB=1`) یک‌بار `psql -f drizzle/NNNN.sql` را زمان بگیرید اگر جدول بزرگ است.
- [ ] `docs/db.md` جدول‌ها/کلیدهای طبیعی به‌روز؛ `docs/decisions.md` اگر قاعده‌ای عوض شد.
