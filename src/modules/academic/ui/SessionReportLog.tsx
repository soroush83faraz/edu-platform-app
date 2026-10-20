import { BookOpenText, ClipboardList, Lock } from "lucide-react";
import Link from "next/link";
import { PageSection } from "@/components/layout/PageSection";
import { RowMark } from "@/components/RowMark";
import { isoDateToJalali } from "@/lib/format";
import { weekdayOfIso } from "@/lib/attendance";
import { hasPrivateNote } from "@/lib/session-report";
import { WEEKDAY_LABELS } from "@/lib/timetable";
import type { OfferingSessionReports } from "../session-report";

/**
 * «دفتر کلاسی» of the subject page: the past session reports of the درس, newest first — the day and زنگ, the topic that
 * was taught, its page / chapter, the تکلیف of that session (a link, only when this viewer may open it) and the plan for
 * the next session. A report that carries `privateNote` (the service attaches it only for someone who may WRITE the
 * report) also shows the دبیر's private note in a quiet panel; for a student or anyone else the field does not exist.
 */
export function SessionReportLog({ data }: { data: OfferingSessionReports }) {
  const { reports, includesPrivate } = data;
  return (
    <PageSection id="session-reports" title="دفتر کلاسی" icon={BookOpenText} surface="work" flush count={reports.length > 0 ? reports.length : undefined}>
      {reports.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">
          {includesPrivate ? "هنوز گزارشی برای جلسه‌های این درس ثبت نشده است؛ بعد از حضور و غیاب هر زنگ، «گزارش جلسه» را بنویسید." : "هنوز گزارشی برای جلسه‌های این درس ثبت نشده است."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/70">
          {reports.map(({ report, periodLabel }) => {
            const day = WEEKDAY_LABELS[weekdayOfIso(report.date) ?? 0];
            return (
              <li key={report.id} className="flex items-start gap-3 px-4 py-3.5">
                <RowMark icon={BookOpenText} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="text-meta text-text-muted">
                    {day} <span className="tabular">{isoDateToJalali(report.date)}</span>
                    {periodLabel ? ` · ${periodLabel}` : null}
                  </p>
                  <p className="text-row font-medium text-text">
                    {report.topic}
                  </p>
                  {report.pageRef ? (
                    <p className="text-meta text-text-muted">
                      صفحه یا فصل: {report.pageRef}
                    </p>
                  ) : null}
                  {report.workItem ? (
                    <Link href={`/inbox/${report.workItem.id}`} className="pressable inline-flex min-h-11 w-fit max-w-full items-center gap-2 text-sm text-primary-700 hover:underline">
                      <ClipboardList className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">تکلیف این جلسه: {report.workItem.title}</span>
                    </Link>
                  ) : null}
                  {report.nextPlan ? (
                    <p className="text-meta text-text-muted">
                      برنامهٴ جلسهٴ بعد: {report.nextPlan}
                    </p>
                  ) : null}
                  {hasPrivateNote(report) && report.privateNote ? (
                    <div className="surface-panel mt-1 flex flex-col gap-1 p-3">
                      <p className="flex items-center gap-1.5 text-meta font-medium text-text-muted">
                        <Lock className="size-4" aria-hidden />
                        یادداشت دبیر (فقط برای مدیریت و دبیر)
                      </p>
                      <p className="whitespace-pre-line text-sm text-text">
                        {report.privateNote}
                      </p>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageSection>
  );
}
