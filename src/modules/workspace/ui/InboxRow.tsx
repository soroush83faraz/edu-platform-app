import { ClipboardList, Clock, ListTodo, MessageSquare, Pin } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { IconChip } from "@/components/IconChip";
import { priorityChipTone } from "@/components/priority";
import { RelativeTime } from "@/components/RelativeTime";
import { formatNumberFa } from "@/lib/format";
import type { InboxRow as Row } from "../repo";

/**
 * One کار in the list, read in one glance: the type chip (todo / task glyph) tinted by priority, bold title when
 * unread, one meta line (due on a clock chip — red when overdue — then who gave it or my progress on it), and the
 * unread dot at the end. 64 px minimum, the whole row is the target.
 */
export function InboxRow({ row }: { row: Row }) {
  const overdue = row.bucket === "overdue";
  const closed = row.category === "done" || row.category === "cancelled";
  const showProgress = row.createdByMe && row.assigneesTotal > 0 && !(row.assigneesTotal === 1 && row.myAssigneeState);
  return (
    <li>
      <Link
        href={`/inbox/${row.id}`}
        className={cn(
          "pressable flex min-h-16 items-center gap-3 px-3 py-2.5 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken active:bg-surface-sunken",
          closed && "opacity-70",
        )}
      >
        <IconChip icon={row.typeCode === "todo" ? ListTodo : ClipboardList} tone={closed ? "muted" : priorityChipTone(row.priority)} label={row.typeName} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn("line-clamp-2 text-base leading-6 text-text", row.unread ? "font-semibold" : "font-medium")}>
            <bdi>{row.title}</bdi>
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            {row.dueAt ? (
              <Chip tone={overdue ? "danger" : "neutral"} className="h-5 px-1.5 text-xs">
                <Clock className="size-3" strokeWidth={2} aria-hidden />
                <RelativeTime at={row.dueAt} />
              </Chip>
            ) : null}
            {showProgress ? (
              <span className="tabular">
                {formatNumberFa(row.assigneesDone)}/{formatNumberFa(row.assigneesTotal)} انجام شد
              </span>
            ) : row.createdByMe ? null : (
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
            {row.isPinned ? <Pin className="size-3.5 text-sky-strong" aria-label="سنجاق‌شده" /> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {showProgress ? <ProgressBar done={row.assigneesDone} total={row.assigneesTotal} /> : null}
          {row.unread ? <span className="size-2.5 rounded-full bg-sky" aria-label="خوانده‌نشده" /> : null}
          {row.category === "done" ? <Chip tone="success">انجام‌شده</Chip> : row.category === "cancelled" ? <Chip tone="neutral">لغوشده</Chip> : null}
        </div>
      </Link>
    </li>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="پیشرفت">
      <span className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-sky")} style={{ width: `${pct}%` }} />
    </span>
  );
}
