// ONE student's attendance summary — the four counts and the recent marks — drawn by the student's own «حضور و غیاب
// من» (`/attendance`) and by a guardian's «حضور و غیاب» of a child (`/child/attendance`, 2026-10-18), from the same
// read (`studentAttendanceSummary`). Counts only: no presence / absence percentage for a student (owner 2026-09-27).
import { ClipboardList } from "lucide-react";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { ATTENDANCE_LABELS, ATTENDANCE_TONES, totalOf, type AttendanceStatus } from "@/lib/attendance";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";
import type { StudentAttendanceSummary } from "../attendance";

export function StudentAttendanceSection({
  summary,
  heading,
  emptyTitle,
  emptyDescription,
}: {
  summary: StudentAttendanceSummary;
  heading: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const counts = summary.counts;
  const total = totalOf(counts);
  return (
    <>
      <section aria-labelledby="student-attendance-heading" className="flex flex-col gap-2.5">
        <h3 id="student-attendance-heading" className="flex items-center gap-1.5 px-1 text-section font-semibold text-text">
          <ClipboardList className="size-4" strokeWidth={1.75} aria-hidden />
          {heading}
        </h3>
        {total === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} className="surface-work py-10" />
        ) : (
          <dl className="grid grid-cols-4 gap-1.5">
            {(Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[]).map((s) => (
              <div key={s} className="surface-panel flex flex-col items-center gap-0.5 px-1 py-3 text-center">
                <dt className="text-meta text-text-muted">{ATTENDANCE_LABELS[s]}</dt>
                <dd className="tabular text-lg font-semibold text-text">{formatNumberFa(counts[s])}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {summary.recent.length > 0 ? (
        <section aria-labelledby="student-recent-heading" className="flex flex-col gap-2.5">
          <h3 id="student-recent-heading" className="px-1 text-section font-semibold text-text">
            آخرین موردها
          </h3>
          <ul className="reveal-rows flex flex-col divide-y divide-line/70 surface-work">
            {summary.recent.map((r, i) => (
              <li key={`${r.date}-${r.periodNo ?? "d"}-${i}`} className="flex min-h-14 items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-row text-text">{r.subjectName ? <bdi>{r.subjectName}</bdi> : "حضور و غیاب روزانه"}</p>
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
  );
}
