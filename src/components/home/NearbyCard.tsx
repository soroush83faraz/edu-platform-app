import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyClay } from "@/components/illustrations";
import { homeOpenItemsQuery } from "@/modules/workspace/queries";
import { CompactItemRow } from "./CompactItemRow";

/** «کارهای نزدیک»: the next five open items of my کارتابل (assigned to me or given by me), by due date. */
export async function NearbyCard() {
  const items = await homeOpenItemsQuery({ limit: 5 });
  const rows = items.ok ? items.data : [];
  return (
    <section aria-labelledby="nearby-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 id="nearby-heading" className="text-sm font-semibold text-text-muted">
          کارهای نزدیک
        </h3>
        <Link href="/inbox" className="pressable inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-sm font-medium text-sky-strong hover:text-primary-700">
          همهٴ کارها
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="flex items-center gap-4 px-4 py-5">
            <EmptyClay size={72} />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text">کار بازی ندارید.</p>
              <p className="text-xs text-text-muted">کار تازه همین‌جا می‌آید.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line/70">
            {rows.map((row) => (
              <CompactItemRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
