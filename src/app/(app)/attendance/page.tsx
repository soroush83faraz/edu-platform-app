import { CalendarCheck, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { SubjectIcon } from "@/components/SubjectStamp";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { requireContext } from "@/lib/ctx";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";
import { offeringHue } from "@/lib/subject-stamp";
import { getTeacherHues } from "@/lib/teacher-hues";
import { formatTimeRangeFa, WEEKDAY_LABELS } from "@/lib/timetable";
import { myAttendanceQuery, teacherDayQuery } from "@/modules/academic/queries";
import { StudentAttendanceSection } from "@/modules/academic/ui/StudentAttendance";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "حضور و غیاب" };

/**
 * «حضور و غیاب» — one route, each hat its own view (the rule of `/timetable`): a teacher sees TODAY's زنگ‌ها with
 * «ثبت‌شده» marks and taps one to take the roll call; a student sees their own month — the four counts and the
 * recent marks. An admin who is neither goes to the management hub, where the report and the «امروز ثبت نشده»
 * list live. Someone with no attendance at all gets the empty state.
 */
export default async function AttendancePage() {
  const ctx = await requireContext();
  const canTake = canAtAnyScope(ctx.assignments, "academic.attendance.write");
  const canReport = canAtAnyScope(ctx.assignments, "academic.attendance.report");

  const day = canTake ? await teacherDayQuery() : null;
  const cells = day?.ok ? day.data.cells : [];
  // Today's زنگ‌ها wear the teacher's own colour of each class (owner 2026-10-06), as on their cards and week.
  const hues = cells.length > 0 ? await getTeacherHues() : undefined;
  const mine = await myAttendanceQuery({});
  const summary = mine.ok ? mine.data : null;

  // Nothing personal to show: an admin belongs in the hub, anyone else gets the empty state.
  if (summary === null && cells.length === 0 && canReport) redirect("/admin/attendance");

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        title="حضور و غیاب"
        description={
          summary
            ? `${summary.className ? `کلاس ${summary.className} · ` : ""}از ${isoDateToJalali(summary.from)} تا ${isoDateToJalali(summary.to)}`
            : cells.length > 0
              ? `${WEEKDAY_LABELS[day?.ok ? day.data.weekday : 0]} · ${formatNumberFa(cells.length)} زنگ`
              : undefined
        }
      />

      {cells.length > 0 ? (
        <section aria-labelledby="today-heading" className="flex flex-col gap-2.5">
          <h3 id="today-heading" className="flex items-center gap-1.5 px-1 text-section font-semibold text-text">
            <CalendarCheck className="size-4" strokeWidth={1.75} aria-hidden />
            زنگ‌های امروز
          </h3>
          <ul className="reveal-rows flex flex-col divide-y divide-line/70 surface-work">
            {cells.map((c) => (
              <li key={`${c.classGroupId}:${c.periodNo}`}>
                <Link
                  prefetch={false}
                  href={`/attendance/${c.classGroupId}?date=${day?.ok ? day.data.date : ""}&period=${c.periodNo}`}
                  className="pressable flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken"
                >
                  <SubjectIcon subjectId={c.subjectId} name={c.subjectName} hue={offeringHue(hues, c.offeringId, c.subjectId)} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-row font-medium text-text">
                      <bdi>{c.subjectName}</bdi> — کلاس <bdi>{c.classGroupName}</bdi>
                    </p>
                    <p className="truncate text-meta text-text-muted">
                      {c.label}{" "}
                      <bdi dir="ltr" className="tabular">
                        {formatTimeRangeFa(c.startsAt, c.endsAt)}
                      </bdi>
                    </p>
                  </div>
                  {c.taken ? (
                    <Chip tone={c.absent > 0 ? "warning" : "success"} className="shrink-0">
                      <CircleCheck className="size-3.5" aria-hidden />
                      {c.absent > 0 ? `${formatNumberFa(c.absent)} غایب` : "ثبت‌شده"}
                    </Chip>
                  ) : (
                    <Chip tone="neutral" className="shrink-0">
                      ثبت نشده
                    </Chip>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : canTake && !summary ? (
        <EmptyState
          title="امروز زنگی در برنامهٴ شما نیست"
          description="روزهای دیگر هفته را از «کلاس‌های من» باز کنید؛ حضور و غیاب هر زنگ از همان‌جا ثبت می‌شود."
        />
      ) : null}

      {summary ? (
        <StudentAttendanceSection
          summary={summary}
          heading="حضور و غیاب من"
          emptyTitle="هنوز حضور و غیابی برای شما ثبت نشده"
          emptyDescription="وقتی دبیر کلاس حضور و غیاب بزند، همین‌جا می‌بینید."
        />
      ) : null}

      {summary === null && cells.length === 0 && !canReport ? (
        <EmptyState title="حضور و غیابی برای شما ثبت نمی‌شود" description="این بخش برای دانش‌آموزان و دبیران کلاس است." />
      ) : null}

      {canReport ? (
        <p className="px-1 text-meta text-text-muted">
          گزارش کامل مدرسه در{" "}
          <Link href="/admin/attendance" prefetch={false} className="text-primary-700 hover:underline">
            مدیریت ← حضور و غیاب
          </Link>
          .
        </p>
      ) : null}
    </ContentWidth>
  );
}
