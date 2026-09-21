import { BookOpen, LogIn } from "lucide-react";
import Link from "next/link";
import { productName } from "@/lib/product";

/**
 * The frame of the pages anyone may read without signing in (/help, /privacy — linked from the login page): the
 * tinted canvas, one slim bar with the product mark and a «ورود» link, the same content column as the app. No nav,
 * no badge poller — nothing here needs a session. Signed-in visitors get the real `AppShell` instead (see
 * `src/app/(public)/layout.tsx`); a visitor with a pending forced password change lands here too, so the shell
 * never offers a way around /change-password.
 */
export function PublicShell({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  const name = productName();
  return (
    <div className="flex min-h-full flex-1 flex-col bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-lg focus:bg-primary-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        پرش به محتوا
      </a>
      <header className="sticky top-0 z-10 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xl bg-hero text-white shadow-1">
            <BookOpen className="size-4" />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-text">{name}</h1>
          {signedIn ? null : (
            <Link href="/login" className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary-700 hover:bg-surface">
              <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />
              ورود
            </Link>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 pb-8 outline-none">
        {children}
      </main>
    </div>
  );
}
