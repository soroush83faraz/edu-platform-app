import { CalendarDays, Presentation } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClassesActions, NoOfferingsYet, OfferingsGrid, TeachingWeek, hasTeachingWeek, offeringsSummaryFa } from "@/components/classes/ClassesParts";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { requireContext } from "@/lib/ctx";
import { tehranNow } from "@/lib/format";
import { schoolWeekOf } from "@/lib/jalali-grid";
import { myTimetableQuery } from "@/modules/academic/queries";
import { canAtAnyScope } from "@/modules/iam/can";
import { hatsQuery } from "@/modules/iam/hats";

export const metadata: Metadata = { title: "کلاس‌های من" };

/**
 * «کلاس‌های من» for a teacher: first «برنامهٴ هفتگی من» — the week of teaching sessions across classes, today's
 * column tinted — then one card per offering (درس, کلاس, students, open items I gave that class), each opening the
 * subject page. Reads the same `hatsQuery` as Home plus the personal timetable. Every section is a shared part
 * (`ClassesParts`), which the hub layout's own tile pages (`/classes/offerings`, `/classes/timetable`) draw one by one.
 */
export default async function ClassesPage() {
  const hats = await hatsQuery();
  if (!hats.ok) {
    if (hats.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس‌ها در دسترس نیست" description={hats.message} />;
  }
  // A student who lands here (typed URL, old link) belongs on «کلاس من»; «کار جدید» only for people who may create.
  if (hats.data.isStudent && hats.data.teachingOfferings.length === 0) redirect("/my-class");
  const ctx = await requireContext();
  const canCreate = canAtAnyScope(ctx.assignments, "workspace.work_item.create");
  const offerings = hats.data.teachingOfferings;
  const timetable = offerings.length > 0 ? await myTimetableQuery() : null;
  const tt = timetable?.ok ? timetable.data : null;
  const week = schoolWeekOf(tehranNow());
  return (
    <ContentWidth className="gap-4">
      <PageHeader title="کلاس‌های من" description={offeringsSummaryFa(offerings.length)} actions={<ClassesActions hasOfferings={offerings.length > 0} canCreate={canCreate} />} />

      {offerings.length > 0 ? (
        <section aria-labelledby="my-timetable-heading" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h3 id="my-timetable-heading" className="flex items-center gap-1.5 text-section font-semibold text-text">
              <CalendarDays className="size-4 self-center" strokeWidth={1.75} aria-hidden />
              برنامهٴ هفتگی من
            </h3>
            {hasTeachingWeek(tt) ? <p className="tabular text-meta text-text-muted">{week.label}</p> : null}
          </div>
          <TeachingWeek tt={tt} week={week} />
        </section>
      ) : null}

      {offerings.length === 0 ? (
        <NoOfferingsYet />
      ) : (
        <section aria-labelledby="offerings-heading" className="flex flex-col gap-2.5">
        <h3 id="offerings-heading" className="flex items-center gap-1.5 px-1 text-section font-semibold text-text">
          <Presentation className="size-4" strokeWidth={1.75} aria-hidden />
          درس‌های من
        </h3>
        <OfferingsGrid offerings={offerings} />
        </section>
      )}
    </ContentWidth>
  );
}
