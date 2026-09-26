import { Ban, CalendarClock, CircleCheck, Play } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { Chip, type ChipTone } from "@/components/Chip";
import { PriorityDot } from "@/components/RowMark";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PRIORITY_LABELS } from "@/components/priority";
import { RelativeTime } from "@/components/RelativeTime";
import { formatDueLongFa, formatNumberFa } from "@/lib/format";
import { personalItemLabel, workItemStatusLabel, workItemWords } from "@/lib/work-item-words";
import { workItemDetailQuery } from "@/modules/workspace/queries";
import type { StatusCategory } from "@/modules/workspace/repo";
import { CommentForm } from "@/modules/workspace/ui/CommentForm";
import { WorkItemActions } from "@/modules/workspace/ui/WorkItemActions";

// Role-neutral in the tab title (the page itself says «تکلیف» / «تسک» once it knows the reader).
export const metadata: Metadata = { title: "کار" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_ICON: Record<StatusCategory, typeof Play | null> = { todo: null, doing: Play, done: CircleCheck, cancelled: Ban };
const ASSIGNEE_STATE: Record<"pending" | "accepted" | "done", { label: string; tone: ChipTone }> = {
  pending: { label: "در انتظار", tone: "neutral" },
  accepted: { label: "در حال انجام", tone: "primary" },
  done: { label: "انجام‌شده", tone: "success" },
};

export default async function WorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await workItemDetailQuery({ workItemId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound(); // NOT_FOUND and FORBIDDEN alike: the page never distinguishes "not yours" from "does not exist"
  }
  const { item, creatorName, assignees, watchers, comments, transitions, myInbox, myAssigneeState, viewer } = result.data;
  const words = workItemWords(viewer.voice);
  const done = assignees.filter((a) => a.state === "done").length;
  // Managers see per-person progress; a personal todo (the only assignee is the creator) needs none.
  const showProgress = viewer.isManager && assignees.length > 0 && !(assignees.length === 1 && assignees[0].personId === item.createdByPersonId);
  const now = new Date();
  const overdue = item.dueAt !== null && item.dueAt.getTime() < now.getTime() && (item.statusCategory === "todo" || item.statusCategory === "doing");
  // Status is said by the action row (an open item offers «انجام شد» / «اتمام»); only a state the buttons do not
  // show gets a small muted line — my own «انجام‌شده» / «در حال انجام», or the item's closed / started status.
  const status: { category: StatusCategory; label: string } | null =
    myAssigneeState && !viewer.isManager
      ? myAssigneeState === "pending"
        ? null
        : { category: myAssigneeState === "done" ? "done" : "doing", label: ASSIGNEE_STATE[myAssigneeState].label }
      : item.statusCategory === "todo"
        ? null
        : { category: item.statusCategory, label: workItemStatusLabel(item.statusName) };
  const StatusIcon = status ? STATUS_ICON[status.category] : null;
  const showPriority = !(item.statusCategory === "done" || item.statusCategory === "cancelled") && (item.priority === "high" || item.priority === "urgent");

  return (
    <ContentWidth size="reading" className="gap-4">
      <PageHeader
        back={{ href: "/inbox", label: "پنل من" }}
        title={<bdi>{item.title}</bdi>}
        description={
          <>
            {/* The type in the READER's word: a personal کار is the student's «تسک» or the catalog name,
                «تکلیف» / «تسک» for a task given to someone. */}
            <Chip tone={item.typeCode === "todo" ? "neutral" : "primary"} className="me-1.5 align-middle">
              {item.typeCode === "todo" ? personalItemLabel(viewer.createVoice, item.typeName) : words.singular}
            </Chip>
            از <bdi className="text-text">{creatorName}</bdi>
            <span aria-hidden> · </span>
            <RelativeTime at={item.createdAt} mode="time" />
          </>
        }
      />
      <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">

        {/* What a reader checks before acting, as plain start-aligned lines: the deadline (red once overdue), then
            the priority only when it is high / urgent and a status only when the buttons below do not say it. */}
        <div className="flex flex-col gap-1">
          <p className={cn("flex items-start gap-2 text-sm", overdue ? "font-medium text-danger" : "text-text")}>
            <CalendarClock className={cn("mt-1 size-4 shrink-0", overdue ? "text-danger" : "text-text-muted")} strokeWidth={1.75} aria-hidden />
            {item.dueAt ? (
              <span>
                <span className={overdue ? undefined : "text-text-muted"}>مهلت: </span>
                <time dateTime={item.dueAt.toISOString()}>{formatDueLongFa(item.dueAt, now)}</time>
                {overdue ? " · گذشته" : null}
              </span>
            ) : (
              <span className="text-text-muted">بدون مهلت</span>
            )}
          </p>
          {showPriority || status ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-6 text-meta text-text-muted">
              {showPriority ? (
                <span className="inline-flex items-center gap-1.5">
                  <PriorityDot priority={item.priority} />
                  اولویت {PRIORITY_LABELS[item.priority]}
                </span>
              ) : null}
              {status && StatusIcon ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusIcon className={cn("size-3.5", status.category === "done" && "text-success")} strokeWidth={2} aria-hidden />
                  {status.label}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <WorkItemActions
          workItemId={item.id}
          title={item.title}
          statusCategory={item.statusCategory}
          dueAt={item.dueAt}
          assigneeCount={assignees.length}
          myAssigneeState={myAssigneeState}
          isManager={viewer.isManager}
          canUpdate={viewer.canUpdate}
          words={words}
          inboxState={myInbox?.state ?? null}
        />
      </header>

      {item.description ? (
        <section className="surface-work p-4">
          <p className="whitespace-pre-wrap text-base leading-7 text-text">
            <bdi>{item.description}</bdi>
          </p>
        </section>
      ) : null}

      {showProgress ? (
        <section aria-labelledby="progress-heading" className="surface-work">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            {/* A class item went to that class's students; anything else to the people picked. */}
            <h3 id="progress-heading" className="text-section font-semibold text-text">
              {item.classOfferingId ? "دانش‌آموزان" : "گیرندگان"}
            </h3>
            <span className="tabular text-sm font-medium text-text">
              {formatNumberFa(done)}/{formatNumberFa(assignees.length)} انجام شد
            </span>
          </div>
          <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={assignees.length} aria-valuenow={done}>
            <div className={cn("h-full rounded-full", assignees.length > 0 && done === assignees.length ? "bg-success" : "bg-sky")} style={{ width: `${assignees.length ? Math.round((done / assignees.length) * 100) : 0}%` }} />
          </div>
          <ul className="mt-2 divide-y divide-line">
            {assignees.map((a) => (
              <li key={a.personId} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm">
                <bdi className="text-text">{a.name}</bdi>
                <span className="flex items-center gap-2 text-text-muted">
                  {a.respondedAt ? <RelativeTime at={a.respondedAt} mode="time" className="text-meta" /> : null}
                  <Chip tone={ASSIGNEE_STATE[a.state].tone}>{ASSIGNEE_STATE[a.state].label}</Chip>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="comments-heading" className="flex flex-col gap-3">
        <h3 id="comments-heading" className="text-section font-semibold text-text">
          گفت‌وگو {comments.length > 0 ? <span className="tabular text-meta font-normal text-text-muted">{formatNumberFa(comments.length)}</span> : null}
        </h3>
        {comments.length === 0 ? <p className="text-sm text-text-faint">هنوز نظری ثبت نشده.</p> : null}
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className={cn("surface-work px-4 py-3", c.visibility === "staff_only" && "bg-warning-soft/50 ring-1 ring-warning/50")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-meta text-text-muted">
                <span className="font-medium text-text">
                  <bdi>{c.authorName}</bdi>
                </span>
                <span className="flex items-center gap-2">
                  {c.visibility === "staff_only" ? <Chip tone="warning">فقط کادر</Chip> : null}
                  <RelativeTime at={c.createdAt} mode="time" />
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-base leading-7 text-text">
                <bdi>{c.body}</bdi>
              </p>
            </li>
          ))}
        </ul>
        {viewer.canComment && !item.archivedAt ? <CommentForm workItemId={item.id} canStaffOnly={viewer.isStaff} privateToStaff={myAssigneeState !== null && !viewer.isCreator && assignees.length > 1} /> : null}
      </section>

      {watchers.length > 0 ? (
        <p className="text-sm text-text-muted">
          در جریان: {watchers.map((w, i) => (
            <span key={w.personId}>
              {i > 0 ? "، " : ""}
              <bdi>{w.name}</bdi>
            </span>
          ))}
        </p>
      ) : null}

      {transitions.length > 1 ? (
        <details className="surface-panel">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-text-muted">تاریخچهٴ وضعیت</summary>
          <ol className="divide-y divide-line/70 border-t border-line/70">
            {transitions.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-text">
                  {t.fromStatusName ? `${workItemStatusLabel(t.fromStatusName)} ← ` : ""}
                  {workItemStatusLabel(t.toStatusName)}
                  <span className="text-text-muted">
                    {" · "}
                    <bdi>{t.byName}</bdi>
                  </span>
                </span>
                <RelativeTime at={t.at} mode="time" className="text-meta text-text-muted" />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      </article>
    </ContentWidth>
  );
}
