import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/Card";
import type { EmptyCopy } from "@/lib/empty-copy";
import type { WorkItemWords } from "@/lib/work-item-words";
import { homeOpenItemsQuery } from "@/modules/workspace/queries";
import { CompactItemRow } from "./CompactItemRow";

/**
 * «تکالیف نزدیک»: the next five open items of my کارتابل (assigned to me or given by me), by due date. Empty, it is
 * one line of text in the reader's voice (`empty`, from `src/lib/empty-copy.ts`) — no illustration, and no button:
 * the creation tile is right above it on Home.
 */
export async function NearbyCard({ words, empty }: { words: WorkItemWords; empty: EmptyCopy }) {
  const items = await homeOpenItemsQuery({ limit: 5 });
  const rows = items.ok ? items.data : [];
  return (
    <section aria-labelledby="nearby-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 id="nearby-heading" className="text-section font-semibold text-text">
          {words.plural} نزدیک
        </h3>
        <Link href="/inbox" className="pressable inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-sm font-medium text-sky-strong hover:text-primary-700">
          همهٴ {words.plural}
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="flex flex-col gap-1 px-4 py-5">
            <p className="text-row font-medium text-text">{empty.title}</p>
            <p className="text-sm text-text-muted">{empty.description}</p>
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
