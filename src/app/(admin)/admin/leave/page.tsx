import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { leaveQueueQuery, todaysEarlyExitsQuery } from "@/modules/academic/leave-queries";
import { attendanceClassesQuery } from "@/modules/academic/queries";
import { DecidedLeaves, PendingLeaves, TodaysExits } from "@/modules/academic/ui/LeaveQueueList";

export const metadata: Metadata = { title: "درخواست‌های مرخصی | مدیریت" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * «درخواست‌های مرخصی» of the management hub (owner, 2026-10-20): the queue of the guardians' leave requests of the
 * caller's schools — pending ones to approve or reject, the last weeks' answers below — and today's «خروج مجاز»
 * list. An authorized exit is recorded from the class's roll-call page (the button on each student's row), the
 * "classes" door below points there. `?school=<id>` (the school hub's door) narrows both lists to that ONE school,
 * validated on the server against the permission's scope (out of scope → 404).
 */
export default async function AdminLeavePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const schoolParam = one(sp.school);
  if (schoolParam && !UUID_RE.test(schoolParam)) notFound();
  const filter = schoolParam ? { schoolId: schoolParam } : {};

  const queue = await leaveQueueQuery(filter);
  if (!queue.ok) {
    if (queue.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const exits = await todaysEarlyExitsQuery(filter);
  const classes = await attendanceClassesQuery(filter);
  const { school, pending, recent } = queue.data;
  const schoolIds = new Set([...pending, ...recent].map((r) => r.schoolId));
  const showSchool = !school && schoolIds.size > 1;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          school ? (
            <>
              درخواست‌های مرخصی <span className="text-text-muted">·</span> <bdi>{school.name}</bdi>
            </>
          ) : (
            "درخواست‌های مرخصی"
          )
        }
        back={school ? { href: `/admin/schools/${school.id}`, label: school.name } : { href: "/home", label: "خانه" }}
        description="درخواست مرخصی و غیبت موجه که اولیا برای فرزندشان فرستاده‌اند. با تأیید، دانش‌آموز در حضور و غیاب آن روزها «موجه» می‌آید و برای غیبتش به ولی اعلان نمی‌رود."
      />

      <PageSection id="pending-leaves" title="در انتظار بررسی" count={pending.length}>
        {pending.length === 0 ? (
          <EmptyState title="درخواستی در انتظار نیست" description="درخواست تازهٴ اولیا همین‌جا می‌آید و خبرش را در اعلان‌ها می‌بینید." className="surface-work py-10" />
        ) : (
          <PendingLeaves rows={pending} showSchool={showSchool} />
        )}
      </PageSection>

      <PageSection id="early-exits" title="خروج مجاز امروز" count={exits.ok ? exits.data.length : undefined}>
        {exits.ok && exits.data.length > 0 ? (
          <TodaysExits rows={exits.data} showSchool={showSchool} />
        ) : (
          <p className="surface-panel px-4 py-3 text-sm text-text-muted">امروز خروج مجازی ثبت نشده است.</p>
        )}
      </PageSection>

      {classes.ok && classes.data.length > 0 ? (
        <PageSection id="record-exit" title="ثبت خروج مجاز" surface="panel">
          <p className="mb-3 text-meta text-text-muted">کلاس دانش‌آموز را باز کنید و روی علامت در کنار نامش بزنید.</p>
          <ul className="flex flex-wrap gap-2">
            {classes.data.map((c) => (
              <li key={c.id}>
                <Link
                  prefetch={false}
                  href={`/attendance/${c.id}`}
                  className="pressable inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface px-4 text-sm text-text hover:bg-surface-sunken"
                >
                  <bdi>{c.name}</bdi>
                  {showSchool ? (
                    <span className="text-meta text-text-muted">
                      · <bdi>{c.schoolName}</bdi>
                    </span>
                  ) : null}
                  <ChevronLeft className="size-4 text-text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {recent.length > 0 ? (
        <PageSection id="recent-leaves" title="پاسخ‌های اخیر" count={recent.length}>
          <DecidedLeaves rows={recent} showSchool={showSchool} />
        </PageSection>
      ) : null}
    </div>
  );
}
