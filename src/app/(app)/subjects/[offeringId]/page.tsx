import { CalendarClock, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "@/lib/cn";
import { ClassSwitcher, type SwitcherOffering } from "@/components/classes/ClassSwitcher";
import { EmptyState } from "@/components/EmptyState";
import { getHats } from "@/components/home/home-data";
import { SheetCheckIllustration } from "@/components/illustrations/SheetCheck";
import { SubjectHeroArt } from "@/components/illustrations/SubjectHeroArt";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubjectIcon, SubjectSwatch } from "@/components/SubjectStamp";
import { Button } from "@/components/ui/button";
import { formatJalaliDayOfMonth, formatJalaliShort, formatNumberFa } from "@/lib/format";
import { normalizeName, offeringHue } from "@/lib/subject-stamp";
import { getTeacherHues } from "@/lib/teacher-hues";
import { formatTimeFa, formatTimeRangeFa, sessionWeekDays, WEEKDAY_LABELS } from "@/lib/timetable";
import { offeringPageQuery } from "@/modules/academic/queries";
import { listWorkItemsQuery, openItemsByOfferingQuery } from "@/modules/workspace/queries";
import { WorkItemList } from "@/modules/workspace/ui/WorkItemList";

export const metadata: Metadata = { title: "درس" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const collator = new Intl.Collator("fa", { numeric: true });

type Search = Record<string, string | string[] | undefined>;

/**
 * The subject page (mock class-page-v3, owner 2026-10-07). The HERO is the page's header — the درس's نشان (in a
 * دبیر's own colour of this class, `getTeacherHues`) and name, the illustration slot at the end (`SubjectHeroArt`),
 * for a دبیر the class switcher «■ کلاس ۱۲/۳ ▾» and «تکلیف جدید برای این درس»; for anyone else «کلاس X · دبیر: Y».
 * Then the schedule card — «جلسهٴ بعدی» and one cell per class day, the next one highlighted — and «تکالیف این درس»
 * as ONE list (`WorkItemList`): the caller's own inbox rows of this درس, open first, finished under «انجام‌شده‌ها».
 * `PageHeader` stays for the back pill and the assistive-tech title (visually hidden: the hero says it). An old
 * `?tab=` link is ignored.
 */
export default async function SubjectPage({ params, searchParams }: { params: Promise<{ offeringId: string }>; searchParams: Promise<Search> }) {
  const { offeringId } = await params;
  if (!UUID_RE.test(offeringId)) notFound();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);
  const allDone = one("done") === "all";
  const cursor = one("cursor") || undefined;
  const page = await offeringPageQuery({ offeringId });
  if (!page.ok) {
    if (page.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { offering, sessions, nextSession, viewer } = page.data;
  const items = await listWorkItemsQuery({ offeringId, allDone, cursor });
  const open = items.ok ? items.data.open : [];
  const done = items.ok ? items.data.done : [];
  const counts = items.ok ? items.data.counts : { todo: 0, done: 0 };
  const nextCursor = items.ok ? items.data.nextCursor : null;
  const hues = await getTeacherHues();
  const hue = offeringHue(hues, offering.id, offering.subjectId);
  const now = new Date();

  // A دبیر's classes for the switcher: every class they teach, its own colour and how much is open in it.
  let classes: SwitcherOffering[] = [];
  let studentCount: number | null = null;
  if (viewer.isTeacher) {
    const hats = await getHats();
    const taught = hats?.teachingOfferings ?? [];
    const openCounts = taught.length > 1 ? await openItemsByOfferingQuery() : null;
    studentCount = taught.find((o) => o.offeringId === offering.id)?.activeStudents ?? null;
    classes = taught
      .map((o) => ({
        offeringId: o.offeringId,
        subjectId: o.subjectId,
        subjectName: o.subjectName,
        classGroupName: o.classGroupName,
        hue: offeringHue(hues, o.offeringId, o.subjectId),
        openCount: openCounts?.ok ? (openCounts.data[o.offeringId] ?? 0) : 0,
      }))
      .sort((a, b) => collator.compare(normalizeName(a.subjectName), normalizeName(b.subjectName)) || collator.compare(normalizeName(a.classGroupName), normalizeName(b.classGroupName)));
  }
  const otherClasses = classes.filter((c) => c.offeringId !== offering.id).length;
  const canSwitch = classes.length > 1 && classes.some((c) => c.offeringId === offering.id);

  const meta = viewer.isTeacher
    ? [studentCount !== null ? `${formatNumberFa(studentCount)} دانش‌آموز` : null, otherClasses > 0 ? `${formatNumberFa(otherClasses)} کلاس دیگر` : null].filter(Boolean).join(" · ")
    : null;

  const days = sessionWeekDays(sessions, nextSession, now);
  const nextDay = days.find((d) => d.isNext);
  const total = counts.todo + counts.done;
  const moreDone = !allDone && !nextCursor && counts.done > done.length;

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader back={{ href: "/home", label: "خانه" }} title={offering.subjectName} hideTitle />

      <section aria-label={`درس ${offering.subjectName}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 overflow-hidden rounded-hero bg-surface p-4 shadow-1 lg:p-6">
        <div className="flex min-w-0 flex-col items-start gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SubjectIcon subjectId={offering.subjectId} name={offering.subjectName} size="lg" hue={hue} />
            {/* The name is the page's title — `PageHeader` carries it for assistive tech, so it is not read twice. */}
            <p className="min-w-0 truncate text-title font-extrabold text-text lg:text-display" aria-hidden>
              <bdi>{offering.subjectName}</bdi>
            </p>
          </div>
          {canSwitch ? (
            <ClassSwitcher currentId={offering.id} offerings={classes} />
          ) : viewer.isTeacher ? (
            <p className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text">
              <SubjectSwatch subjectId={offering.subjectId} hue={hue} />
              <span>
                کلاس <bdi>{offering.classGroupName}</bdi>
              </span>
            </p>
          ) : null}
          {viewer.isTeacher && !meta ? null : (
            <p className="text-meta text-text-muted">
              {viewer.isTeacher ? (
                meta
              ) : (
                <>
                  کلاس <bdi>{offering.classGroupName}</bdi>
                  {" · "}
                  {offering.teacherName ? (
                    <>
                      دبیر: <bdi>{offering.teacherName}</bdi>
                    </>
                  ) : (
                    "دبیر هنوز مشخص نشده"
                  )}
                </>
              )}
            </p>
          )}
        </div>
        <SubjectHeroArt subjectName={offering.subjectName} subjectId={offering.subjectId} className="-me-2 size-28 lg:size-36" />
        {viewer.canCreate ? (
          <Button asChild className="col-span-2 mt-4 w-full sm:w-auto sm:justify-self-start">
            <Link href={`/inbox/new?offering=${offering.id}`}>
              <Plus aria-hidden />
              تکلیف جدید برای این درس
            </Link>
          </Button>
        ) : null}
      </section>

      <section aria-label="جلسه‌های درس" className="surface-work flex flex-col gap-3 p-3.5 lg:p-5">
        <p className="flex items-start gap-2 text-sm text-primary-800">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-sky-strong" strokeWidth={1.75} aria-hidden />
          {nextSession ? (
            <span>
              جلسهٴ بعدی:{" "}
              <span className="font-bold">
                {nextSession.daysAhead === 0 ? "امروز" : nextSession.daysAhead === 1 ? "فردا" : WEEKDAY_LABELS[nextSession.weekday]}
                {nextDay ? ` ${formatJalaliShort(nextDay.at, now)}` : null}
              </span>
              {" · "}
              {nextSession.label}{" "}
              <bdi dir="ltr" className="tabular whitespace-nowrap">
                {formatTimeRangeFa(nextSession.startsAt, nextSession.endsAt)}
              </bdi>
            </span>
          ) : (
            <span className="text-text-muted">هنوز در برنامهٴ هفتگی نیست</span>
          )}
        </p>
        {days.length > 0 ? (
          <ul className="flex gap-2 overflow-x-auto" aria-label="روزهای کلاس">
            {days.map((d) => (
              <li
                key={d.weekday}
                aria-current={d.isNext ? "date" : undefined}
                className={cn(
                  "flex min-w-18 flex-1 basis-0 flex-col items-center rounded-lg px-1 py-2 text-center text-meta",
                  d.isNext ? "bg-info-soft text-primary-800 ring-2 ring-info ring-inset" : "bg-surface-sunken text-text-muted",
                )}
              >
                <span>{WEEKDAY_LABELS[d.weekday]}</span>
                <span className={cn("tabular text-row font-bold", d.isNext ? "text-primary-700" : "text-text")}>{formatJalaliDayOfMonth(d.at)}</span>
                {d.sessions.map((s) => (
                  <bdi key={s.periodNo} dir="ltr" className="tabular">
                    {formatTimeFa(s.startsAt)}–<wbr />
                    {formatTimeFa(s.endsAt)}
                  </bdi>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <h3 id="items-heading" className="text-section font-semibold text-text">
            تکالیف این درس
          </h3>
          {total > 0 ? <span className="tabular rounded-full bg-surface px-2.5 text-meta text-text-muted shadow-1">{formatNumberFa(total)} تکلیف</span> : null}
        </div>
        {open.length === 0 && done.length === 0 ? (
          <EmptyState
            illustration={<SheetCheckIllustration />}
            title="تکلیفی برای این درس در انتظار نیست"
            description={
              viewer.canCreate
                ? "با «تکلیف جدید برای این درس» به کلاس تکلیف بدهید."
                : viewer.isStudent
                  ? `وقتی دبیر ${offering.subjectName} تکلیف بدهد، اینجا و در اعلان‌ها می‌بینید.`
                  : undefined
            }
            className="surface-work py-8"
          />
        ) : (
          <WorkItemList open={open} done={done} openEmpty="تکلیفی برای این درس در انتظار نیست" rowProps={{ inSubject: true, mark: false, chevron: true, hues }} />
        )}
        {nextCursor || cursor || moreDone ? (
          <div className="flex flex-wrap items-center justify-center gap-3 py-2">
            {cursor ? (
              <Button asChild variant="ghost">
                <Link href={`/subjects/${offering.id}`}>بازگشت به ابتدا</Link>
              </Button>
            ) : null}
            {nextCursor ? (
              <Button asChild variant="outline">
                <Link href={`/subjects/${offering.id}?cursor=${encodeURIComponent(nextCursor)}`}>نمایش بیشتر</Link>
              </Button>
            ) : null}
            {moreDone ? (
              <Button asChild variant="outline">
                <Link href={`/subjects/${offering.id}?done=all`}>نمایش همهٴ انجام‌شده‌ها</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </ContentWidth>
  );
}
