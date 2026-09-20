import Link from "next/link";

/** Root not-found: rendered for `notFound()` thrown by a group layout (e.g. a non-admin opening /admin). */
export default function RootNotFound() {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-base font-medium text-text">چنین صفحه‌ای پیدا نشد</p>
      <p className="max-w-xs text-sm text-text-muted">ممکن است نشانی اشتباه باشد یا این بخش در دسترس شما نباشد.</p>
      <Link href="/home" className="mt-3 inline-flex h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-text hover:bg-surface-sunken">
        بازگشت به خانه
      </Link>
    </main>
  );
}
