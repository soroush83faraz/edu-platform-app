import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { Chip, type ChipTone } from "@/components/Chip";
import { PRIORITY_LABELS, priorityTone } from "@/components/PriorityStripe";
import { RelativeTime } from "@/components/RelativeTime";
import { formatJalaliDateTime, formatNumberFa } from "@/lib/format";
import { workItemDetailQuery } from "@/modules/workspace/queries";
import type { StatusCategory } from "@/modules/workspace/repo";
import { CommentForm } from "@/modules/workspace/ui/CommentForm";
import { WorkItemActions } from "@/modules/workspace/ui/WorkItemActions";

export const metadata: Metadata = { title: "کار | سامانهٴ مدرسه" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORY_TONE: Record<StatusCategory, ChipTone> = { todo: "neutral", doing: "primary", done: "success", cancelled: "neutral" };
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
  const done = assignees.filter((a) => a.state === "done").length;
  // Managers see per-person progress; a personal todo (the only assignee is the creator) needs none.
  const showProgress = viewer.isManager && assignees.length > 0 && !(assignees.length === 1 && assignees[0].personId === item.createdByPersonId);
  const now = new Date();
  const overdue = item.dueAt !== null && item.dueAt.getTime() < now.getTime() && (item.statusCategory === "todo" || item.statusCategory === "doing");
  const myState = myAssigneeState ? ASSIGNEE_STATE[myAssigneeState] : null;

  return (
    <article className="flex flex-col gap-4 px-4 pt-3 pb-6 md:pt-6">
      <Link href="/inbox" className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
        <ArrowRight className="size-4" aria-hidden />
        کارتابل
      </Link>

      <header className="flex flex-col gap-3">
        <h2 className="text-xl font-bold leading-8 text-text">
          <bdi>{item.title}</bdi>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={item.typeCode === "todo" ? "neutral" : "primary"}>{item.typeName}</Chip>
          <Chip tone={priorityTone(item.priority)}>اولویت {PRIORITY_LABELS[item.priority]}</Chip>
          {myState && !viewer.isManager ? <Chip tone={myState.tone}>{myState.label}</Chip> : <Chip tone={CATEGORY_TONE[item.statusCategory]}>{item.statusName}</Chip>}
        </div>
        <dl className="flex flex-col gap-1 text-sm text-text-muted">
          <div className="flex gap-2">
            <dt className="shrink-0">از</dt>
            <dd className="text-text">
              <bdi>{creatorName}</bdi>
              <span className="text-text-muted">
                {" · "}
                <RelativeTime at={item.createdAt} mode="time" />
              </span>
            </dd>
          </div>
          {item.dueAt ? (
            <div className="flex gap-2">
              <dt className="shrink-0">مهلت</dt>
              <dd className={cn(overdue ? "font-medium text-danger" : "text-text")}>
                {formatJalaliDateTime(item.dueAt)}
                <span className={cn("text-text-muted", overdue && "text-danger")}>
                  {" ("}
                  <RelativeTime at={item.dueAt} />
                  {")"}
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
        <WorkItemActions
          workItemId={item.id}
          statusCategory={item.statusCategory}
          myAssigneeState={myAssigneeState}
          isManager={viewer.isManager}
          canUpdate={viewer.canUpdate}
          inbox={myInbox ? { state: myInbox.state, isPinned: myInbox.isPinned } : null}
        />
      </header>

      {item.description ? (
        <section className="rounded-card bg-surface p-4 shadow-1">
          <p className="whitespace-pre-wrap text-base leading-7 text-text">
            <bdi>{item.description}</bdi>
          </p>
        </section>
      ) : null}

      {showProgress ? (
        <section aria-labelledby="progress-heading" className="rounded-card bg-surface shadow-1">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <h3 id="progress-heading" className="text-sm font-semibold text-text-muted">
              گیرندگان
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
                  {a.respondedAt ? <RelativeTime at={a.respondedAt} mode="time" className="text-xs" /> : null}
                  <Chip tone={ASSIGNEE_STATE[a.state].tone}>{ASSIGNEE_STATE[a.state].label}</Chip>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="comments-heading" className="flex flex-col gap-3">
        <h3 id="comments-heading" className="text-sm font-semibold text-text-muted">
          گفت‌وگو {comments.length > 0 ? <span className="tabular">({formatNumberFa(comments.length)})</span> : null}
        </h3>
        {comments.length === 0 ? <p className="text-sm text-text-faint">هنوز نظری ثبت نشده.</p> : null}
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className={cn("rounded-card bg-surface px-4 py-3 shadow-1", c.visibility === "staff_only" && "bg-warning-soft/50 ring-1 ring-warning/50")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-text-muted">
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
        {viewer.canComment && !item.archivedAt ? <CommentForm workItemId={item.id} canStaffOnly={viewer.isStaff} /> : null}
      </section>

      {watchers.length > 0 ? (
        <p className="text-sm text-text-muted">
          ناظران: {watchers.map((w, i) => (
            <span key={w.personId}>
              {i > 0 ? "، " : ""}
              <bdi>{w.name}</bdi>
            </span>
          ))}
        </p>
      ) : null}

      {transitions.length > 1 ? (
        <details className="rounded-card bg-surface shadow-1">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-text-muted">تاریخچهٴ وضعیت</summary>
          <ol className="divide-y divide-line/70 border-t border-line/70">
            {transitions.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-text">
                  {t.fromStatusName ? `${t.fromStatusName} ← ` : ""}
                  {t.toStatusName}
                  <span className="text-text-muted">
                    {" · "}
                    <bdi>{t.byName}</bdi>
                  </span>
                </span>
                <RelativeTime at={t.at} mode="time" className="text-xs text-text-muted" />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}
