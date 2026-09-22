import { CalendarDays, ChevronLeft, ChevronRight, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { ClayIcon } from "@/components/ClayIcon";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { addDaysIso, isFutureIso, tehranToday, weekdayOfIso } from "@/lib/attendance";
import { formatJalaliDateTime, isoDateToJalali } from "@/lib/format";
import { formatTimeRangeFa, WEEKDAY_LABELS } from "@/lib/timetable";
import { attendanceSessionQuery } from "@/modules/academic/queries";
import { AttendanceRoster } from "@/modules/academic/ui/AttendanceRoster";

export const metadata: Metadata = { title: "ثبت حضور و غیاب | سامانهٴ مدرسه" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const hrefFor = (classGroupId: string, date: string, periodNo: number | null) =>
  `/attendance/${classGroupId}?date=${date}${periodNo === null ? "" : `&period=${periodNo}`}`;

/**
 * «ثبت حضور و غیاب» of one class at one زنگ (`?date=&period=`): the class, the درس and the زنگ in the header, the
 * day's other زنگ‌ها as a switcher, yesterday/tomorrow as arrows, then the roster. Everything the page needs comes
 * from ONE query whose service decides the scope — a class that is not the caller's (or a زنگ whose درس they do
 * not teach) is «چنین صفحه‌ای پیدا نشد», never a 403.
 */
export default async function TakeAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ classGroupId: string }>;
  searchParams: Promise<{ date?: string; period?: string }>;
}) {
  const { classGroupId } = await params;
  if (!UUID_RE.test(classGroupId)) notFound();
  const sp = await searchParams;
  const date = sp.date && ISO_RE.test(sp.date) ? sp.date : tehranToday();
  const periodNo = sp.period && /^\d{1,2}$/.test(sp.period) ? Number(sp.period) : null;

  const result = await attendanceSessionQuery({ classGroupId, date, periodNo });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const data = result.data;
  const dayName = WEEKDAY_LABELS[weekdayOfIso(date) ?? 0];
  const prev = addDaysIso(date, -1);
  const next = addDaysIso(date, 1);

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        back={{ href: "/attendance", label: "حضور و غیاب" }}
        title={
          <span className="flex items-center gap-3">
            <ClayIcon icon={UserCheck} size="lg" />
            <span>
              کلاس <bdi>{data.classGroup.name}</bdi>
            </span>
          </span>
        }
        description={
          <>
            {data.offering ? (
              <>
                <bdi>{data.offering.subjectName}</bdi>
                {" · "}
              </>
            ) : null}
            {data.period ? (
              <>
                {data.period.label}{" "}
                <bdi dir="ltr" className="tabular">
                  {formatTimeRangeFa(data.period.startsAt, data.period.endsAt)}
                </bdi>
                {" · "}
              </>
            ) : (
              <>حضور و غیاب روزانه · </>
            )}
            {dayName} <span className="tabular">{isoDateToJalali(date)}</span>
          </>
        }
      />

      <nav aria-label="روز" className="flex items-center justify-between gap-2">
        <Link href={hrefFor(classGroupId, prev, periodNo)} className="pressable inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm text-text-muted hover:bg-surface-sunken hover:text-text">
          <ChevronRight className="size-4" aria-hidden />
          روز قبل
        </Link>
        <span className="flex items-center gap-1.5 text-meta text-text-muted">
          <CalendarDays className="size-4 text-sky-strong" aria-hidden />
          <span className="tabular">{isoDateToJalali(date)}</span>
        </span>
        {isFutureIso(next) ? (
          <span className="inline-flex min-h-11 items-center px-3 text-sm text-text-faint">روز بعد</span>
        ) : (
          <Link href={hrefFor(classGroupId, next, periodNo)} className="pressable inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm text-text-muted hover:bg-surface-sunken hover:text-text">
            روز بعد
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        )}
      </nav>

      {data.periodsOfDay.length > 0 ? (
        <nav aria-label="زنگ‌های این روز" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex w-max min-w-full gap-1.5">
            {data.periodsOfDay.map((p) => {
              const current = p.periodNo === periodNo;
              return (
                <li key={p.periodNo}>
                  <Link
                    href={hrefFor(classGroupId, date, p.periodNo)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "pressable flex min-h-11 flex-col justify-center rounded-xl border px-3 py-1 text-meta whitespace-nowrap",
                      current ? "border-primary-600/40 bg-primary-50 text-primary-800" : "border-line bg-surface text-text-muted hover:bg-surface-sunken",
                    )}
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className="flex items-center gap-1">
                      <bdi>{p.subjectName}</bdi>
                      {p.taken ? <span className="size-1.5 rounded-full bg-success" aria-label="ثبت‌شده" /> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {data.saved ? (
        <p className="rounded-card bg-info-soft px-4 py-2.5 text-meta text-primary-800">
          ثبت‌شده در <span className="tabular">{formatJalaliDateTime(data.saved.takenAt)}</span>
          {data.saved.takenByName ? (
            <>
              {" "}
              به‌دست <bdi>{data.saved.takenByName}</bdi>
            </>
          ) : null}
          {data.canWrite ? " — می‌توانید تغییر دهید." : null}
        </p>
      ) : null}

      <AttendanceRoster data={data} />
    </ContentWidth>
  );
}
