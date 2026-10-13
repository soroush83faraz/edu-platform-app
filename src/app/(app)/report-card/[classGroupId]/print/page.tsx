import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/admin/PrintButton";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatNumberFa } from "@/lib/format";
import { monthParam } from "@/lib/objective-rating";
import { classReportCardsQuery } from "@/modules/academic/queries";
import { PrintableCard } from "@/modules/academic/ui/ReportCardParts";

export const metadata: Metadata = { title: "چاپ کارنامهٴ توصیفی" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «چاپ کارنامه»: the A4 RTL report card of every student of the class for a month (`?month=`), or of one
 * (`&student=`) — one card per printed page (print CSS in globals.css; the app frame disappears in print).
 */
export default async function PrintReportCardsPage({ params, searchParams }: { params: Promise<{ classGroupId: string }>; searchParams: Promise<{ month?: string; student?: string }> }) {
  const { classGroupId } = await params;
  if (!UUID_RE.test(classGroupId)) notFound();
  const sp = await searchParams;
  const month = monthParam(sp.month);
  if (month === undefined) redirect(`/report-card/${classGroupId}`);
  const studentProfileId = sp.student && UUID_RE.test(sp.student) ? sp.student : undefined;
  const res = await classReportCardsQuery({ classGroupId, month, studentProfileId });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const d = res.data;
  const one = studentProfileId ? d.cards[0] : null;

  return (
    <ContentWidth size="reading" className="gap-4">
      <div className="no-print flex flex-col gap-3">
        <PageHeader
          back={{ href: `/report-card/${classGroupId}/summary?month=${month}`, label: "کارنامهٴ کلاس" }}
          title={one ? <bdi>{one.fullName}</bdi> : "چاپ کارنامه‌ها"}
          description={
            <>
              کلاس <bdi>{d.classGroup.name}</bdi> · ماه {d.monthName}
              {one ? null : <> · {formatNumberFa(d.cards.length)} کارنامه، هر کدام در یک صفحه</>}
            </>
          }
          actions={d.cards.length > 0 ? <PrintButton /> : null}
        />
      </div>
      {d.cards.length === 0 ? <EmptyState title="این کلاس هنوز دانش‌آموز فعالی ندارد" className="surface-work" /> : null}
      {d.cards.map((card) => (
        <PrintableCard key={card.studentProfileId} card={card} />
      ))}
    </ContentWidth>
  );
}
