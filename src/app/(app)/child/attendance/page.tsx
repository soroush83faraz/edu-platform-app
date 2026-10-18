import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ChildPageHeader, ChildSwitcher } from "@/components/guardian/ChildParts";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { isoDateToJalali } from "@/lib/format";
import { StudentAttendanceSection } from "@/modules/academic/ui/StudentAttendance";
import { childParam } from "@/modules/iam/guardian-policy";
import { childAttendanceQuery } from "@/modules/iam/guardian-queries";

export const metadata: Metadata = { title: "حضور و غیاب فرزند" };

/** «حضور و غیاب» of a child (a guardian): the last 30 days — the four counts and the recent غیبت / تأخیر by date. */
export default async function ChildAttendancePage({ searchParams }: { searchParams: Promise<{ child?: string | string[] }> }) {
  const res = await childAttendanceQuery({ child: childParam((await searchParams).child) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { children, child, summary } = res.data;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <ChildPageHeader
        title="حضور و غیاب"
        child={child}
        extra={
          <span className="tabular">
            از {isoDateToJalali(summary.from)} تا {isoDateToJalali(summary.to)}
          </span>
        }
      />
      <ChildSwitcher items={children} current={child.studentProfileId} page="attendance" />
      <StudentAttendanceSection
        summary={summary}
        heading={`حضور و غیاب ${child.firstName}`}
        emptyTitle={`هنوز حضور و غیابی برای ${child.firstName} ثبت نشده`}
        emptyDescription="وقتی دبیر کلاس حضور و غیاب بزند، همین‌جا می‌آید."
      />
    </ContentWidth>
  );
}
