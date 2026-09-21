import { ArrowRight, BookOpen, School, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { IconChip } from "@/components/IconChip";
import { SchoolClay } from "@/components/illustrations";
import { formatNumberFa } from "@/lib/format";
import { myClassQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "کلاس من | سامانهٴ مدرسه" };

/** «کلاس من»: the class and school, how many classmates, and who teaches each درس. One query, read-only. */
export default async function MyClassPage() {
  const result = await myClassQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس من در دسترس نیست" description={result.message} />;
  }
  const cls = result.data;
  return (
    <div className="reveal-stagger flex flex-col gap-5 px-4 pt-3 pb-8 md:pt-6">
      <Link href="/home" className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
        <ArrowRight className="size-4" aria-hidden />
        خانه
      </Link>

      {cls === null ? (
        <EmptyState illustration={<SchoolClay size={112} />} title="هنوز در کلاسی ثبت نشده‌اید" description="وقتی مدرسه شما را در کلاس ثبت کند، همین‌جا می‌بینید." />
      ) : (
        <>
          <section aria-label="کلاس" className="flex flex-col items-center gap-1 rounded-card bg-info-soft px-4 pt-4 pb-4 text-center">
            <SchoolClay size={56} />
            <h2 className="mt-1 text-xl font-bold leading-8 text-primary-900">
              کلاس <bdi>{cls.classGroupName}</bdi>
            </h2>
            <p className="text-sm text-primary-800/80">
              <bdi>{cls.schoolName}</bdi>
            </p>
          </section>

          <Card>
            <dl className="grid grid-cols-2 divide-x divide-line/70">
              <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
                <IconChip icon={Users} size="lg" />
                <dt className="text-xs text-text-muted">هم‌کلاسی‌ها</dt>
                <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.classmates)}</dd>
              </div>
              <div className="flex flex-col items-center gap-1.5 px-2 py-4 text-center">
                <IconChip icon={BookOpen} size="lg" tone="sky" />
                <dt className="text-xs text-text-muted">درس‌ها</dt>
                <dd className="tabular text-lg font-semibold leading-6 text-text">{formatNumberFa(cls.teachers.length)}</dd>
              </div>
            </dl>
          </Card>

          <section aria-labelledby="teachers-heading" className="flex flex-col gap-2.5">
            <h3 id="teachers-heading" className="px-1 text-sm font-semibold text-text-muted">
              معلم‌های کلاس
            </h3>
            <Card>
              {cls.teachers.length === 0 ? (
                <p className="px-4 py-5 text-sm text-text-muted">هنوز درسی برای این کلاس تعریف نشده.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {cls.teachers.map((t) => (
                    <li key={t.offeringId} className="flex min-h-14 items-center gap-3 px-3 py-2">
                      <IconChip icon={School} size="sm" tone={t.teacherName ? "primary" : "muted"} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="truncate text-sm font-medium text-text">
                          <bdi>{t.subjectName}</bdi>
                        </p>
                        <p className="truncate text-xs text-text-muted">{t.teacherName ? <bdi>{t.teacherName}</bdi> : "معلم هنوز مشخص نشده"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
