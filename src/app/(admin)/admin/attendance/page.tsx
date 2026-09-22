import { CalendarClock, ChevronLeft, TriangleAlert, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONES,
  addDaysIso,
  formatPercentFa,
  presencePercent,
  tehranToday,
  type AttendanceStatus,
} from "@/lib/attendance";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";
import { WEEKDAY_LABELS } from "@/lib/timetable";
import { attendanceClassesQuery, attendanceGapsQuery, classAttendanceReportQuery, studentAttendanceQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "حضور و غیاب | مدیریت" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGES = [
  { value: "7", label: "۷ روز گذشته" },
  { value: "30", label: "۳۰ روز گذشته" },
  { value: "90", label: "۹۰ روز گذشته" },
] as const;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * «حضور و غیاب» of the management hub: pick a class and a range (a GET form — the URL is the state, so a row can
 * be shared and printed), read the per-student totals with the absence percentage, drill into one student, and
 * above it all the «امروز ثبت نشده» list — today's زنگ‌ها of the caller's schools with no roll call yet, each a
 * link into the teacher's own page. Everything is narrowed by the admin scope inside the queries.
 */
export default async function AdminAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rangeDays = RANGES.some((r) => r.value === one(sp.range)) ? Number(one(sp.range)) : 30;
  const classGroupId = UUID_RE.test(one(sp.class)) ? one(sp.class) : "";
  const studentProfileId = UUID_RE.test(one(sp.student)) ? one(sp.student) : "";
  const to = tehranToday();
  const from = addDaysIso(to, -(rangeDays - 1));

  const classes = await attendanceClassesQuery();
  if (!classes.ok) {
    if (classes.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const gaps = await attendanceGapsQuery();
  const report = classGroupId ? await classAttendanceReportQuery({ classGroupId, from, to }) : null;
  const student = studentProfileId ? await studentAttendanceQuery({ studentProfileId, from, to }) : null;
  const hrefFor = (next: { class?: string; range?: string; student?: string }) => {
    const p = new URLSearchParams();
    const cls = next.class ?? classGroupId;
    const rng = next.range ?? String(rangeDays);
    const st = next.student ?? "";
    if (cls) p.set("class", cls);
    if (rng !== "30") p.set("range", rng);
    if (st) p.set("student", st);
    const q = p.toString();
    return q ? `/admin/attendance?${q}` : "/admin/attendance";
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Round 5: this report is a Home tile, not an admin section — so the way back is Home, not a section list. */}
      <PageHeader
        title="حضور و غیاب"
        back={{ href: "/home", label: "خانه" }}
        description="گزارش کلاس‌ها در یک بازه، و زنگ‌هایی که امروز هنوز ثبت نشده‌اند. ثبت حضور و غیاب کار دبیر همان زنگ است؛ مدیر و معاون هم می‌توانند."
      />

      {/* A plain GET form: the URL carries class + range, so the report is shareable and printable. */}
      <form method="get" className="surface-work flex flex-wrap items-end gap-2 p-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-meta text-text-muted">
          کلاس
          <SelectNative name="class" defaultValue={classGroupId} aria-label="کلاس" className="h-11">
            <option value="">— انتخاب کلاس —</option>
            {classes.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.schoolName}
              </option>
            ))}
          </SelectNative>
        </label>
        <label className="flex w-40 flex-col gap-1 text-meta text-text-muted">
          بازه
          <SelectNative name="range" defaultValue={String(rangeDays)} aria-label="بازه" className="h-11">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectNative>
        </label>
        <Button type="submit" className="h-11">
          نمایش گزارش
        </Button>
      </form>

      {gaps.ok && gaps.data.cells.length > 0 ? (
        <section aria-labelledby="gaps-heading" className="flex flex-col gap-2">
          <h3 id="gaps-heading" className="flex items-center gap-1.5 px-1 text-section font-semibold text-text">
            <TriangleAlert className="size-4 text-warning-text" strokeWidth={1.75} aria-hidden />
            امروز ثبت نشده
            <span className="tabular text-meta font-normal text-text-muted">
              {WEEKDAY_LABELS[gaps.data.weekday]} {isoDateToJalali(gaps.data.date)} · {formatNumberFa(gaps.data.cells.length)} زنگ
            </span>
          </h3>
          <ul className="surface-work flex flex-col divide-y divide-line/70">
            {gaps.data.cells.slice(0, 30).map((c) => (
              <li key={`${c.classGroupId}:${c.periodNo}`}>
                <Link
                  href={`/attendance/${c.classGroupId}?date=${gaps.data.date}&period=${c.periodNo}`}
                  className="flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken"
                >
                  <RowMark icon={CalendarClock} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-row font-medium text-text">
                      کلاس <bdi>{c.classGroupName}</bdi> — <bdi>{c.subjectName}</bdi>
                    </span>
                    <span className="truncate text-meta text-text-muted">
                      زنگ <span className="tabular">{formatNumberFa(c.periodNo)}</span>
                      {c.teacherName ? (
                        <>
                          {" · "}
                          <bdi>{c.teacherName}</bdi>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {gaps.data.cells.length > 30 ? (
            <p className="px-1 text-meta text-text-muted">و {formatNumberFa(gaps.data.cells.length - 30)} زنگ دیگر.</p>
          ) : null}
        </section>
      ) : gaps.ok ? (
        <p className="rounded-card bg-success-soft px-4 py-2.5 text-meta text-success">حضور و غیاب همهٴ زنگ‌های امروز ثبت شده است.</p>
      ) : null}

      {report === null ? (
        <EmptyState illustration={<UserCheck className="size-12 text-text-faint" aria-hidden />} title="کلاسی را انتخاب کنید" description="گزارش هر کلاس شامل درصد غیبت هر دانش‌آموز در بازهٴ انتخاب‌شده است." className="surface-work py-10" />
      ) : !report.ok ? (
        <EmptyState title="گزارش در دسترس نیست" description={report.message} className="surface-work py-10" />
      ) : report.data.students.length === 0 ? (
        <EmptyState title="در این بازه حضور و غیابی ثبت نشده" description={`کلاس ${report.data.classGroup.name} — از ${isoDateToJalali(from)} تا ${isoDateToJalali(to)}`} className="surface-work py-10" />
      ) : (
        <section aria-labelledby="report-heading" className="flex flex-col gap-2">
          <h3 id="report-heading" className="flex flex-wrap items-baseline gap-2 px-1 text-section font-semibold text-text">
            کلاس <bdi>{report.data.classGroup.name}</bdi>
            <span className="tabular text-meta font-normal text-text-muted">
              {isoDateToJalali(report.data.from)} تا {isoDateToJalali(report.data.to)} · {formatNumberFa(report.data.sessions)} جلسه · درصد حضور کلاس {formatPercentFa(presencePercent(report.data.totals))}
            </span>
          </h3>
          <div className="surface-work overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-line/70 text-meta text-text-muted">
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    دانش‌آموز
                  </th>
                  {(Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[]).map((s) => (
                    <th key={s} scope="col" className="px-2 py-2 text-center font-medium">
                      {ATTENDANCE_LABELS[s]}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-center font-medium">
                    درصد غیبت
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {report.data.students.map((s) => (
                  <tr key={s.studentProfileId} className="hover:bg-surface-sunken">
                    <th scope="row" className="px-3 py-2 text-start font-normal">
                      <Link href={hrefFor({ student: s.studentProfileId })} className="text-text hover:text-primary-700 hover:underline">
                        <bdi>{s.fullName}</bdi>
                      </Link>
                    </th>
                    {(Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[]).map((k) => (
                      <td key={k} className="tabular px-2 py-2 text-center text-text-muted">
                        {formatNumberFa(s.counts[k])}
                      </td>
                    ))}
                    <td className={cn("tabular px-3 py-2 text-center font-semibold", s.absencePercent > 10 ? "text-danger" : "text-text")}>{formatPercentFa(s.absencePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {student?.ok ? (
        <section aria-labelledby="student-heading" className="flex flex-col gap-2">
          <h3 id="student-heading" className="flex flex-wrap items-baseline gap-2 px-1 text-section font-semibold text-text">
            <bdi>{student.data.studentName}</bdi>
            <span className="tabular text-meta font-normal text-text-muted">{formatNumberFa(student.data.recent.length)} مورد اخیر</span>
            <Link href={hrefFor({ student: "" })} className="ms-auto text-meta font-normal text-text-muted hover:text-text">
              بستن
            </Link>
          </h3>
          <ul className="surface-work flex flex-col divide-y divide-line/70">
            {student.data.recent.map((r, i) => (
              <li key={`${r.date}-${r.periodNo ?? "d"}-${i}`} className="flex min-h-12 items-center gap-3 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-row text-text">{r.subjectName ? <bdi>{r.subjectName}</bdi> : "حضور و غیاب روزانه"}</span>
                  <span className="tabular truncate text-meta text-text-muted">{isoDateToJalali(r.date)}</span>
                </span>
                <Chip tone={ATTENDANCE_TONES[r.status as AttendanceStatus] ?? "neutral"} className="shrink-0">
                  {ATTENDANCE_LABELS[r.status as AttendanceStatus] ?? r.status}
                </Chip>
              </li>
            ))}
            {student.data.recent.length === 0 ? <li className="px-4 py-5 text-sm text-text-muted">در این بازه موردی ثبت نشده.</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
