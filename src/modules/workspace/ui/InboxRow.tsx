import { MessageSquare, Pin } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { PriorityStripe } from "@/components/PriorityStripe";
import { RelativeTime } from "@/components/RelativeTime";
import { formatNumberFa } from "@/lib/format";
import type { InboxRow as Row } from "../repo";

/**
 * One کار in the list. Reads in one glance: colour bar = priority, bold = unread, second line = who/when,
 * end = progress (for items I gave) or the unread dot.
 */
export function InboxRow({ row }: { row: Row }) {
  const overdue = row.bucket === "overdue";
  const closed = row.category === "done" || row.category === "cancelled";
  return (
    <li className="relative">
      <PriorityStripe priority={row.priority} />
      <Link
        href={`/inbox/${row.id}`}
        className={cn("flex min-h-[4.5rem] items-center gap-3 ps-5 pe-4 py-3 transition-colors hover:bg-surface-sunken active:bg-surface-sunken", closed && "opacity-70")}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn("line-clamp-2 text-base leading-6 text-text", row.unread ? "font-semibold" : "font-medium")}>
            <bdi>{row.title}</bdi>
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <Chip tone={row.typeCode === "todo" ? "neutral" : "primary"}>{row.typeName}</Chip>
            {row.dueAt ? (
              <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-danger")}>
                <RelativeTime at={row.dueAt} />
              </span>
            ) : null}
            {row.createdByMe ? null : (
              <span className="truncate">
                از <bdi>{row.creatorName}</bdi>
              </span>
            )}
            {row.commentsCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5" aria-hidden />
                <span className="tabular">{formatNumberFa(row.commentsCount)}</span>
              </span>
            ) : null}
            {row.isPinned ? <Pin className="size-3.5 text-primary-600" aria-label="سنجاق‌شده" /> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {row.createdByMe && row.assigneesTotal > 0 && !(row.assigneesTotal === 1 && row.myAssigneeState) ? (
            <Progress done={row.assigneesDone} total={row.assigneesTotal} />
          ) : null}
          {row.unread ? <span className="size-2.5 rounded-full bg-primary-500" aria-label="خوانده‌نشده" /> : null}
          {row.category === "done" ? <Chip tone="success">انجام‌شده</Chip> : row.category === "cancelled" ? <Chip tone="neutral">لغوشده</Chip> : null}
        </div>
      </Link>
    </li>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="tabular text-sm text-text-muted">
        {formatNumberFa(done)}/{formatNumberFa(total)} انجام شد
      </span>
      <span className="block h-1 w-16 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
