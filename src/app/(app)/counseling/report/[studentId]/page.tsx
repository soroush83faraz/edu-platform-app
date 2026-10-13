import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/Chip";
import { RelativeTime } from "@/components/RelativeTime";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { REPORT_KIND_LABELS } from "@/modules/counseling/policy";
import { teacherReportPageQuery } from "@/modules/counseling/queries";
import { TeacherReportForm, WithdrawReportButton } from "@/modules/counseling/ui";

export const metadata: Metadata = { title: "گزارش به مشاور" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «گزارش به مشاور» — the teacher's side of the counseling file (owner 2026-10-13): reached from the student's row of
 * the roll call (and from a «درخواست گزارش» the counselor sent). Only for a student the teacher teaches NOW — anyone
 * else is «چنین صفحه‌ای پیدا نشد». The form, then the teacher's OWN earlier reports on this student; the counselor's
 * notes and other teachers' reports are never shown here.
 */
export default async function TeacherReportPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  if (!UUID_RE.test(studentId)) notFound();
  const result = await teacherReportPageQuery({ studentProfileId: studentId });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { student, mine } = result.data;

  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <PageHeader
        title="گزارش به مشاور"
        description={
          <>
            دربارهٴ <bdi className="text-text">{student.name}</bdi>
            {student.classGroupName ? (
              <>
                {" · "}کلاس <bdi>{student.classGroupName}</bdi>
              </>
            ) : null}
            {" — "}مشاور و مدیریت مدرسه آن را در پروندهٴ مشاوره می‌بینند.
          </>
        }
      />
      <PageSection id="new-report" title="گزارش جدید" surface="work">
        <TeacherReportForm studentProfileId={student.studentProfileId} />
      </PageSection>
      <PageSection id="my-reports" title="گزارش‌های من دربارهٴ این دانش‌آموز" count={mine.length}>
        {mine.length === 0 ? (
          <p className="px-1 text-sm text-text-muted">هنوز گزارشی دربارهٴ این دانش‌آموز نفرستاده‌اید.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/70">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5 px-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone="primary">{REPORT_KIND_LABELS[r.kind]}</Chip>
                    <span className="text-meta text-text-muted">
                      {r.subjectName ? (
                        <>
                          <bdi>{r.subjectName}</bdi>
                          {" · "}
                        </>
                      ) : null}
                      <RelativeTime at={r.createdAt} mode="time" />
                    </span>
                  </span>
                  <WithdrawReportButton reportId={r.id} />
                </div>
                <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                  <bdi>{r.body}</bdi>
                </p>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </ContentWidth>
  );
}
