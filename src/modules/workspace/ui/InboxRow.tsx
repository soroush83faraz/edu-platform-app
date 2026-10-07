// The shared parts of a work-item row: its mark, its meta line and my progress on what I gave. The rows themselves
// are `WorkItemRow` (the unified list of «پنل من» and the subject page, ./WorkItemList) and Home's compact rows.
import { ClipboardList, ListTodo } from "lucide-react";
import { cn } from "@/lib/cn";
import { RelativeTime } from "@/components/RelativeTime";
import { RowMark } from "@/components/RowMark";
import { SubjectStamp } from "@/components/SubjectStamp";
import { formatNumberFa } from "@/lib/format";
import { offeringHue, type OfferingHues } from "@/lib/subject-stamp";
import type { InboxRow as Row } from "../repo";

/**
 * The lead of a work-item row: the مُهر درس when the item belongs to a درس, else the quiet type glyph. A closed
 * row's mark is faded with its title. The stamp wears the reader's own colour of the class when they teach it
 * (`hues`, `offeringHue`), else the درس's hue.
 */
export function WorkItemMark({ row, label, className, hues }: { row: Row; label?: string; className?: string; hues?: OfferingHues }) {
  const closed = row.category === "done" || row.category === "cancelled";
  if (row.subjectId && row.subjectName) {
    return <SubjectStamp subjectId={row.subjectId} name={row.subjectName} hue={offeringHue(hues, row.offeringId, row.subjectId)} className={cn(closed && "opacity-60", className)} />;
  }
  return <RowMark icon={row.typeCode === "todo" ? ListTodo : ClipboardList} label={label} className={cn(closed && "opacity-60", className)} />;
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
