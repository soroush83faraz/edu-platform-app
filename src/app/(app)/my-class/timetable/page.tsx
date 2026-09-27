import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyWeek, NoClassYet, myWeekHasSlots } from "@/components/my-class/MyClassParts";
import { tehranNow } from "@/lib/format";
import { schoolWeekOf } from "@/lib/jalali-grid";
import { myTimetableQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "برنامهٴ هفتگی" };

/**
 * The student's week on its own page — the hub layout's «برنامهٴ هفتگی» Home tile (docs/decisions-pending/
 * home-hub-tiles.md). The same section as «کلاس من» (`MyWeek`), the same read; the full page stays as it is.
 */
export default async function MyWeekPage() {
  const result = await myTimetableQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="برنامهٴ هفتگی در دسترس نیست" description={result.message} />;
  }
  const tt = result.data;
  const week = schoolWeekOf(tehranNow());
  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader title="برنامهٴ هفتگی" description={myWeekHasSlots(tt) ? <span className="tabular">{week.label}</span> : undefined} back={{ href: "/home", label: "خانه" }} />
      {tt.student === null ? <NoClassYet /> : <MyWeek tt={tt} week={week} />}
    </ContentWidth>
  );
}
