import { BookOpen, CalendarDays, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { SubjectIcon } from "@/components/SubjectStamp";
import { SchoolClay } from "@/components/illustrations";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { WeekTimetable } from "@/components/timetable/WeekTimetable";
import { formatNumberFa, tehranNow } from "@/lib/format";
import { schoolWeekOf } from "@/lib/jalali-grid";
import { myClassQuery, myTimetableQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "کلاس من" };

/**
 * «کلاس من»: the class and school, then the weekly timetable — the whole week, today's column tinted, the
 * ringing زنگ live, each session opening its درس — and, under it, the class facts and who teaches what. Two reads
 * (the class card and the timetable), both personal.
 */
export default async function MyClassPage() {
  const result = await myClassQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس من در دسترس نیست" description={result.message} />;
  }
  const cls = result.data;
  const timetable = cls ? await myTimetableQuery() : null;
  const tt = timetable?.ok ? timetable.data : null;
  const student = tt?.student ?? null;
  const hasSlots = student ? student.days.some((d) => d.sessions.length > 0) : false;
  const week = schoolWeekOf(tehranNow());

  return (
    <ContentWidth className="reveal-stagger">
      {/* No visible title (owner 2026-09-27): the bottom nav already reads «کلاس من» and the class card under it names
          the class; the title stays for screen readers, and from lg: the context bar (school · year · term · date). */}
      <PageHeader title="کلاس من" hideTitle />

      {cls === null ? (
        <EmptyState title="هنوز در کلاسی ثبت نشده‌ای." description="وقتی مدرسه تو را در کلاسی ثبت کند، برنامه و درس‌هایت همین‌جا می‌آید." />
      ) : (
        <>
          <section aria-label="کلاس" className="flex items-center gap-3 rounded-card bg-info-soft px-4 py-3">
            <SchoolClay size={48} />
            <div className="flex min-w-0 flex-col">
              <h2 className="text-lg font-bold leading-7 text-primary-900">
                کلاس <bdi>{cls.classGroupName}</bdi>
              </h2>
              <p className="truncate text-sm text-primary-800/80">
                <bdi>{cls.schoolName}</bdi>
              </p>
            </div>
          </section>

          <section aria-labelledby="timetable-heading" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h3 id="timetable-heading" className="flex items-center gap-1.5 text-section font-semibold text-text">
                <CalendarDays className="size-4 self-center" strokeWidth={1.75} aria-hidden />
                برنامهٴ هفتگی
              </h3>
              {hasSlots ? <p className="tabular text-meta text-text-muted">{week.label}</p> : null}
            </div>
            {student && tt && hasSlots ? (
              <WeekTimetable days={student.days} periods={student.periods} today={tt.today} nowMinutes={tt.nowMinutes} secondary="teacher" perspective="student" weekDays={week.days} comingWeek={week.comingWeek} />
            ) : (
              <EmptyState
                title="برنامهٴ هفتگی هنوز تنظیم نشده"
                description="وقتی مدرسه برنامهٴ کلاس را ثبت کند، زنگ‌های هر روز همین‌جا می‌آیند."
                className="surface-work py-10"
              />
            )}
          </section>

          <Card>
            <dl className="grid grid-cols-2 divide-x divide-line/70">
              <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
                <RowMark icon={Users} />
                <dt className="text-meta text-text-muted">هم‌کلاسی‌ها</dt>
                <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.classmates)}</dd>
              </div>
              <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
                <RowMark icon={BookOpen} />
                <dt className="text-meta text-text-muted">درس‌ها</dt>
                <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.teachers.length)}</dd>
              </div>
            </dl>
          </Card>

          <section aria-labelledby="teachers-heading" className="flex flex-col gap-2.5">
            <h3 id="teachers-heading" className="px-1 text-section font-semibold text-text">
              درس‌ها و دبیران
            </h3>
            <Card>
              {cls.teachers.length === 0 ? (
                <p className="px-4 py-5 text-sm text-text-muted">هنوز درسی برای این کلاس تعریف نشده؛ وقتی مدرسه درس و دبیر ثبت کند، همین‌جا می‌آید.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {cls.teachers.map((t) => (
                    <li key={t.offeringId}>
                      <Link href={`/subjects/${t.offeringId}`} className="pressable flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                        <SubjectIcon subjectId={t.subjectId} name={t.subjectName} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="truncate text-row font-medium text-text">
                            <bdi>{t.subjectName}</bdi>
                          </p>
                          <p className="truncate text-meta text-text-muted">{t.teacherName ? <bdi>{t.teacherName}</bdi> : "دبیر هنوز مشخص نشده"}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </ContentWidth>
  );
}
