# edu-platform-app

**دانینو** (Donino) — سامانهٴ مدیریت آموزشی چندمستأجری (PWA، فارسی/RTL) — فاز ۱.

- قواعد پروژه: `CLAUDE.md` · تصمیم‌ها: `docs/decisions.md` · استقرار: `deploy/README.md`
- اجرا: `cp .env.example .env` → `pnpm install` → `pnpm db:up` → `pnpm db:migrate` → `pnpm dev` · دیتابیس: `docs/db.md`
- قبل از هر commit: `pnpm verify` (با دیتابیس بالا: `pnpm verify:full`)

## پیش‌نمایش آنلاین

<https://soroush83faraz.github.io/edu-platform-app/>

- **چیست:** نسخهٴ ثابت (HTML) همهٴ صفحه‌های برنامه به تفکیک نقش — دانش‌آموز، دبیر، مدیر مدرسه، مدیر سازمان و صفحه‌های بدون ورود — با داده‌های ساختگی پایلوت. با هر push به `main` از نو ساخته می‌شود (`.github/workflows/pages.yml`): برنامهٴ واقعی در GitHub Actions روی یک PostgreSQL یک‌بارمصرف بالا می‌آید، با هر نقش وارد می‌شود و هر صفحه با `scripts/preview/export.ts` ذخیره می‌شود.
- **چه نیست:** برنامهٴ زنده نیست. ورود، ذخیره، فرم‌ها و دکمه‌ها کار نمی‌کنند، اسکریپتی اجرا نمی‌شود و حالت‌های تعاملی (پنجره‌ها، منوها) دیده نمی‌شوند. به هیچ سروری وصل نیست و داده‌ای از استقرار واقعی در آن نیست.
