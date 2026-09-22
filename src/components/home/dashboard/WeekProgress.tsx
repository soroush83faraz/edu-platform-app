import { CalendarRange } from "lucide-react";
import { cn } from "cn";
import { PageSection } from "@/components/layout/PageSection";
import { formatNumberFa, tehranDayBounds } from "@/lib/format";
import { listInboxQuery } from "@/modules/workspace/queries";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «این هفته»: how much of the week's work is done — every item of my کارتابل (open or done) whose due date falls
 * in this Saturday-start week, counted from one inbox read (`tab: "all"`, no new SQL). A quiet number pair and
 * a bar; the bar turns success only at 100 %.
 */
export async function WeekProgress() {
  const bounds = tehranDayBounds();
  const weekStart = new Date(bounds.weekEnd.getTime() - 7 * DAY_MS);
  const r = await listInboxQuery({ tab: "all", limit: 100 });
  const rows = (r.ok ? r.data.rows : []).filter((row) => row.dueAt !== null && row.dueAt.getTime() >= weekStart.getTime() && row.dueAt.getTime() < bounds.weekEnd.getTime());
  const total = rows.length;
  const done = rows.filter((row) => row.category === "done").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <PageSection id="week-progress" title="این هفته" icon={CalendarRange} surface="panel">
      {total === 0 ? (
        <p className="text-sm text-text-muted">تکلیفی با مهلت این هفته ندارید.</p>
      ) : (
        <div className="flex items-center gap-4">
          <span className="tabular text-title font-bold text-text">
            {formatNumberFa(done)}
            <span className="text-section font-normal text-text-muted">/{formatNumberFa(total)}</span>
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm text-text-muted">{done === total ? "همهٴ تکالیف این هفته انجام شده." : `${formatNumberFa(total - done)} تکلیف تا پایان هفته مانده.`}</span>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="پیشرفت این هفته">
              <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-sky")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}
    </PageSection>
  );
}
