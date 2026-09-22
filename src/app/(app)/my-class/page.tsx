import { BookOpen, CalendarDays, School, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { IconChip } from "@/components/IconChip";
import { SchoolClay } from "@/components/illustrations";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { WeekTimetable } from "@/components/timetable/WeekTimetable";
import { formatNumberFa } from "@/lib/format";
import { myClassQuery, myTimetableQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "کلاس من | سامانهٴ مدرسه" };

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

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        title="کلاس من"
        description={
          cls ? (
            <>
              <bdi>{cls.schoolName}</bdi> · کلاس <bdi>{cls.classGroupName}</bdi>
            </>
          ) : undefined
        }
      />

      {cls === null ? (
        <EmptyState illustration={<SchoolClay size={112} />} title="هنوز در کلاسی ثبت نشده‌اید" description="وقتی مدرسه شما را در کلاس ثبت کند، همین‌جا می‌بینید." />
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
            <h3 id="timetable-heading" className="flex items-center gap-1.5 px-1 text-sm font-semibold text-text-muted">
              <CalendarDays className="size-4" strokeWidth={1.75} aria-hidden />
              برنامهٴ هفتگی
            </h3>
            {student && tt && hasSlots ? (
              <WeekTimetable days={student.days} periods={student.periods} today={tt.today} currentPeriodNo={tt.currentPeriodNo} secondary="teacher" />
            ) : (
              <EmptyState
                title="برنامهٴ هفتگی هنوز تنظیم نشده"
                description="وقتی مدرسه برنامهٴ کلاس را ثبت کند، زنگ‌های هر روز همین‌جا می‌آیند."
                className="rounded-card bg-surface py-10 shadow-1"
              />
            )}
          </section>

          <Card>
            <dl className="grid grid-cols-2 divide-x divide-line/70">
              <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
                <IconChip icon={Users} size="lg" />
                <dt className="text-xs text-text-muted">هم‌کلاسی‌ها</dt>
                <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.classmates)}</dd>
              </div>
              <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
                <IconChip icon={BookOpen} size="lg" tone="sky" />
                <dt className="text-xs text-text-muted">درس‌ها</dt>
                <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.teachers.length)}</dd>
              </div>
            </dl>
          </Card>

          <section aria-labelledby="teachers-heading" className="flex flex-col gap-2.5">
            <h3 id="teachers-heading" className="px-1 text-sm font-semibold text-text-muted">
              درس‌ها و معلم‌ها
            </h3>
            <Card>
              {cls.teachers.length === 0 ? (
                <p className="px-4 py-5 text-sm text-text-muted">هنوز درسی برای این کلاس تعریف نشده.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {cls.teachers.map((t) => (
                    <li key={t.offeringId}>
                      <Link href={`/subjects/${t.offeringId}`} className="pressable flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                        <IconChip icon={School} size="sm" tone={t.teacherName ? "primary" : "muted"} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="truncate text-sm font-medium text-text">
                            <bdi>{t.subjectName}</bdi>
                          </p>
                          <p className="truncate text-xs text-text-muted">{t.teacherName ? <bdi>{t.teacherName}</bdi> : "معلم هنوز مشخص نشده"}</p>
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
