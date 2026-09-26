import Link from "next/link";
import { cn } from "cn";
import { PriorityDot } from "@/components/RowMark";
import type { InboxRow } from "@/modules/workspace/repo";
import { MetaLine, Progress, WorkItemMark, rowMeta } from "@/modules/workspace/ui/InboxRow";

/**
 * One کار in a Home list: the مُهر درس (or the quiet type glyph when it has no درس), the title with its priority
 * dot, one meta line — درس (+ class on what I gave) · deadline (red when overdue) or sender — and, for items I
 * gave, «۳/۲۵» over a slim progress bar. Denser than the کارتابل row.
 */
export function CompactItemRow({ row }: { row: InboxRow }) {
  const showProgress = row.createdByMe && row.assigneesTotal > 0 && !(row.assigneesTotal === 1 && row.myAssigneeState);
  return (
    <li>
      <Link href={`/inbox/${row.id}`} className="pressable flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken active:bg-surface-sunken">
        <WorkItemMark row={row} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className={cn("truncate text-sm text-text", row.unread ? "font-semibold" : "font-medium")}>
            <PriorityDot priority={row.priority} className="me-1.5 align-middle" />
            <bdi>{row.title}</bdi>
          </p>
          <MetaLine parts={rowMeta(row, { noDue: "بدون مهلت" })} />
        </div>
        {showProgress ? <Progress done={row.assigneesDone} total={row.assigneesTotal} /> : null}
        {row.unread && !showProgress ? <span className="size-2 shrink-0 rounded-full bg-sky" aria-label="خوانده‌نشده" /> : null}
      </Link>
    </li>
  );
}
