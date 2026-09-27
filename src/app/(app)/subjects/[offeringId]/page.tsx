import { CalendarClock, CircleCheck, ListTodo, type LucideIcon, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import { CrossFade } from "@/components/motion/CrossFade";
import { LeavingList } from "@/components/motion/LeavingList";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { SegmentedLinks } from "@/components/SegmentedLinks";
import { SubjectIcon } from "@/components/SubjectStamp";
import { Button } from "@/components/ui/button";
import { formatNumberFa } from "@/lib/format";
import { formatSessionFa, formatTimeRangeFa, WEEKDAY_LABELS } from "@/lib/timetable";
import { offeringPageQuery } from "@/modules/academic/queries";
import type { InboxTab } from "@/modules/workspace/dto";
import { listInboxQuery } from "@/modules/workspace/queries";
import { InboxRow } from "@/modules/workspace/ui/InboxRow";

export const metadata: Metadata = { title: "درس" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABS: Array<{ tab: Exclude<InboxTab, "all">; label: string; icon: LucideIcon }> = [
  { tab: "todo", label: "انجام‌نشده", icon: ListTodo },
  { tab: "done", label: "انجام‌شده", icon: CircleCheck },
];

/**
 * The subject page: the درس beside its نشان درس (`SubjectIcon`) with its class and teacher, the next session, every session of the week, then the
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
  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        back={{ href: "/home", label: "خانه" }}
        title={
          <span className="flex items-center gap-3">
            <SubjectIcon subjectId={offering.subjectId} name={offering.subjectName} size="lg" />
            <bdi>{offering.subjectName}</bdi>
          </span>
        }
        description={
          <>
            کلاس <bdi>{offering.classGroupName}</bdi>
            {viewer.isTeacher ? null : offering.teacherName ? (
              <>
                {" · "}
                <bdi>{offering.teacherName}</bdi>
              </>
            ) : (
              " · دبیر هنوز مشخص نشده"
            )}
          </>
        }
        actions={
          viewer.canCreate ? (
            <Button asChild>
              <Link href={`/inbox/new?offering=${offering.id}`}>
                <Plus aria-hidden />
                تکلیف جدید برای این درس
              </Link>
            </Button>
          ) : undefined
        }
      />

      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
            <li key={`${s.weekday}-${s.periodNo}`} className={cn("rounded-full border px-3 py-1 text-meta", nextSession && nextSession.weekday === s.weekday && nextSession.periodNo === s.periodNo ? "border-info bg-info-soft text-primary-800" : "border-line bg-surface text-text-muted")}>
              {WEEKDAY_LABELS[s.weekday]}{" "}
              <bdi dir="ltr" className="tabular">
                {formatTimeRangeFa(s.startsAt, s.endsAt)}
              </bdi>
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h3 id="items-heading" className="px-1 text-section font-semibold text-text">
          تکالیف این درس
        </h3>
        <SegmentedLinks
          label="وضعیت تکالیف"
          current={tab}
          items={TABS.map(({ tab: t, label, icon: Icon }) => ({
            key: t,
            href: t === "todo" ? `/subjects/${offering.id}` : `/subjects/${offering.id}?tab=${t}`,
            label,
            icon: <Icon className="size-4" strokeWidth={1.75} aria-hidden />,
            count: { value: tabCounts[t], text: formatNumberFa(tabCounts[t]), label: `${formatNumberFa(tabCounts[t])} تکلیف` },
          }))}
        />
        <CrossFade swapKey={tab}>
        {rows.length === 0 ? (
          <EmptyState
            title={tab === "todo" ? "تکلیفی برای این درس در انتظار نیست" : "هنوز تکلیفی از این درس انجام‌شده علامت نخورده"}
            description={viewer.canCreate && tab === "todo" ? "با «تکلیف جدید برای این درس» به کلاس تکلیف بدهید." : undefined}
            className="surface-work"
          />
        ) : (
          <LeavingList className="reveal-rows divide-y divide-line/70 surface-work" completedFrom={tab === "todo"}>
            {rows.map((row) => (
              <InboxRow key={row.id} row={row} inSubject />
            ))}
          </LeavingList>
        )}
        </CrossFade>
      </section>
    </ContentWidth>
  );
}
