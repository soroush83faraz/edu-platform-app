# edu-platform-app

**دانینو** (Donino) — سامانهٴ مدیریت آموزشی چندمستأجری (PWA، فارسی/RTL) — فاز ۱.

- قواعد پروژه: `CLAUDE.md` · تصمیم‌ها: `docs/decisions.md` · استقرار: `deploy/README.md`
- اجرا: `cp .env.example .env` → `pnpm install` → `pnpm db:up` → `pnpm db:migrate` → `pnpm dev` · دیتابیس: `docs/db.md`
- قبل از هر commit: `pnpm verify` (با دیتابیس بالا: `pnpm verify:full`)
