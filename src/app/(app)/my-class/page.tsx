import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyClassCard, MyClassFacts, MySubjectsList, MyWeek, NoClassYet, myWeekHasSlots } from "@/components/my-class/MyClassParts";
import { tehranNow } from "@/lib/format";
import { schoolWeekOf } from "@/lib/jalali-grid";
import { myClassQuery, myTimetableQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "کلاس من" };

/**
 * «کلاس من»: the class and school, then the weekly timetable — the whole week, today's column tinted, the
 * ringing زنگ live, each session opening its درس — and, under it, the class facts and who teaches what. Two reads
 * (the class card and the timetable), both personal. Every section is a shared part (`MyClassParts`), which the
 * hub layout's own tile pages (`/my-class/info`, `/my-class/timetable`, `/my-class/subjects`) draw one by one.
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
  const hasSlots = myWeekHasSlots(tt);
  const week = schoolWeekOf(tehranNow());

  return (
    <ContentWidth className="reveal-stagger">
      {/* No visible title (owner 2026-09-27): the bottom nav already reads «کلاس من» and the class card under it names
          the class; the title stays for screen readers, and from lg: the context bar (school · year · term · date). */}
      <PageHeader title="کلاس من" hideTitle />

      {cls === null ? (
        <NoClassYet />
      ) : (
        <>
          <MyClassCard cls={cls} />

          <section aria-labelledby="timetable-heading" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h3 id="timetable-heading" className="flex items-center gap-1.5 text-section font-semibold text-text">
                <CalendarDays className="size-4 self-center" strokeWidth={1.75} aria-hidden />
                برنامهٴ هفتگی
              </h3>
              {hasSlots ? <p className="tabular text-meta text-text-muted">{week.label}</p> : null}
            </div>
            <MyWeek tt={tt} week={week} />
          </section>

          <MyClassFacts cls={cls} />

          <section aria-labelledby="teachers-heading" className="flex flex-col gap-2.5">
            <h3 id="teachers-heading" className="px-1 text-section font-semibold text-text">
              درس‌ها و دبیران
            </h3>
            <MySubjectsList teachers={cls.teachers} />
          </section>
        </>
      )}
    </ContentWidth>
  );
}
