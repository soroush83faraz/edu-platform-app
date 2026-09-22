import { CalendarDays, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { PageSection } from "@/components/layout/PageSection";
import type { SessionSecondary, SessionView } from "@/components/timetable/types";
import { formatTimeFa, sessionStates, WEEKDAY_LABELS, type Weekday } from "@/lib/timetable";

/**
 * «امروز» on the desktop dashboard: today's زنگ‌ها as one quiet list — the time column (LTR digits), the subject,
 * the teacher (students) or the class (teachers), and the state at the end: the ringing one is the `primary-50`
 * row with «الان», the next one «بعدی», past ones dimmed. Every row opens its subject page; the section's trailing
 * link opens the whole week.
 */
export function TodaySessions({
  title = "امروز",
  sessions,
  today,
  nowMinutes,
  secondary,
  weekHref,
  hasTimetable,
}: {
  title?: string;
  sessions: SessionView[];
  today: Weekday;
  nowMinutes: number;
  secondary: SessionSecondary;
  weekHref: string;
  /** false when the school has not set the timetable at all (a different empty line). */
  hasTimetable: boolean;
}) {
  const states = sessionStates(sessions, true, nowMinutes);
  return (
    <PageSection
      id="today-sessions"
      title={title}
      icon={CalendarDays}
      count={sessions.length > 0 ? sessions.length : undefined}
      surface="work"
      flush
      trailing={
        <Link href={weekHref} className="pressable inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          کل هفته
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      }
    >
      {sessions.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">{hasTimetable ? `${WEEKDAY_LABELS[today]} زنگی ندارید.` : "برنامهٴ هفتگی هنوز تنظیم نشده."}</p>
      ) : (
        <ol className="divide-y divide-line/70">
          {sessions.map((s, i) => {
            const state = states[i];
            const current = state === "current";
            return (
              <li key={`${s.offeringId}-${s.periodNo}`}>
                <Link
                  href={`/subjects/${s.offeringId}`}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "pressable flex min-h-14 items-center gap-4 px-4 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken",
                    current && "bg-primary-50 hover:bg-primary-50",
                    state === "past" && "opacity-60",
                  )}
                >
                  <bdi dir="ltr" className={cn("tabular w-24 shrink-0 text-meta", current ? "font-semibold text-primary-800" : "text-text-muted")}>
                    {formatTimeFa(s.startsAt)}–{formatTimeFa(s.endsAt)}
                  </bdi>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-row font-semibold", current ? "text-primary-900" : "text-text")}>
                      <bdi>{s.subjectName}</bdi>
                    </span>
                    <span className={cn("truncate text-meta", current ? "text-primary-800/80" : "text-text-muted")}>
                      <bdi>{secondary === "class" ? `کلاس ${s.classGroupName}` : (s.teacherName ?? "دبیر هنوز مشخص نشده")}</bdi>
                      <span className="text-text-faint"> · {s.label}</span>
                    </span>
                  </span>
                  {current ? <Chip tone="primary">الان</Chip> : state === "next" ? <Chip tone="neutral">بعدی</Chip> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </PageSection>
  );
}
