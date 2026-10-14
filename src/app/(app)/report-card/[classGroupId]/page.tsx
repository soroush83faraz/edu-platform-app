import { ChevronLeft, ListChecks, NotebookText, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/Chip";
import { ClayIcon } from "@/components/ClayIcon";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { SubjectIcon } from "@/components/SubjectStamp";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { formatNumberFa } from "@/lib/format";
import { monthParam } from "@/lib/objective-rating";
import { classReportQuery, reportCardClassesQuery } from "@/modules/academic/queries";
import { MonthNav, gradeLabelFa, noObjectivesFa } from "@/modules/academic/ui/ReportCardParts";

export const metadata: Metadata = { title: "کارنامهٴ توصیفی کلاس" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One class's report card for a month: the month switcher, then its درس‌ها — each with how many students are fully
 * rated — leading to the entry roster (read-only, marked «فقط مشاهده», for a درس another teacher of the class
 * teaches), then «کارنامهٴ کلاس» (the per-student summary) and «چاپ کارنامه‌ها». Out of the caller's scope =
 * «چنین صفحه‌ای پیدا نشد» (the service answers NOT_FOUND).
 */
export default async function ClassReportPage({ params, searchParams }: { params: Promise<{ classGroupId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { classGroupId } = await params;
  if (!UUID_RE.test(classGroupId)) notFound();
  const month = monthParam((await searchParams).month);
  const res = await classReportQuery({ classGroupId, month });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const d = res.data;
  const classes = await reportCardClassesQuery();
  const back = classes.ok && classes.data.length > 1 ? { href: "/report-card", label: "کارنامهٴ توصیفی" } : undefined;
  const students = d.students.length;
  const base = `/report-card/${classGroupId}`;

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <ClayIcon icon={NotebookText} size="lg" />
            <span>
              کلاس <bdi>{d.classGroup.name}</bdi>
            </span>
          </span>
        }
        description={
          <>
            کارنامهٴ توصیفی · {gradeLabelFa(d.classGroup.gradeName)} · <bdi>{d.classGroup.schoolName}</bdi>
            {d.month !== null ? <> · ماه {d.monthName}</> : null}
          </>
        }
      />

      <MonthNav months={d.months} current={d.month} hrefFor={(m) => `${base}?month=${m}`} />

      {d.subjects.length === 0 ? (
        <EmptyState title={noObjectivesFa(d.classGroup.gradeName, d.month)} description="هدف‌های آموزشی هر ماه را مدرسه تعیین می‌کند؛ ماه دیگری را انتخاب کنید." className="surface-work" />
      ) : (
        <PageSection title="درس‌ها" id="subjects" count={d.subjects.length} surface="work" flush>
          <ul className="reveal-rows divide-y divide-line/70">
            {d.subjects.map((s) => {
              const done = students > 0 && s.complete === students;
              return (
                <li key={s.name}>
                  <Link
                    prefetch={false}
                    href={`${base}/rate?month=${d.month}&subject=${encodeURIComponent(s.name)}`}
                    className="pressable flex min-h-16 items-center gap-3 px-4 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken"
                  >
                    <SubjectIcon subjectId={s.subjectId ?? s.name} name={s.name} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-row font-medium text-text">{s.name}</span>
                      <span className="truncate text-meta text-text-muted">
                        {formatNumberFa(s.objectives)} هدف · <span className="tabular">{formatNumberFa(s.complete)}</span> از{" "}
                        <span className="tabular">{formatNumberFa(students)}</span> دانش‌آموز ثبت شده
                      </span>
                    </span>
                    {done ? (
                      <Chip tone="success" className="shrink-0">
                        کامل
                      </Chip>
                    ) : null}
                    {/* A teacher writes only the درس‌ها they teach here (and those no offering carries); the rest open read-only. */}
                    {d.canWrite && !s.canWrite ? <Chip className="shrink-0">فقط مشاهده</Chip> : null}
                    <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </PageSection>
      )}

      {d.month !== null && d.subjects.length > 0 ? (
        <ul className="surface-work divide-y divide-line/70 overflow-hidden">
          <li>
            <Link prefetch={false} href={`${base}/summary?month=${d.month}`} className="surface-link pressable flex min-h-14 items-center gap-3 px-4 py-2">
              <RowMark icon={ListChecks} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-row font-medium text-text">کارنامهٴ کلاس</span>
                <span className="text-meta text-text-muted">خلاصهٴ هر دانش‌آموز در ماه {d.monthName}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
          <li>
            <Link prefetch={false} href={`${base}/print?month=${d.month}`} className="surface-link pressable flex min-h-14 items-center gap-3 px-4 py-2">
              <RowMark icon={Printer} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-row font-medium text-text">چاپ کارنامه‌ها</span>
                <span className="text-meta text-text-muted">برگهٴ A4 هر دانش‌آموز، یکی در هر صفحه</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        </ul>
      ) : null}
    </ContentWidth>
  );
}
