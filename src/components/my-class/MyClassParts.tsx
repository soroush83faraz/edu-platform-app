// The sections of «کلاس من» (`/my-class`), one component each, so the full page (classic layout) and the hub
// layout's dedicated tile pages (`/my-class/info`, `/my-class/timetable`, `/my-class/subjects`) draw the very same
// markup from the very same reads — nothing is duplicated between the two layouts (docs/decisions-pending/home-hub-tiles.md).
import { BookOpen, School, Users } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { SchoolClay } from "@/components/illustrations";
import { WeekTimetable } from "@/components/timetable/WeekTimetable";
import { formatNumberFa } from "@/lib/format";
import type { SchoolWeek } from "@/lib/jalali-grid";
import type { MyClass, MyClassTeacher } from "@/modules/academic/repo";
import type { MyTimetable } from "@/modules/academic/service";

/** The class and its school, on the soft info surface. */
export function MyClassCard({ cls }: { cls: MyClass }) {
  return (
    <section aria-label="کلاس" className="flex items-center gap-3 rounded-card bg-info-soft px-4 py-3">
      <SchoolClay size={48} />
      <div className="flex min-w-0 flex-col">
        <h2 className="text-lg font-bold leading-7 text-primary-900">
          کلاس <bdi>{cls.classGroupName}</bdi>
        </h2>
        <p className="truncate text-sm text-primary-800/80">
          <bdi>{cls.schoolName}</bdi>
        </p>
      </div>
    </section>
  );
}

/** «هم‌کلاسی‌ها» and «درس‌ها» as two counts. */
export function MyClassFacts({ cls }: { cls: MyClass }) {
  return (
    <Card>
      <dl className="grid grid-cols-2 divide-x divide-line/70">
        <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
          <RowMark icon={Users} />
          <dt className="text-meta text-text-muted">هم‌کلاسی‌ها</dt>
          <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.classmates)}</dd>
        </div>
        <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
          <RowMark icon={BookOpen} />
          <dt className="text-meta text-text-muted">درس‌ها</dt>
          <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.teachers.length)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** The student's week (the class timetable), or the «not set yet» state. */
export function MyWeek({ tt, week }: { tt: MyTimetable | null; week: SchoolWeek }) {
  const student = tt?.student ?? null;
  return student && tt && myWeekHasSlots(tt) ? (
    <WeekTimetable days={student.days} periods={student.periods} today={tt.today} nowMinutes={tt.nowMinutes} secondary="teacher" perspective="student" weekDays={week.days} comingWeek={week.comingWeek} />
  ) : (
    <EmptyState
      title="برنامهٴ هفتگی هنوز تنظیم نشده"
      description="وقتی مدرسه برنامهٴ کلاس را ثبت کند، زنگ‌های هر روز همین‌جا می‌آیند."
      className="surface-work py-10"
    />
  );
}

/** Does the student's week have any session at all (the week label shows only then)? */
export function myWeekHasSlots(tt: MyTimetable | null): boolean {
  return tt?.student ? tt.student.days.some((d) => d.sessions.length > 0) : false;
}

/** «درس‌ها و دبیران»: one row per درس of the class, each opening its subject page. */
export function MySubjectsList({ teachers }: { teachers: readonly MyClassTeacher[] }) {
  return (
    <Card>
      {teachers.length === 0 ? (
        <p className="px-4 py-5 text-sm text-text-muted">هنوز درسی برای این کلاس تعریف نشده؛ وقتی مدرسه درس و دبیر ثبت کند، همین‌جا می‌آید.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {teachers.map((t) => (
            <li key={t.offeringId}>
              <Link href={`/subjects/${t.offeringId}`} className="pressable flex min-h-14 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                <RowMark icon={School} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-row font-medium text-text">
                    <bdi>{t.subjectName}</bdi>
                  </p>
                  <p className="truncate text-meta text-text-muted">{t.teacherName ? <bdi>{t.teacherName}</bdi> : "دبیر هنوز مشخص نشده"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A student without an active enrollment — every «کلاس من» surface says the same thing. */
export function NoClassYet() {
  return <EmptyState title="هنوز در کلاسی ثبت نشده‌ای." description="وقتی مدرسه تو را در کلاسی ثبت کند، برنامه و درس‌هایت همین‌جا می‌آید." />;
}
