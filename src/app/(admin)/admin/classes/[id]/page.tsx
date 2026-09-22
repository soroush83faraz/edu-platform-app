import { BookOpen, CalendarDays, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/ctx";
import { formatLoginIdentifierFa, formatNumberFa, toFaDigits } from "@/lib/format";
import { classDetailQuery } from "@/lib/admin/class-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "کلاس | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /admin/classes/[id] — the class card: roster (active students), offerings summary, credentials sheet. */
export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const ctx = await requireContext();
  const result = await classDetailQuery({ classGroupId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { cls, roster, offerings } = result.data;
  const canAddStudent = canAtAnyScope(ctx.assignments, "iam.person.write");
  const pendingAccounts = roster.filter((r) => r.mustChangePassword).length;
  const withoutAccount = roster.filter((r) => r.loginIdentifier === null).length;

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={`کلاس ${cls.name}`}
        // The branch is named only when the school actually has more than one — «— مرکزی» on every class said nothing.
        description={`${cls.gradeName} · ${cls.schoolName}${cls.schoolBranches > 1 ? ` — ${cls.branchName}` : ""} · ${cls.yearName}${cls.capacity ? ` · ظرفیت ${formatNumberFa(cls.capacity)}` : ""}`}
        back={{ href: "/admin/classes", label: "کلاس‌ها" }}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/admin/classes/${id}/offerings`}>
                <BookOpen className="size-4" aria-hidden />
                ارائهٴ درس‌ها ({formatNumberFa(offerings.length)})
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/classes/${id}/timetable`}>
                <CalendarDays className="size-4" aria-hidden />
                برنامهٴ هفتگی
              </Link>
            </Button>
            {canAddStudent ? (
              <Button asChild>
                <Link href="/admin/students/new">
                  <Plus className="size-4" aria-hidden />
                  دانش‌آموز جدید
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {offerings.length > 0 ? (
        <section aria-labelledby="offerings-heading" className="surface-panel p-4">
          <h3 id="offerings-heading" className="mb-2 text-section font-semibold text-text">
            درس‌ها و دبیران
          </h3>
          <ul className="flex flex-wrap gap-2 text-sm">
            {offerings.map((o) => (
              <li key={o.id} className="rounded-full border border-line px-3 py-1 text-text">
                {o.subjectName}
                <span className="text-text-muted"> — {o.teacherName ?? <span className="text-warning-text">بدون دبیر</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-card border border-warning/40 bg-warning-soft/40 px-4 py-2 text-sm text-text">
          این کلاس هنوز ارائهٴ درسی ندارد؛ از «ارائهٴ درس‌ها» درس و دبیر اضافه کنید.
        </p>
      )}

      <section aria-labelledby="roster-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="roster-heading" className="text-section font-semibold text-text">
            دانش‌آموزان <span className="tabular">({formatNumberFa(roster.length)})</span>
          </h3>
          <span className="text-meta text-text-muted">
            {pendingAccounts > 0 ? `${formatNumberFa(pendingAccounts)} حساب فعال‌نشده` : null}
            {pendingAccounts > 0 && withoutAccount > 0 ? " · " : null}
            {withoutAccount > 0 ? `${formatNumberFa(withoutAccount)} بدون حساب` : null}
          </span>
        </div>
        {roster.length === 0 ? (
          <EmptyState title="این کلاس هنوز دانش‌آموزی ندارد" description="از «دانش‌آموز جدید» یا صفحهٴ هر دانش‌آموز (انتقال) اضافه کنید." className="surface-work py-10" />
        ) : (
          <ol className="surface-work divide-y divide-line/70">
            {roster.map((r, i) => (
              <li key={r.personId}>
                <Link href={`/admin/people/${r.personId}`} className="flex min-h-12 items-center gap-3 px-4 py-1.5 hover:bg-surface-sunken">
                  <span className="tabular w-6 shrink-0 text-meta text-text-faint">{formatNumberFa(i + 1)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-row text-text">
                      <bdi>
                        {r.firstName} {r.lastName}
                      </bdi>
                    </span>
                    <span className="text-meta text-text-muted">
                      <bdi dir="ltr" className="tabular">
                        {toFaDigits(r.studentNumber)}
                      </bdi>
                      {r.loginIdentifier ? (
                        <>
                          {" · "}
                          <bdi dir="ltr" className="tabular">
                            {formatLoginIdentifierFa(r.loginIdentifier)}
                          </bdi>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {r.loginIdentifier === null ? <Chip tone="neutral">بدون حساب</Chip> : r.accountStatus === "locked" ? <Chip tone="danger">قفل</Chip> : r.mustChangePassword ? <Chip tone="warning">رمز اولیه</Chip> : <Chip tone="success">فعال</Chip>}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
