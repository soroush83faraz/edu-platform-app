import type { Metadata } from "next";
import { DoninoWordmark } from "@/components/brand/DoninoMark";
import { OfflineClay } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { productName } from "@/lib/product";

export const metadata: Metadata = { title: "آفلاین" };
export const dynamic = "force-static";

/**
 * The service worker's navigation fallback: static, public, no data. Served from the cache when a page load fails
 * without a network. «تلاش دوباره» is a plain link so it works with JavaScript still loading.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <DoninoWordmark name={productName()} size={32} className="mb-2" />
      <OfflineClay size={140} />
      <h1 className="text-xl font-bold text-text">اتصال اینترنت برقرار نیست</h1>
      <p className="max-w-xs text-sm text-text-muted">پنل من و اعلان‌ها روی گوشی نگه داشته نمی‌شوند؛ با برقراری اتصال، همه‌چیز دوباره بارگذاری می‌شود.</p>
      <Button asChild size="lg" className="mt-2 font-semibold">
        <a href="/home">تلاش دوباره</a>
      </Button>
    </main>
  );
}
