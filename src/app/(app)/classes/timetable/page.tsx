import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoOfferingsYet, TeachingWeek, hasTeachingWeek } from "@/components/classes/ClassesParts";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { tehranNow } from "@/lib/format";
import { schoolWeekOf } from "@/lib/jalali-grid";
import { teacherOfferingHues } from "@/lib/subject-stamp";
import { myTimetableQuery } from "@/modules/academic/queries";
import { hatsQuery } from "@/modules/iam/hats";

export const metadata: Metadata = { title: "برنامهٴ هفتگی" };

/**
 * A teacher's teaching week on its own page — the hub layout's «برنامهٴ هفتگی» Home tile (docs/decisions-pending/
 * home-hub-tiles.md). The same section as «برنامهٴ هفتگی من» on `/classes` (`TeachingWeek`), the same reads.
 */
export default async function TeachingWeekPage() {
  const hats = await hatsQuery();
  if (!hats.ok) {
    if (hats.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="برنامهٴ هفتگی در دسترس نیست" description={hats.message} />;
  }
  // A student who lands here belongs on their own class week, as `/classes` sends them to «کلاس من».
  if (hats.data.isStudent && hats.data.teachingOfferings.length === 0) redirect("/my-class/timetable");
  const offerings = hats.data.teachingOfferings;
  const timetable = offerings.length > 0 ? await myTimetableQuery() : null;
  const tt = timetable?.ok ? timetable.data : null;
  const week = schoolWeekOf(tehranNow());
  return (
    <ContentWidth className="gap-4">
      <PageHeader title="برنامهٴ هفتگی" description={hasTeachingWeek(tt) ? <span className="tabular">{week.label}</span> : undefined} back={{ href: "/home", label: "خانه" }} />
      {offerings.length === 0 ? <NoOfferingsYet /> : <TeachingWeek tt={tt} week={week} hues={teacherOfferingHues(offerings)} />}
    </ContentWidth>
  );
}
