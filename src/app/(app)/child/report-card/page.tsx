import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ChildPageHeader, ChildSwitcher } from "@/components/guardian/ChildParts";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { monthParam, ratingSummaryFa } from "@/lib/objective-rating";
import { CardSubject, MonthNav, gradeLabelFa, noObjectivesFa } from "@/modules/academic/ui/ReportCardParts";
import { childHref, childParam } from "@/modules/iam/guardian-policy";
import { childReportCardQuery } from "@/modules/iam/guardian-queries";

export const metadata: Metadata = { title: "کارنامهٴ فرزند" };

/** «کارنامه» of a primary child (a guardian): «کارنامهٴ من»'s card — the month switcher, each درس and its levels. */
export default async function ChildReportCardPage({ searchParams }: { searchParams: Promise<{ child?: string | string[]; month?: string | string[] }> }) {
  const sp = await searchParams;
  const res = await childReportCardQuery({ child: childParam(sp.child), month: monthParam(typeof sp.month === "string" ? sp.month : undefined) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { children, child, card } = res.data;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <ChildPageHeader title="کارنامه" child={child} extra={card && card.month !== null ? <>ماه {card.monthName}</> : undefined} />
      <ChildSwitcher items={children} current={child.studentProfileId} page="report-card" />
      {!card ? (
        <EmptyState title={`کارنامهٴ توصیفی برای کلاس ${child.firstName} ثبت نمی‌شود`} description="کارنامهٴ توصیفی برای دانش‌آموزان پایهٴ اول تا ششم دبستان است." className="surface-work" />
      ) : (
        <>
          <MonthNav months={card.months} current={card.month} hrefFor={(m) => childHref("report-card", child.studentProfileId, { month: m })} />
          {card.subjects.length === 0 ? (
            <EmptyState title={noObjectivesFa(card.classGroup.gradeName, card.month)} className="surface-work" />
          ) : (
            <>
              <p className="px-1 text-meta text-text-muted">
                {gradeLabelFa(card.classGroup.gradeName)} · {ratingSummaryFa(card.counts) || `آموزگار هنوز کارنامهٴ ماه ${card.monthName} را ثبت نکرده است.`}
              </p>
              {card.subjects.map((s) => (
                <CardSubject key={s.name} subject={s} />
              ))}
            </>
          )}
        </>
      )}
    </ContentWidth>
  );
}
