import { CalendarCheck, CircleCheck, ClipboardList, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { ATTENDANCE_LABELS, ATTENDANCE_TONES, absencePercent, formatPercentFa, presencePercent, totalOf, type AttendanceStatus } from "@/lib/attendance";
import { requireContext } from "@/lib/ctx";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";
import { formatTimeRangeFa, WEEKDAY_LABELS } from "@/lib/timetable";
import { myAttendanceQuery, teacherDayQuery } from "@/modules/academic/queries";
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
  const mine = await myAttendanceQuery({});
  const summary = mine.ok ? mine.data : null;

  // Nothing personal to show: an admin belongs in the hub, anyone else gets the empty state.
  if (summary === null && cells.length === 0 && canReport) redirect("/admin/attendance");

  const counts = summary?.counts ?? null;
  const total = counts ? totalOf(counts) : 0;

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
                  href={`/attendance/${c.classGroupId}?date=${day?.ok ? day.data.date : ""}&period=${c.periodNo}`}
                  className="pressable flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken"
                >
                  <RowMark icon={UserCheck} />
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

      {summary && counts ? (
        <>
          <section aria-labelledby="my-attendance-heading" className="flex flex-col gap-2.5">
            <h3 id="my-attendance-heading" className="flex items-center gap-1.5 px-1 text-section font-semibold text-text">
              <ClipboardList className="size-4" strokeWidth={1.75} aria-hidden />
              حضور و غیاب من
            </h3>
            {total === 0 ? (
              <EmptyState title="هنوز حضور و غیابی برای شما ثبت نشده" description="وقتی دبیر کلاس حضور و غیاب بزند، همین‌جا می‌بینید." className="surface-work py-10" />
            ) : (
              <>
                <div className="surface-work flex items-center justify-between gap-3 px-4 py-4">
                  <div className="flex flex-col">
                    <span className="text-meta text-text-muted">درصد حضور</span>
                    <span className="tabular text-2xl leading-8 font-bold text-primary-800">{formatPercentFa(presencePercent(counts))}</span>
                  </div>
                  <div className="flex flex-col text-end">
                    <span className="text-meta text-text-muted">درصد غیبت</span>
                    <span className={cn("tabular text-2xl leading-8 font-bold", absencePercent(counts) > 10 ? "text-danger" : "text-text")}>{formatPercentFa(absencePercent(counts))}</span>
                  </div>
                </div>
                <dl className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[]).map((s) => (
                    <div key={s} className="surface-panel flex flex-col items-center gap-0.5 px-1 py-3 text-center">
                      <dt className="text-meta text-text-muted">{ATTENDANCE_LABELS[s]}</dt>
                      <dd className="tabular text-lg font-semibold text-text">{formatNumberFa(counts[s])}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </section>

          {summary.recent.length > 0 ? (
            <section aria-labelledby="recent-heading" className="flex flex-col gap-2.5">
              <h3 id="recent-heading" className="px-1 text-section font-semibold text-text">
                آخرین موردها
              </h3>
              <ul className="reveal-rows flex flex-col divide-y divide-line/70 surface-work">
                {summary.recent.map((r, i) => (
                  <li key={`${r.date}-${r.periodNo ?? "d"}-${i}`} className="flex min-h-14 items-center gap-3 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="truncate text-row text-text">
                        {r.subjectName ? <bdi>{r.subjectName}</bdi> : "حضور و غیاب روزانه"}
                      </p>
                      <p className="truncate text-meta text-text-muted">
                        <span className="tabular">{isoDateToJalali(r.date)}</span>
                        {r.minutesLate ? <span className="ms-2">{formatNumberFa(r.minutesLate)} دقیقه</span> : null}
                      </p>
                    </div>
                    <Chip tone={ATTENDANCE_TONES[r.status as AttendanceStatus] ?? "neutral"} className="shrink-0">
                      {ATTENDANCE_LABELS[r.status as AttendanceStatus] ?? r.status}
                    </Chip>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {summary === null && cells.length === 0 && !canReport ? (
        <EmptyState title="حضور و غیابی برای شما ثبت نمی‌شود" description="این بخش برای دانش‌آموزان و دبیران کلاس است." />
      ) : null}

      {canReport ? (
        <p className="px-1 text-meta text-text-muted">
          گزارش کامل مدرسه در{" "}
          <Link href="/admin/attendance" className="text-primary-700 hover:underline">
            مدیریت ← حضور و غیاب
          </Link>
          .
        </p>
      ) : null}
    </ContentWidth>
  );
}
