// The sections of a teacher's «کلاس‌های من» (`/classes`), one component each, so the full page (classic layout)
// and the hub layout's dedicated tile pages (`/classes/offerings`, `/classes/timetable`) draw the very same markup
// from the very same reads — nothing is duplicated between the two layouts (docs/decisions-pending/home-hub-tiles.md).
import { ChevronLeft, Plus, UserCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SubjectIcon } from "@/components/SubjectStamp";
import { WeekTimetable } from "@/components/timetable/WeekTimetable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatNumberFa } from "@/lib/format";
import type { SchoolWeek } from "@/lib/jalali-grid";
import type { MyTimetable } from "@/modules/academic/service";
import type { TeachingOffering } from "@/modules/iam/hats";

/** The page actions: the teacher's door into today's roll call, and «تکلیف جدید» for people who may create. */
export function ClassesActions({ hasOfferings, canCreate }: { hasOfferings: boolean; canCreate: boolean }) {
  return (
    <>
      {/* The roll call of today's زنگ‌ها lives on /attendance; this is the teacher's door into it. */}
      {hasOfferings ? (
        <Button asChild variant="outline">
          <Link href="/attendance">
            <UserCheck aria-hidden />
            حضور و غیاب
          </Link>
        </Button>
      ) : null}
      {canCreate ? (
        <Button asChild>
          <Link href="/inbox/new">
            <Plus aria-hidden />
            تکلیف جدید
          </Link>
        </Button>
      ) : null}
    </>
  );
}

/** «N درس در این سال», or that nothing is assigned yet. */
export function offeringsSummaryFa(count: number): string {
  return count > 0 ? `${formatNumberFa(count)} درس در این سال` : "درسی به شما سپرده نشده";
}

/** Did the timetable read yield a teaching week (the week label shows only then)? */
export function hasTeachingWeek(tt: MyTimetable | null): boolean {
  return Boolean(tt?.teacher);
}

/** The teacher's week across classes, or the «not set yet» state. */
export function TeachingWeek({ tt, week }: { tt: MyTimetable | null; week: SchoolWeek }) {
  const teaching = tt?.teacher ?? null;
  // A teacher's classes may sit in different schools: the period rows of the week table come from the sessions themselves.
  const periods = teaching
    ? [...new Map(teaching.days.flatMap((d) => d.sessions).map((s) => [s.periodNo, { periodNo: s.periodNo, label: s.label, startsAt: s.startsAt, endsAt: s.endsAt }])).values()].sort((a, b) => a.periodNo - b.periodNo)
    : [];
  return teaching && tt ? (
    <WeekTimetable days={teaching.days} periods={periods} today={tt.today} nowMinutes={tt.nowMinutes} secondary="class" perspective="staff" weekDays={week.days} comingWeek={week.comingWeek} />
  ) : (
    <EmptyState title="برنامهٴ هفتگی هنوز تنظیم نشده" description="وقتی مدرسه برنامهٴ کلاس‌ها را ثبت کند، زنگ‌های شما همین‌جا می‌آیند." className="surface-work py-10" />
  );
}

/** One card per offering (درس, کلاس, students, open items I gave that class), each opening the subject page. */
export function OfferingsGrid({ offerings }: { offerings: readonly TeachingOffering[] }) {
  return (
    <ul className="reveal-grid grid grid-cols-2 gap-2.5 md:grid-cols-3">
      {offerings.map((o) => (
        <li key={o.offeringId} className="flex">
          <Link prefetch={false} href={`/subjects/${o.offeringId}`} className="surface-work surface-link flex w-full flex-col gap-3 p-4">
            {/* The درس's own glyph on its hue heads the card (the name keeps the full card width on a phone's two columns). */}
            <div className="flex items-start justify-between gap-2">
              <SubjectIcon subjectId={o.subjectId} name={o.subjectName} />
              <ChevronLeft className="mt-1 size-4 shrink-0 text-text-faint" aria-hidden />
            </div>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="line-clamp-2 text-row font-semibold text-text">
                <bdi>{o.subjectName}</bdi>
              </span>
              <span className="truncate text-meta text-text-muted">
                کلاس <bdi>{o.classGroupName}</bdi>
              </span>
            </span>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-meta">
              <span className="text-text-muted">
                <span className="tabular font-medium text-text">{formatNumberFa(o.activeStudents)}</span> دانش‌آموز
              </span>
              <span className={cn("tabular rounded-full px-2 py-0.5 font-medium", o.openItems > 0 ? "bg-info-soft text-primary-800" : "bg-surface-sunken text-text-muted")}>
                {formatNumberFa(o.openItems)} تکلیف باز
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A teacher with no offering yet. */
export function NoOfferingsYet() {
  return <EmptyState title="هنوز درسی به شما سپرده نشده" description="وقتی مدیر درسی را به شما بدهد، کلاس‌ها همین‌جا می‌آیند." />;
}
