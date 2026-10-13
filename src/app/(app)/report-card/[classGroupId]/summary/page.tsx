import { Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { OBJECTIVE_RATINGS, RATING_LABELS, monthParam } from "@/lib/objective-rating";
import { classReportQuery } from "@/modules/academic/queries";
import { MonthNav, RatingPill, gradeLabelFa, noObjectivesFa } from "@/modules/academic/ui/ReportCardParts";

export const metadata: Metadata = { title: "کارنامهٴ کلاس" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «کارنامهٴ کلاس»: every student of the class in one month — how many objectives at each level, how many not rated
 * yet — with each student's printable card one tap away. Phones: one card per student; from `lg:` a table.
 */
export default async function ClassSummaryPage({ params, searchParams }: { params: Promise<{ classGroupId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { classGroupId } = await params;
  if (!UUID_RE.test(classGroupId)) notFound();
  const res = await classReportQuery({ classGroupId, month: monthParam((await searchParams).month) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const d = res.data;
  const base = `/report-card/${classGroupId}`;
  const printHref = (studentProfileId?: string) => `${base}/print?month=${d.month}${studentProfileId ? `&student=${studentProfileId}` : ""}`;

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        back={{ href: `${base}${d.month !== null ? `?month=${d.month}` : ""}`, label: `کلاس ${d.classGroup.name}` }}
        title="کارنامهٴ کلاس"
        count={d.students.length}
        description={
          <>
            کلاس <bdi>{d.classGroup.name}</bdi> · {gradeLabelFa(d.classGroup.gradeName)}
            {d.month !== null ? (
              <>
                {" "}
                · ماه {d.monthName} · {formatNumberFa(d.objectives)} هدف
              </>
            ) : null}
          </>
        }
        actions={
          d.month !== null && d.students.length > 0 ? (
            <Link
              prefetch={false}
              href={printHref()}
              className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-text hover:bg-surface-sunken"
            >
              <Printer className="size-4" aria-hidden />
              چاپ کارنامه‌ها
            </Link>
          ) : null
        }
      />
      <MonthNav months={d.months} current={d.month} hrefFor={(m) => `${base}/summary?month=${m}`} />

      {d.objectives === 0 ? (
        <EmptyState title={noObjectivesFa(d.classGroup.gradeName, d.month)} className="surface-work" />
      ) : d.students.length === 0 ? (
        <EmptyState title="این کلاس هنوز دانش‌آموز فعالی ندارد" description="اول دانش‌آموزان را در کلاس ثبت‌نام کنید." className="surface-work" />
      ) : (
        <>
          {/* Phones: a card per student. */}
          <ul className="reveal-rows surface-work divide-y divide-line/70 overflow-hidden lg:hidden">
            {d.students.map((s) => {
              const levels = OBJECTIVE_RATINGS.filter((r) => s.counts[r] > 0);
              return (
                <li key={s.studentProfileId} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-row font-medium text-text">
                      <bdi>{s.fullName}</bdi>
                    </p>
                    <Link
                      prefetch={false}
                      href={printHref(s.studentProfileId)}
                      className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-meta text-primary-700 hover:bg-surface-sunken"
                    >
                      <Printer className="size-4" aria-hidden />
                      چاپ کارنامه
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {levels.map((r) => (
                      <RatingPill key={r} rating={r} label={`${formatNumberFa(s.counts[r])} ${RATING_LABELS[r]}`} />
                    ))}
                    {levels.length === 0 ? <span className="text-meta text-text-muted">هنوز سطحی ثبت نشده</span> : null}
                    {levels.length > 0 && s.missing > 0 ? <span className="text-meta text-text-muted">{formatNumberFa(s.missing)} هدف ثبت نشده</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: one table. */}
          <div className="surface-work hidden overflow-hidden lg:block">
            <table className="w-full text-row">
              <thead>
                <tr className="border-b border-line text-meta text-text-muted">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    دانش‌آموز
                  </th>
                  {OBJECTIVE_RATINGS.map((r) => (
                    <th key={r} scope="col" className="px-3 py-2 text-center font-medium">
                      {RATING_LABELS[r]}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-center font-medium">
                    ثبت نشده
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">چاپ</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {d.students.map((s) => (
                  <tr key={s.studentProfileId} className="hover:bg-surface-sunken">
                    <td className="px-4 py-2">
                      <bdi className="font-medium">{s.fullName}</bdi>
                      {s.studentNumber ? (
                        <bdi dir="ltr" className="tabular ms-2 text-meta text-text-faint">
                          {toFaDigits(s.studentNumber)}
                        </bdi>
                      ) : null}
                    </td>
                    {OBJECTIVE_RATINGS.map((r) => (
                      <td key={r} className="tabular px-3 py-2 text-center">
                        {s.counts[r] > 0 ? formatNumberFa(s.counts[r]) : <span className="text-text-faint">—</span>}
                      </td>
                    ))}
                    <td className="tabular px-3 py-2 text-center text-text-muted">{s.missing > 0 ? formatNumberFa(s.missing) : "—"}</td>
                    <td className="px-4 py-1 text-end">
                      <Link prefetch={false} href={printHref(s.studentProfileId)} className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-meta text-primary-700 hover:bg-surface">
                        <Printer className="size-4" aria-hidden />
                        چاپ کارنامه
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ContentWidth>
  );
}
