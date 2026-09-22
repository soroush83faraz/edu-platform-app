import { AlarmClock, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { PageSection } from "@/components/layout/PageSection";
import { listInboxQuery } from "@/modules/workspace/queries";
import { InboxRow } from "@/modules/workspace/ui/InboxRow";

/**
 * «فوری‌ها»: what is overdue and what is due today, from the same inbox read the «پنل من» tabs use — overdue
 * first. At most eight rows; the trailing link opens the کارتابل on today.
 */
export async function UrgentItems() {
  const [overdue, today] = await Promise.all([listInboxQuery({ tab: "todo", bucket: "overdue", limit: 8 }), listInboxQuery({ tab: "todo", bucket: "today", limit: 8 })]);
  const rows = [...(overdue.ok ? overdue.data.rows : []), ...(today.ok ? today.data.rows : [])].slice(0, 8);
  return (
    <PageSection
      id="urgent"
      title="فوری‌ها"
      icon={AlarmClock}
      count={rows.length > 0 ? rows.length : undefined}
      surface="work"
      flush
      trailing={
        <Link href="/inbox" className="pressable inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          پنل من
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">تکلیف سررسیده یا امروزی ندارید.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {rows.map((row) => (
            <InboxRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </PageSection>
  );
}
