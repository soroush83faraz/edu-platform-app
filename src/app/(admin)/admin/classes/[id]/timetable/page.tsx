import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { currentPeriodOf, tehranClock } from "@/lib/timetable";
import { classTimetableQuery } from "@/modules/academic/queries";
import { TimetableEditor } from "@/modules/academic/ui/TimetableEditor";

export const metadata: Metadata = { title: "برنامهٴ هفتگی کلاس | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /admin/classes/[id]/timetable — the weekly grid of one class; editable by admins of its school, read-only otherwise. */
export default async function ClassTimetablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await classTimetableQuery({ classGroupId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const data = result.data;
  const clock = tehranClock(new Date());
  const { currentPeriodNo } = currentPeriodOf(data.periods, clock.minutes);
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={`برنامهٴ هفتگی کلاس ${data.classGroup.name}`}
        description={`${data.classGroup.schoolName} · هر خانه یک زنگ؛ درس را انتخاب کنید تا همان لحظه ذخیره شود. دانش‌آموزان همین برنامه را در «کلاس من» می‌بینند.`}
        back={{ href: `/admin/classes/${id}`, label: `کلاس ${data.classGroup.name}` }}
      />
      <TimetableEditor data={data} today={clock.weekday} currentPeriodNo={currentPeriodNo} />
    </div>
  );
}
