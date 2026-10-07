import { Ban, CalendarDays, Check, ChevronLeft, Circle, CircleAlert, type LucideIcon, Users } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { LeavingList } from "@/components/motion/LeavingList";
import { RelativeTime } from "@/components/RelativeTime";
import { PriorityDot } from "@/components/RowMark";
import type { OfferingHues } from "@/lib/subject-stamp";
import { type WorkItemVoice, type WorkItemWords, personalItemLabel, workItemWords } from "@/lib/work-item-words";
import type { InboxRow as Row } from "../repo";
import { isClosed, listStatusOf, orderWorkItems, progressText, showsProgress, type WorkItemListStatus } from "../work-item-list";
import { MetaLine, WorkItemMark } from "./InboxRow";

const TAGS: Record<WorkItemListStatus, { label: string; icon: LucideIcon; className: string }> = {
  pending: { label: "در انتظار", icon: Circle, className: "bg-primary-50 text-primary-700" },
  overdue: { label: "مهلت گذشته", icon: CircleAlert, className: "bg-danger-soft text-danger" },
  done: { label: "انجام‌شده", icon: Check, className: "bg-success-soft text-success" },
  cancelled: { label: "حذف‌شده", icon: Ban, className: "bg-surface-sunken text-text-muted" },
};

/**
 * The status tag at the END of a row of the unified list: «در انتظار» (primary-50 / primary-700), «مهلت گذشته»
 * (danger-soft / danger), «انجام‌شده» (success-soft / success — the one place green says «completed»), or a quiet
 * «حذف‌شده». A pill: `text-xs`, its own 14 px glyph.
 */
export function WorkItemStatusTag({ status, className }: { status: WorkItemListStatus; className?: string }) {
  const tag = TAGS[status];
  const Icon = tag.icon;
  return (
    <span data-status={status} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 ps-2 pe-2.5 text-xs font-semibold whitespace-nowrap", tag.className, className)}>
      <Icon className="size-3.5" strokeWidth={2} aria-hidden />
      {tag.label}
    </span>
  );
}

/**
 * One row of the unified list: (optionally) the row's mark — the مُهر درس, or the quiet type glyph for a personal
 * note / an admin task — then the title (priority dot beside it while open, semibold when unread, muted once
 * finished), ONE meta line — the درس (and, on what I gave, its class) unless the page is the درس's own, the
 * deadline with its calendar glyph (red when overdue), and, on what I gave, «۹ از ۲۴ انجام داده‌اند» over a thin sky
 * bar (just «همه انجام دادند» once everyone has) — and the status tag at the end. The whole row is the link, ≥ 64 px.
 */
