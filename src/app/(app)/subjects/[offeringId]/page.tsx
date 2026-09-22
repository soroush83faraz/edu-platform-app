import { ArrowRight, BookOpen, CalendarClock, CircleCheck, ListTodo, type LucideIcon, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { ClayIcon } from "@/components/ClayIcon";
import { EmptyState } from "@/components/EmptyState";
import { EmptyClay } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { formatNumberFa } from "@/lib/format";
import { formatSessionFa, formatTimeRangeFa, WEEKDAY_LABELS } from "@/lib/timetable";
import { offeringPageQuery } from "@/modules/academic/queries";
import type { InboxTab } from "@/modules/workspace/dto";
import { listInboxQuery } from "@/modules/workspace/queries";
import { InboxRow } from "@/modules/workspace/ui/InboxRow";

export const metadata: Metadata = { title: "درس | سامانهٴ مدرسه" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABS: Array<{ tab: Exclude<InboxTab, "all">; label: string; icon: LucideIcon }> = [
  { tab: "todo", label: "انجام‌نشده", icon: ListTodo },
  { tab: "done", label: "انجام‌شده", icon: CircleCheck },
];

/**
 * The subject page: the درس with its class and teacher, the next session, every session of the week, then the
 * work items of this درس — the caller's own inbox rows (a student sees what was given to them, a teacher what
 * they gave). A teacher gets «کار جدید برای این درس» with the offering pre-selected.
 */
export default async function SubjectPage({ params, searchParams }: { params: Promise<{ offeringId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { offeringId } = await params;
  if (!UUID_RE.test(offeringId)) notFound();
  const sp = await searchParams;
  const tab: Exclude<InboxTab, "all"> = sp.tab === "done" ? "done" : "todo";
  const page = await offeringPageQuery({ offeringId });
  if (!page.ok) {
    if (page.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { offering, sessions, nextSession, viewer } = page.data;
  const items = await listInboxQuery({ tab, offeringId });
  const rows = items.ok ? items.data.rows : [];
  const tabCounts = items.ok ? items.data.tabCounts : { todo: 0, done: 0 };
  const backHref = viewer.isStudent ? "/my-class" : viewer.isTeacher ? "/classes" : "/home";
  const backLabel = viewer.isStudent ? "کلاس من" : viewer.isTeacher ? "کلاس‌های من" : "خانه";

  return (
    <div className="reveal-stagger flex flex-col gap-5 px-4 pt-3 pb-8 md:pt-6">
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
        <ArrowRight className="size-4" aria-hidden />
        {backLabel}
      </Link>

      <header className="flex items-start gap-3">
        <ClayIcon icon={BookOpen} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-xl font-bold leading-8 text-text">
            <bdi>{offering.subjectName}</bdi>
          </h2>
          <p className="text-sm text-text-muted">
            کلاس <bdi>{offering.classGroupName}</bdi>
            {viewer.isTeacher ? null : offering.teacherName ? (
              <>
                {" · "}
                <bdi>{offering.teacherName}</bdi>
              </>
            ) : (
              " · معلم هنوز مشخص نشده"
            )}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-primary-800">
            <CalendarClock className="size-4 shrink-0 text-sky-strong" aria-hidden />
            {nextSession ? (
              <span>
                جلسهٴ بعدی: <bdi>{formatSessionFa(nextSession)}</bdi>
              </span>
            ) : (
              <span className="text-text-muted">هنوز در برنامهٴ هفتگی نیست</span>
            )}
          </p>
        </div>
      </header>

      {sessions.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="جلسه‌های هفته">
          {sessions.map((s) => (
            <li key={`${s.weekday}-${s.periodNo}`} className={cn("rounded-full border px-3 py-1 text-xs", nextSession && nextSession.weekday === s.weekday && nextSession.periodNo === s.periodNo ? "border-info bg-info-soft text-primary-800" : "border-line bg-surface text-text-muted")}>
              {WEEKDAY_LABELS[s.weekday]}{" "}
              <bdi dir="ltr" className="tabular">
                {formatTimeRangeFa(s.startsAt, s.endsAt)}
              </bdi>
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id="items-heading" className="px-1 text-sm font-semibold text-text-muted">
            کارهای این درس
          </h3>
          {viewer.canCreate ? (
            <Button asChild size="sm">
              <Link href={`/inbox/new?offering=${offering.id}`}>
                <Plus aria-hidden />
                کار جدید برای این درس
              </Link>
            </Button>
          ) : null}
        </div>
        <nav aria-label="وضعیت کارها">
          <ul className="grid grid-cols-2 gap-1 rounded-2xl bg-neutral-200/60 p-1">
            {TABS.map(({ tab: t, label, icon: Icon }) => {
              const current = tab === t;
              const count = tabCounts[t];
              return (
                <li key={t}>
                  <Link
                    href={t === "todo" ? `/subjects/${offering.id}` : `/subjects/${offering.id}?tab=${t}`}
                    aria-current={current ? "page" : undefined}
                    className={cn("pressable flex h-11 items-center justify-center gap-1.5 rounded-xl px-1 text-sm", current ? "bg-surface font-semibold text-primary-800 shadow-1" : "text-text-muted hover:text-text")}
                  >
                    <Icon className={cn("size-4 shrink-0", current ? "text-primary-600" : "text-text-faint")} strokeWidth={1.75} aria-hidden />
                    {label}
                    {count > 0 ? <span className={cn("tabular rounded-full px-1.5 text-xs leading-5", current ? "bg-info-soft text-primary-800" : "bg-surface/70 text-text-muted")}>{formatNumberFa(count)}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {rows.length === 0 ? (
          <EmptyState
            illustration={<EmptyClay size={96} />}
            title={tab === "todo" ? "کاری برای این درس در انتظار نیست" : "هنوز کاری از این درس انجام‌شده علامت نخورده"}
            description={viewer.canCreate && tab === "todo" ? "با «کار جدید برای این درس» تکلیف یا کاری به کلاس بدهید." : undefined}
            className="rounded-card bg-surface shadow-1"
          />
        ) : (
          <ul className="reveal-rows divide-y divide-line/70 rounded-card bg-surface shadow-1">
            {rows.map((row) => (
              <InboxRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
