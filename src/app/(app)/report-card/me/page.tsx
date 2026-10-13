import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { monthParam, ratingSummaryFa } from "@/lib/objective-rating";
import { myReportCardQuery } from "@/modules/academic/queries";
import { CardSubject, MonthNav, gradeLabelFa, noObjectivesFa } from "@/modules/academic/ui/ReportCardParts";

export const metadata: Metadata = { title: "کارنامهٴ من" };

/**
 * «کارنامهٴ من» — a primary student's own descriptive report card: the month switcher, then each درس with its
 * objectives and the level the آموزگار gave (a pill; «ثبت نشده» until then). Read-only.
 */
export default async function MyReportCardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const res = await myReportCardQuery({ month: monthParam((await searchParams).month) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
  }
  const card = res.ok ? res.data : null;

  if (!card) {
    return (
      <ContentWidth>
        <PageHeader title="کارنامهٴ من" />
        <EmptyState title="کارنامهٴ توصیفی برای کلاس شما ثبت نمی‌شود" description="کارنامهٴ توصیفی برای دانش‌آموزان پایهٴ اول تا ششم دبستان است." />
      </ContentWidth>
    );
  }
  const summary = ratingSummaryFa(card.counts);

  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <PageHeader
        title="کارنامهٴ من"
        description={
          <>
            {card.month !== null ? <>ماه {card.monthName} · </> : null}
            {gradeLabelFa(card.classGroup.gradeName)} · کلاس <bdi>{card.classGroup.name}</bdi>
          </>
        }
      />
      <MonthNav months={card.months} current={card.month} hrefFor={(m) => `/report-card/me?month=${m}`} />
      {card.subjects.length === 0 ? (
        <EmptyState title={noObjectivesFa(card.classGroup.gradeName, card.month)} className="surface-work" />
      ) : (
        <>
          <p className="px-1 text-meta text-text-muted">{summary ? summary : `آموزگار هنوز کارنامهٴ ماه ${card.monthName} را ثبت نکرده است.`}</p>
          {card.subjects.map((s) => (
            <CardSubject key={s.name} subject={s} />
          ))}
        </>
      )}
    </ContentWidth>
  );
}
