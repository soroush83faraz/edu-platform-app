# Pending for docs/decisions.md — client-ready polish pass (2026-09-27)

Before the owner shows the app to a school owner, every screen was swept for developer-looking text.

- **Words.** «ارائهٴ درس / ارائهٴ درس‌ها» is gone from the UI: the class's offerings page and button read «درس‌ها و
  دبیران», the resource noun is «درس» («درس جدید»), the school hub section «درس‌های کلاس‌ها», the admin attention rows
  «درس‌های بدون دبیر» / «کلاس‌های بدون درس». Routes, the `offerings` resource key and DB names are unchanged.
  «شناسهٴ ورود» → «نام‌کاربری» (forms, person page, credentials dialog/sheet, profile card, help). «دامنهٴ شما» →
  the school names. «اعتبارنامه» pages → «برگهٴ ورود» (still unlinked, per the 1405/06/31 decision).
- **Hidden internals.** Subject codes (LIT, MATH…) are no longer listed or asked for: the subject form has no code
  field and `subjectResource.create` generates an internal one (`S` + base36 time + 2 random chars) when none is sent;
  the list shows «در n کلاس» (distinct classes) instead of «n ارائه». The student form no longer shows «کد یکتا
  (سامانهٴ قبلی)» (`external_ref`, an importer key; edits keep the stored value). The school code stays visible to
  the organization admin only, relabelled «کد لاتین مدرسه» with what it is for. «مدرسهٴ پیش‌فرض» → «مدرسهٴ اصلی».
- **/admin/roles** shows role names and a one-line description in school language (`ROLE_ABOUT`); no role code chip,
  permission count or «دامنه». The teacher role reads «دبیر» (`roleLabel`).
- **Messages.** «شناسه نامعتبر است.» → «گزینهٴ انتخاب‌شده نامعتبر است.»; the form-level line for errors on hidden
  fields drops its «خطای اعتبارسنجی:» prefix; branch / derived-role / «سال‌ها» wording in service errors rewritten.
- **Course covers** were rendering black and grey: the `--color-cover-*` tokens are only referenced through
  runtime-built `var()` strings, so Tailwind pruned them. They now live in an `@theme static` block in globals.css.
- **`src/app/error.tsx`**: a Persian error page («مشکلی پیش آمد», «تلاش دوباره», «بازگشت به خانه») replaces the
  framework's English screen for unexpected failures. No `global-error.tsx` (it would need its own `<html dir>`).
