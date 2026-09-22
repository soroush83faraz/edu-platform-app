import { Ban, CalendarOff, CircleCheck, Clock, Flag, ListTodo, type LucideIcon, Play } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { Chip, type ChipTone } from "@/components/Chip";
import { RowMark } from "@/components/RowMark";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PRIORITY_LABELS, priorityTone } from "@/components/priority";
import { RelativeTime } from "@/components/RelativeTime";
import { formatJalaliDateTime, formatNumberFa } from "@/lib/format";
import { workItemDetailQuery } from "@/modules/workspace/queries";
import type { StatusCategory } from "@/modules/workspace/repo";
import { CommentForm } from "@/modules/workspace/ui/CommentForm";
import { WorkItemActions } from "@/modules/workspace/ui/WorkItemActions";

export const metadata: Metadata = { title: "تکلیف | سامانهٴ مدرسه" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORY_FACT: Record<StatusCategory, { icon: LucideIcon }> = {
  todo: { icon: ListTodo },
  doing: { icon: Play },
  done: { icon: CircleCheck },
  cancelled: { icon: Ban },
};
const ASSIGNEE_STATE: Record<"pending" | "accepted" | "done", { label: string; tone: ChipTone }> = {
  pending: { label: "در انتظار", tone: "neutral" },
  accepted: { label: "در حال انجام", tone: "primary" },
  done: { label: "انجام‌شده", tone: "success" },
};
const ASSIGNEE_FACT: Record<"pending" | "accepted" | "done", { icon: LucideIcon }> = {
  pending: { icon: ListTodo },
  accepted: { icon: Play },
  done: { icon: CircleCheck },
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
  // Assignees see their own state; managers see the item's status.
  const statusFact =
    myAssigneeState && myState && !viewer.isManager ? { ...ASSIGNEE_FACT[myAssigneeState], value: myState.label } : { ...CATEGORY_FACT[item.statusCategory], value: item.statusName };

  return (
    <ContentWidth size="reading" className="gap-4">
      <PageHeader
        back={{ href: "/inbox", label: "پنل من" }}
        title={<bdi>{item.title}</bdi>}
        description={
          <>
            <Chip tone={item.typeCode === "todo" ? "neutral" : "primary"} className="me-1.5 align-middle">
              {item.typeName}
            </Chip>
            از <bdi className="text-text">{creatorName}</bdi>
            <span aria-hidden> · </span>
            <RelativeTime at={item.createdAt} mode="time" />
          </>
        }
      />
      <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">

        {/* The three facts a reader checks before acting — status, priority, due — as chip-led cells in one card. */}
        <dl className="surface-panel grid grid-cols-3 divide-x divide-line">
          <Fact icon={statusFact.icon} label="وضعیت" value={statusFact.value} />
          <Fact icon={Flag} label="اولویت" value={<Chip tone={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Chip>} />
          {item.dueAt ? (
            <Fact icon={Clock} label="مهلت" value={<RelativeTime at={item.dueAt} />} hint={formatJalaliDateTime(item.dueAt)} alert={overdue} />
          ) : (
            <Fact icon={CalendarOff} label="مهلت" value="بدون مهلت" />
          )}
        </dl>
        <WorkItemActions
          workItemId={item.id}
          title={item.title}
          statusCategory={item.statusCategory}
          dueAt={item.dueAt}
          assigneeCount={assignees.length}
          myAssigneeState={myAssigneeState}
          isManager={viewer.isManager}
          canUpdate={viewer.canUpdate}
          inbox={myInbox ? { state: myInbox.state, isPinned: myInbox.isPinned } : null}
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
                  {a.respondedAt ? <RelativeTime at={a.respondedAt} mode="time" className="text-meta" /> : null}
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
          ناظران: {watchers.map((w, i) => (
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
                  {t.fromStatusName ? `${t.fromStatusName} ← ` : ""}
                  {t.toStatusName}
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

/** One cell of the facts row: the quiet glyph on top, a label, the value (priority as its chip); `hint` is the exact timestamp under a relative due. */
function Fact({ icon, label, value, hint, alert = false }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: string; alert?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 px-2 py-4 text-center">
      <RowMark icon={icon} tone={alert ? "danger" : "muted"} />
      <dt className="text-meta text-text-muted">{label}</dt>
      <dd className={cn("text-sm font-semibold leading-5 text-balance", alert ? "text-danger" : "text-text")}>
        {value}
        {hint ? <span className="mt-0.5 block text-meta font-normal text-text-faint">{hint}</span> : null}
      </dd>
    </div>
  );
}
