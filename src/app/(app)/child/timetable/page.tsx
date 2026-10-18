import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ChildPageHeader, ChildSwitcher } from "@/components/guardian/ChildParts";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { MyWeek, myWeekHasSlots } from "@/components/my-class/MyClassParts";
import { tehranNow } from "@/lib/format";
import { schoolWeekOf } from "@/lib/jalali-grid";
import { childParam } from "@/modules/iam/guardian-policy";
import { childTimetableQuery } from "@/modules/iam/guardian-queries";

export const metadata: Metadata = { title: "برنامهٴ کلاسی فرزند" };

/** «برنامهٴ کلاسی» of a child (a guardian): the child's class week — the student's own week component. */
export default async function ChildTimetablePage({ searchParams }: { searchParams: Promise<{ child?: string | string[] }> }) {
  const res = await childTimetableQuery({ child: childParam((await searchParams).child) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { children, child, timetable } = res.data;
  const week = schoolWeekOf(tehranNow());
  return (
    <ContentWidth className="reveal-stagger">
      <ChildPageHeader title="برنامهٴ کلاسی" child={child} extra={myWeekHasSlots(timetable) ? <span className="tabular">{week.label}</span> : undefined} />
      <ChildSwitcher items={children} current={child.studentProfileId} page="timetable" />
      {timetable.student === null ? (
        <EmptyState title={`${child.firstName} هنوز در کلاسی ثبت نشده است`} description="وقتی مدرسه او را در کلاسی ثبت کند، برنامهٴ هفتگی همین‌جا می‌آید." className="surface-work" />
      ) : (
        <MyWeek tt={timetable} week={week} />
      )}
    </ContentWidth>
  );
}