export function WorkItemRow({
  row,
  words = workItemWords("assignment"),
  createVoice = "assignment",
  inSubject = false,
  mark = true,
  chevron = false,
  hues,
}: {
  row: Row;
  words?: WorkItemWords;
  createVoice?: WorkItemVoice;
  /** On the درس's own page: no درس / class in the meta (the hero already says them). */
  inSubject?: boolean;
  /** Lead with the row's mark («پنل من» — many درس‌ها); the subject page leaves it out. */
  mark?: boolean;
  /** An end chevron after the tag (the subject page, whose rows have no mark to read as links). */
  chevron?: boolean;
  hues?: OfferingHues;
}) {
  const closed = isClosed(row);
  const status = listStatusOf(row);
  const progress = showsProgress(row);
  const meta: React.ReactNode[] = [];
  if (row.subjectName && !inSubject) {
    meta.push(<bdi key="subject">{row.subjectName}</bdi>);
    if (row.createdByMe && row.classGroupName) {
      meta.push(
        <span key="class" className="whitespace-nowrap">
          کلاس <bdi>{row.classGroupName}</bdi>
        </span>,
      );
    }
  }
  if (row.dueAt) {
    meta.push(
      <span key="due" className={cn("inline-flex items-center gap-1 whitespace-nowrap", status === "overdue" && "font-medium text-danger")}>
        <CalendarDays className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <RelativeTime at={row.dueAt} mode="due" open={!closed} />
      </span>,
    );
  }
  if (progress && row.category !== "cancelled") {
    const all = row.assigneesDone >= row.assigneesTotal;
    meta.push(
      <span key="progress" className="inline-flex items-center gap-1 whitespace-nowrap">
        {all ? null : <Users className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
        {progressText(row.assigneesDone, row.assigneesTotal)}
      </span>,
    );
  }
  if (!row.createdByMe && !row.subjectName) {
    meta.push(
      <span key="from" className="truncate">
        از <bdi>{row.creatorName}</bdi>
      </span>,
    );
  }
  const pct = row.assigneesTotal === 0 ? 0 : Math.round((row.assigneesDone / row.assigneesTotal) * 100);
  return (
    <li data-row-id={row.id}>
      <Link
        prefetch={false}
        href={`/inbox/${row.id}`}
        className={cn("pressable flex min-h-16 items-center gap-3 px-3.5 py-3 hover:bg-surface-sunken active:bg-surface-sunken", closed && "bg-surface-sunken/40")}
      >
        {mark ? <WorkItemMark row={row} label={row.typeCode === "todo" ? personalItemLabel(createVoice, row.typeName) : words.singular} hues={hues} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className={cn("line-clamp-2 text-row", closed ? "font-medium text-text-muted" : cn("text-text", row.unread ? "font-semibold" : "font-medium"))}>
            <bdi data-slot="row-title">{row.title}</bdi>
            {!closed ? <PriorityDot priority={row.priority} className="ms-1.5 align-middle" /> : null}
            {row.unread ? <span className="ms-1.5 inline-block size-2 rounded-full bg-sky align-middle" role="img" aria-label="خوانده‌نشده" /> : null}
          </p>
          {meta.length > 0 ? <MetaLine parts={meta} /> : null}
          {progress && !closed && pct < 100 ? (
            <span
              className="mt-1 block h-1 w-30 max-w-full overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={row.assigneesTotal}
              aria-valuenow={row.assigneesDone}
              aria-label="پیشرفت کلاس"
            >
              <span className="block h-full rounded-full bg-sky" style={{ width: `${pct}%` }} />
            </span>
          ) : null}
        </div>
        <WorkItemStatusTag status={status} />
        {chevron ? <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden /> : null}
      </Link>
    </li>
  );
}

/**
 * The unified list (owner, mock class-page-v3): ONE `surface-work` box — the open rows (overdue → by deadline → no
 * deadline), then a quiet «انجام‌شده‌ها» divider and the finished rows, latest first (`orderWorkItems`: each row lands
 * by its own category, whatever part of the query it came from).
 * One `LeavingList`, so a row finished on the detail page (handed over by `completedFrom`) glides from the open part
 * down into the finished part (`moves`) instead of popping. `openEmpty`: the line shown in place of the open rows
 * when only finished ones exist. `rowProps` are passed to every `WorkItemRow`.
 */
export function WorkItemList({
  open,
  done,
  openEmpty,
  rowProps,
  className,
}: {
  open: Row[];
  done: Row[];
  openEmpty?: string;
  rowProps?: Omit<React.ComponentProps<typeof WorkItemRow>, "row">;
  className?: string;
}) {
  const { open: openRows, done: doneRows } = orderWorkItems([...open, ...done]);
  return (
    <LeavingList className={cn("reveal-rows surface-work divide-y divide-line/70 overflow-hidden", className)} completedFrom moves>
      {openRows.length === 0 && doneRows.length > 0 && openEmpty ? (
        <li key="open-empty" data-row-id="open-empty" className="px-3.5 py-4 text-sm text-text-muted">
          {openEmpty}
        </li>
      ) : null}
      {openRows.map((row) => (
        <WorkItemRow key={row.id} row={row} {...rowProps} />
      ))}
      {doneRows.length > 0 ? (
        <li key="done-divider" data-row-id="done-divider" className="flex items-center gap-2 bg-surface-sunken px-3.5 py-2 text-meta text-text-muted after:h-px after:flex-1 after:bg-line">
          انجام‌شده‌ها
        </li>
      ) : null}
      {doneRows.map((row) => (
        <WorkItemRow key={row.id} row={row} {...rowProps} />
      ))}
    </LeavingList>
  );
}
