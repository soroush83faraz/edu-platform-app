import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { AccountCard, EnrollmentCard, RolesCard } from "@/components/admin/PersonPanels";
import { StaffForm } from "@/components/admin/StaffForm";
import { StudentForm } from "@/components/admin/StudentForm";
import { Chip } from "@/components/Chip";
import { requireContext } from "@/lib/ctx";
import { personDetailQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "پروندهٴ فرد | مدیریت" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /admin/people/[id] — the one page for a student or a staff member: edit, account, class, roles. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const ctx = await requireContext();
  const result = await personDetailQuery({ personId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { detail, scope, classes, schools } = result.data;
  const has = (p: Parameters<typeof canAtAnyScope>[1]) => canAtAnyScope(ctx.assignments, p);
  const caps = {
    canReset: has("iam.account.reset_password"),
    canUnlock: has("iam.account.unlock"),
    canWritePerson: has("iam.person.write"),
    canEnroll: has("academic.enrollment.write"),
    canRoles: has("iam.role_assignment.write"),
    canTeaching: has("academic.teacher_assignment.write"),
    orgScope: scope.kind === "organization",
  };
  const isStudent = detail.kind === "student";
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={`${detail.firstName} ${detail.lastName}`}
        back={isStudent ? { href: "/admin/students", label: "دانش‌آموزان" } : { href: "/admin/staff", label: "کارکنان" }}
        actions={
          <>
            <Chip tone={isStudent ? "primary" : "neutral"}>{isStudent ? "دانش‌آموز" : detail.kind === "staff" ? "کادر" : "فرد"}</Chip>
            {detail.student ? (
              <Chip tone="neutral">
                <bdi dir="ltr" className="tabular">
                  {detail.student.studentNumber}
                </bdi>
              </Chip>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="flex flex-col gap-4">
          {caps.canWritePerson ? (
            <section aria-labelledby="edit-heading" className="rounded-card bg-surface shadow-1 p-4">
              <h3 id="edit-heading" className="mb-3 text-sm font-semibold text-text-muted">
                مشخصات
              </h3>
              {isStudent ? <StudentForm classes={classes} schools={schools} detail={detail} /> : <StaffForm schools={schools} detail={detail} canGrantOrgRoles={caps.orgScope} />}
            </section>
          ) : (
            <section className="rounded-card bg-surface shadow-1 p-4 text-sm text-text">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-text-muted">نام</dt>
                <dd>
                  <bdi>
                    {detail.firstName} {detail.lastName}
                  </bdi>
                </dd>
                {detail.contactPhone ? (
                  <>
                    <dt className="text-text-muted">موبایل</dt>
                    <dd>
                      <bdi dir="ltr">{detail.contactPhone}</bdi>
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <AccountCard detail={detail} caps={caps} />
          {isStudent ? <EnrollmentCard detail={detail} classes={classes} canEnroll={caps.canEnroll} /> : null}
          {detail.kind === "staff" ? <RolesCard detail={detail} schools={schools} caps={caps} /> : null}
        </div>
      </div>
    </div>
  );
}
