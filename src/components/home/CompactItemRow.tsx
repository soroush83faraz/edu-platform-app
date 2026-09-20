import Link from "next/link";
import { cn } from "cn";
import { PriorityStripe } from "@/components/PriorityStripe";
import { RelativeTime } from "@/components/RelativeTime";
import { formatNumberFa } from "@/lib/format";
import type { InboxRow } from "@/modules/workspace/repo";

/**
 * One کار in a Home list: title, due (red when overdue) or sender, and — for items I gave — a slim progress bar.
 * Denser than the کارتابل row; the priority stripe stays as the one colour cue.
 */
export function CompactItemRow({ row }: { row: InboxRow }) {
  const overdue = row.bucket === "overdue";
  const showProgress = row.createdByMe && row.assigneesTotal > 0 && !(row.assigneesTotal === 1 && row.myAssigneeState);
  return (
    <li className="relative">
      <PriorityStripe priority={row.priority} className="inset-y-3 w-0.75" />
      <Link href={`/inbox/${row.id}`} className="flex min-h-14 items-center gap-3 ps-4 pe-3 py-2 transition-colors duration-150 hover:bg-surface-sunken active:bg-surface-sunken">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className={cn("truncate text-sm leading-6 text-text", row.unread ? "font-semibold" : "font-medium")}>
            <bdi>{row.title}</bdi>
          </p>
          <p className="flex items-center gap-2 text-xs text-text-muted">
            {row.dueAt ? <RelativeTime at={row.dueAt} className={cn(overdue && "font-medium text-danger")} /> : <span>بدون مهلت</span>}
            {!row.createdByMe ? (
              <span className="truncate">
                از <bdi>{row.creatorName}</bdi>
              </span>
            ) : null}
          </p>
        </div>
        {showProgress ? <Progress done={row.assigneesDone} total={row.assigneesTotal} /> : null}
        {row.unread && !showProgress ? <span className="size-2 shrink-0 rounded-full bg-sky" aria-label="خوانده‌نشده" /> : null}
      </Link>
    </li>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className="tabular text-xs text-text-muted">
        {formatNumberFa(done)}/{formatNumberFa(total)}
      </span>
      <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="پیشرفت">
        <span className="block h-full rounded-full bg-sky" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
