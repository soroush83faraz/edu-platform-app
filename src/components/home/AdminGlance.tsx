import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { AdminCounters } from "@/components/admin/AdminCounters";
import type { AdminCounts } from "@/lib/admin/overview";

/** «مدرسه در یک نگاه»: the four daily counters in one slim card, a «مدیریت» link, nothing else. */
export function AdminGlance({ counts }: { counts: AdminCounts }) {
  return (
    <section aria-labelledby="glance-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 id="glance-heading" className="text-sm font-semibold text-text-muted">
          مدرسه در یک نگاه
        </h3>
        <Link href="/admin" className="pressable inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-sm font-medium text-sky-strong hover:text-primary-700">
          مدیریت
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      </div>
      <AdminCounters counts={counts} />
    </section>
  );
}
