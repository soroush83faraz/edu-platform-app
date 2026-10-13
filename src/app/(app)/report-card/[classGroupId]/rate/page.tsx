import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { SubjectIcon } from "@/components/SubjectStamp";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatJalaliDateTime, formatNumberFa } from "@/lib/format";
import { monthParam } from "@/lib/objective-rating";
import { ratingSheetQuery } from "@/modules/academic/queries";
import { RatingRoster } from "@/modules/academic/ui/RatingRoster";
import { gradeLabelFa, noObjectivesFa } from "@/modules/academic/ui/ReportCardParts";

export const metadata: Metadata = { title: "ثبت کارنامهٴ توصیفی" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «ثبت کارنامه» of one class × month × درس (`?month=&subject=`): the درس, the month and the class in the header, the
 * last save above the roster, then the roster with its sticky save bar. Out of scope = NOT_FOUND.
 */
export default async function RateSheetPage({ params, searchParams }: { params: Promise<{ classGroupId: string }>; searchParams: Promise<{ month?: string; subject?: string }> }) {
  const { classGroupId } = await params;
  if (!UUID_RE.test(classGroupId)) notFound();
  const sp = await searchParams;
  const month = monthParam(sp.month);
  const subjectName = sp.subject?.trim();
  if (month === undefined || !subjectName) redirect(`/report-card/${classGroupId}`);
  const res = await ratingSheetQuery({ classGroupId, month, subjectName });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const d = res.data;

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        back={{ href: `/report-card/${classGroupId}?month=${month}`, label: `کلاس ${d.classGroup.name}` }}
        title={
          <span className="flex items-center gap-3">
            <SubjectIcon subjectId={d.subjectId ?? d.subjectName} name={d.subjectName} size="lg" />
            <span>{d.subjectName}</span>
          </span>
        }
        description={
          <>
            ماه {d.monthName} · کلاس <bdi>{d.classGroup.name}</bdi> · {gradeLabelFa(d.classGroup.gradeName)} · {formatNumberFa(d.objectives.length)} هدف
          </>
        }
      />
      {d.saved ? (
        <p className="rounded-card bg-info-soft px-4 py-2.5 text-meta text-primary-800">
          آخرین ثبت در <span className="tabular">{formatJalaliDateTime(d.saved.at)}</span>
          {d.saved.byName ? (
            <>
              {" "}
              به‌دست <bdi>{d.saved.byName}</bdi>
            </>
          ) : null}
          {d.canWrite ? " — می‌توانید تغییر دهید." : null}
        </p>
      ) : null}
      {d.objectives.length === 0 ? (
        <EmptyState title={noObjectivesFa(d.classGroup.gradeName, d.month)} description={`درس «${d.subjectName}» در این ماه هدفی ندارد.`} className="surface-work" />
      ) : (
        <RatingRoster data={d} />
      )}
    </ContentWidth>
  );
}
