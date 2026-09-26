import { ClipboardList, ListTodo, MessageSquare } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { RelativeTime } from "@/components/RelativeTime";
import { PriorityDot, RowMark } from "@/components/RowMark";
import { SubjectStamp } from "@/components/SubjectStamp";
import { formatNumberFa } from "@/lib/format";
import { type WorkItemVoice, type WorkItemWords, personalItemLabel, workItemWords } from "@/lib/work-item-words";
import type { InboxRow as Row } from "../repo";

/**
 * One کار in the list, read in one glance: the مُهر درس of its subject (or, for a personal note / an admin task,
 * the quiet type glyph in a 32 px panel circle — a `task` named in the READER's word), the title (bold when unread)
 * with a small priority dot beside it for high / urgent, and ONE meta line — «ریاضی · تا پنج‌شنبه» for a student,
 * «ریاضی · کلاس ۱۰۲ · تا پنج‌شنبه» for the teacher who gave it; the deadline is plain text, red only when overdue.
 * Items without a درس name their sender instead. A closed row has its title struck through and muted (no chip);
 * the end column holds my progress on what I gave and the unread dot. 64 px minimum, the whole row is the target.
 *
 * `words` is the reader's noun set; it defaults to «تکلیف» for the lists that are a teaching context anyway.
 * `createVoice` is the reader's word for a کار of their own — it names the PERSONAL rows (`todo`): «تسک» for a
 * student, the catalog's own «کار شخصی» for everyone else. `inSubject` drops the درس and class from the meta
 * (the subject page already says them).
 */
export function InboxRow({
  row,
  words = workItemWords("assignment"),
  createVoice = "assignment",
  inSubject = false,
}: {
  row: Row;
  words?: WorkItemWords;
  createVoice?: WorkItemVoice;
  inSubject?: boolean;
}) {
  const closed = row.category === "done" || row.category === "cancelled";
  const showProgress = row.createdByMe && row.assigneesTotal > 0 && !(row.assigneesTotal === 1 && row.myAssigneeState);
  const meta = rowMeta(row, { inSubject });
  if (row.category === "cancelled") meta.push(<span key="cancelled">حذف‌شده</span>);
  if (row.commentsCount > 0) {
    meta.push(
      <span key="comments" className="inline-flex items-center gap-1">
        <MessageSquare className="size-3.5" aria-hidden />
        <span className="tabular">{formatNumberFa(row.commentsCount)}</span>
      </span>,
    );
  }
  return (
    <li>
      <Link
        href={`/inbox/${row.id}`}
        className="pressable flex min-h-16 items-center gap-3 px-3 py-2.5 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken active:bg-surface-sunken"
      >
        <WorkItemMark row={row} label={row.typeCode === "todo" ? personalItemLabel(createVoice, row.typeName) : words.singular} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className={cn("line-clamp-2 text-row", closed ? "font-medium text-text-muted line-through decoration-text-faint" : cn("text-text", row.unread ? "font-semibold" : "font-medium"))}>
            {!closed ? <PriorityDot priority={row.priority} className="me-1.5 align-middle" /> : null}
            <bdi>{row.title}</bdi>
          </p>
          {meta.length > 0 ? <MetaLine parts={meta} /> : null}
        </div>
        {showProgress || row.unread ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {showProgress ? <Progress done={row.assigneesDone} total={row.assigneesTotal} /> : null}
            {row.unread ? <span className="size-2.5 rounded-full bg-sky" aria-label="خوانده‌نشده" /> : null}
          </div>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * The lead of a work-item row: the مُهر درس when the item belongs to a درس, else the quiet type glyph. A closed
 * row's mark is faded with its title.
 */
export function WorkItemMark({ row, label }: { row: Row; label?: string }) {
  const closed = row.category === "done" || row.category === "cancelled";
  if (row.subjectId && row.subjectName) return <SubjectStamp subjectId={row.subjectId} name={row.subjectName} className={cn(closed && "opacity-60")} />;
  return <RowMark icon={row.typeCode === "todo" ? ListTodo : ClipboardList} label={label} className={cn(closed && "opacity-60")} />;
}

/**
 * The meta parts shared by the list rows: the درس (and, on what I gave, its class), then the deadline — red only
 * when overdue — and, for an item without a درس given to me, its sender. `noDue` is what an item without a
 * deadline says (nothing by default).
 */
export function rowMeta(row: Row, { inSubject = false, noDue }: { inSubject?: boolean; noDue?: string } = {}): React.ReactNode[] {
  const closed = row.category === "done" || row.category === "cancelled";
  const parts: React.ReactNode[] = [];
  if (row.subjectName && !inSubject) {
    parts.push(
      <bdi key="subject">{row.subjectName}</bdi>,
    );
    if (row.createdByMe && row.classGroupName) {
      parts.push(
        <span key="class" className="whitespace-nowrap">
          کلاس <bdi>{row.classGroupName}</bdi>
        </span>,
      );
    }
  }
  if (row.dueAt) {
    parts.push(<RelativeTime key="due" at={row.dueAt} mode="due" open={!closed} className={cn("whitespace-nowrap", row.bucket === "overdue" && !closed && "font-medium text-danger")} />);
  } else if (noDue) {
    parts.push(<span key="due">{noDue}</span>);
  }
  if (!row.createdByMe && !row.subjectName) {
    parts.push(
      <span key="from" className="truncate">
        از <bdi>{row.creatorName}</bdi>
      </span>,
    );
  }
  return parts;
}

/**
 * Meta parts joined by a quiet middle dot, wrapping on narrow phones. Every part carries its own leading dot in a
 * 16 px slot and the list is pulled 16 px past the start edge of a clipped box, so the dot of a part that starts a
 * line is clipped away — a wrapped line never ends or begins with a stray «·».
 */
export function MetaLine({ parts, className }: { parts: React.ReactNode[]; className?: string }) {
  return (
    <span className={cn("block min-w-0 overflow-hidden text-meta text-text-muted", className)}>
      <span className="-ms-4 flex flex-wrap items-center">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex min-w-0 max-w-full items-center whitespace-nowrap">
            <span aria-hidden className="w-4 shrink-0 text-center text-text-faint">
              ·
            </span>
            {p}
          </span>
        ))}
      </span>
    </span>
  );
}

/** My progress on what I gave: «۳/۲۵» over a slim bar (green only at 100 %). */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="tabular text-meta text-text-muted">
        {formatNumberFa(done)}/{formatNumberFa(total)}
      </span>
      <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="پیشرفت">
        <span className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-sky")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
