import { ChevronLeft, ListChecks } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { PageSection } from "@/components/layout/PageSection";
import { formatNumberFa } from "@/lib/format";
import { homeOpenItemsQuery } from "@/modules/workspace/queries";
import { MetaLine, WorkItemMark, rowMeta } from "@/modules/workspace/ui/InboxRow";

/**
 * «نیاز به پیگیری» (teachers): the open تکالیف I gave, ranked by how far they are from done — overdue first, then
 * the lowest completion — the top five, each under its مُهر درس with «ریاضی · کلاس ۱۰۲ · deadline · n/m انجام شد»
 * and a slim bar. Reads the same Home query as the
 * phone's «کارهای نزدیک» with `createdByMe`.
 */
export async function FollowUp() {
  const r = await homeOpenItemsQuery({ createdByMe: true, limit: 10 });
  const rows = (r.ok ? r.data : [])
    .filter((row) => row.assigneesTotal > 0)
    .map((row) => ({ ...row, ratio: row.assigneesDone / row.assigneesTotal }))
    .sort((a, b) => Number(b.bucket === "overdue") - Number(a.bucket === "overdue") || a.ratio - b.ratio)
    .slice(0, 5);
  return (
    <PageSection
      id="follow-up"
      title="نیاز به پیگیری"
      icon={ListChecks}
      surface="work"
      flush
      trailing={
        <Link href="/inbox?mine=1" className="pressable inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          تکالیف داده‌شده
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">تکلیف بازی نداده‌اید؛ با «تکلیف جدید» به کلاس تکلیف بدهید.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {rows.map((row) => {
            const pct = Math.round(row.ratio * 100);
            return (
              <li key={row.id}>
                <Link href={`/inbox/${row.id}`} className="pressable flex min-h-14 items-center gap-3 px-4 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                  <WorkItemMark row={row} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-row font-semibold text-text">
                      <bdi>{row.title}</bdi>
                    </span>
                    <MetaLine
                      parts={[
                        ...rowMeta(row, { noDue: "بدون مهلت" }),
                        <span key="done" className="tabular">
                          {formatNumberFa(row.assigneesDone)}/{formatNumberFa(row.assigneesTotal)} انجام شد
                        </span>,
                      ]}
                    />
                  </span>
                  <span className="flex w-28 shrink-0 flex-col items-end gap-1">
                    <span className="tabular text-meta font-medium text-text">{formatNumberFa(pct)}٪</span>
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={row.assigneesTotal} aria-valuenow={row.assigneesDone} aria-label="پیشرفت">
                      <span className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-sky")} style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageSection>
  );
}
