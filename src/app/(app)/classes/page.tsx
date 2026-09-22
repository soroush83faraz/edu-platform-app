import { ArrowRight, CalendarDays, Plus, Presentation } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { IconChip } from "@/components/IconChip";
import { BookClay } from "@/components/illustrations";
import { TimetableView } from "@/components/timetable/TimetableView";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/ctx";
import { formatNumberFa } from "@/lib/format";
import { myTimetableQuery } from "@/modules/academic/queries";
import { canAtAnyScope } from "@/modules/iam/can";
import { hatsQuery } from "@/modules/iam/hats";

export const metadata: Metadata = { title: "کلاس‌های من | سامانهٴ مدرسه" };

/**
 * «کلاس‌های من» for a teacher: first «برنامهٴ هفتگی من» — the teaching sessions across classes with today
 * selected — then one card per offering (درس, کلاس, students, open items I gave that class), each opening the
 * subject page. Reads the same `hatsQuery` as Home plus the personal timetable.
 */
export default async function ClassesPage() {
  const hats = await hatsQuery();
  if (!hats.ok) {
    if (hats.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس‌ها در دسترس نیست" description={hats.message} />;
  }
  // A student who lands here (typed URL, old link) belongs on «کلاس من»; «کار جدید» only for people who may create.
  if (hats.data.isStudent && hats.data.teachingOfferings.length === 0) redirect("/my-class");
  const ctx = await requireContext();
  const canCreate = canAtAnyScope(ctx.assignments, "workspace.work_item.create");
  const offerings = hats.data.teachingOfferings;
  const timetable = offerings.length > 0 ? await myTimetableQuery() : null;
  const tt = timetable?.ok ? timetable.data : null;
  const teaching = tt?.teacher ?? null;
  // A teacher's classes may sit in different schools: the period rows of the week table come from the sessions themselves.
  const periods = teaching
    ? [...new Map(teaching.days.flatMap((d) => d.sessions).map((s) => [s.periodNo, { periodNo: s.periodNo, label: s.label, startsAt: s.startsAt, endsAt: s.endsAt }])).values()].sort((a, b) => a.periodNo - b.periodNo)
    : [];
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-8 md:pt-6">
      <Link href="/home" className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
        <ArrowRight className="size-4" aria-hidden />
        خانه
      </Link>
      <div className="flex items-center gap-3">
        <IconChip icon={Presentation} size="lg" />
        <div className="flex flex-col">
          <h2 className="text-xl font-bold leading-8 text-text">کلاس‌های من</h2>
          <p className="text-sm text-text-muted">{offerings.length > 0 ? `${formatNumberFa(offerings.length)} درس در این سال` : "درسی به شما سپرده نشده"}</p>
        </div>
        {canCreate ? (
          <Button asChild className="ms-auto shrink-0">
            <Link href="/inbox/new">
              <Plus aria-hidden />
              کار جدید
            </Link>
          </Button>
        ) : null}
      </div>

      {offerings.length > 0 ? (
        <section aria-labelledby="my-timetable-heading" className="flex flex-col gap-2.5">
          <h3 id="my-timetable-heading" className="flex items-center gap-1.5 px-1 text-sm font-semibold text-text-muted">
            <CalendarDays className="size-4" strokeWidth={1.75} aria-hidden />
            برنامهٴ هفتگی من
          </h3>
          {teaching && tt ? (
            <TimetableView
              days={teaching.days}
              periods={periods}
              today={tt.today}
              nowMinutes={tt.nowMinutes}
              currentPeriodNo={tt.currentPeriodNo}
              secondary="class"
              emptyTitle="این روز کلاسی ندارید"
              emptyDescription="روز دیگری را انتخاب کنید یا «کل هفته» را ببینید."
            />
          ) : (
            <EmptyState title="برنامهٴ هفتگی هنوز تنظیم نشده" description="وقتی مدرسه برنامهٴ کلاس‌ها را ثبت کند، زنگ‌های شما همین‌جا می‌آیند." className="rounded-card bg-surface py-10 shadow-1" />
          )}
        </section>
      ) : null}

      {offerings.length === 0 ? (
        <EmptyState illustration={<BookClay size={112} />} title="هنوز درسی به شما سپرده نشده" description="وقتی مدیر درسی را به شما بدهد، کلاس‌ها همین‌جا می‌آیند." />
      ) : (
        <section aria-labelledby="offerings-heading" className="flex flex-col gap-2.5">
        <h3 id="offerings-heading" className="flex items-center gap-1.5 px-1 text-sm font-semibold text-text-muted">
          <Presentation className="size-4" strokeWidth={1.75} aria-hidden />
          درس‌های من
        </h3>
        <ul className="reveal-grid grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {offerings.map((o) => (
            <li key={o.offeringId} className="flex">
              <Link href={`/subjects/${o.offeringId}`} className="pressable flex w-full flex-col gap-3 rounded-card bg-surface p-4 shadow-1 hover:bg-info-soft/40">
                <div className="flex flex-col">
                  <span className="truncate text-base font-semibold text-text">
                    <bdi>{o.subjectName}</bdi>
                  </span>
                  <span className="text-sm text-text-muted">
                    کلاس <bdi>{o.classGroupName}</bdi>
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-text-muted">
                    <span className="tabular font-medium text-text">{formatNumberFa(o.activeStudents)}</span> دانش‌آموز
                  </span>
                  <span className={cn("tabular rounded-full px-2 py-0.5 font-medium", o.openItems > 0 ? "bg-info-soft text-primary-800" : "bg-surface-sunken text-text-muted")}>
                    {formatNumberFa(o.openItems)} کار باز
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        </section>
      )}
    </div>
  );
}
