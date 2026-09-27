"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Root error boundary (polish pass, 2026-09-27): an unexpected server or render failure shows a calm Persian page
 * with «تلاش دوباره» instead of the framework's English «Application error» screen. Nothing of the error itself is
 * shown — the server log keeps it (the `digest` links the two).
 */
export default function RootError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-base font-medium text-text">مشکلی پیش آمد</p>
      <p className="max-w-xs text-sm text-text-muted">این صفحه الان باز نشد. چند لحظه بعد دوباره تلاش کنید؛ اگر باز هم پیش آمد، به مدیر مدرسه خبر دهید.</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => retry()}>
          تلاش دوباره
        </Button>
        <Button asChild variant="outline">
          <Link href="/home">بازگشت به خانه</Link>
        </Button>
      </div>
    </main>
  );
}
