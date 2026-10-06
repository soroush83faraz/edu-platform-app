import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { AccountCard, EnrollmentCard, RolesCard } from "@/components/admin/PersonPanels";
import { RemovePersonCard } from "@/components/admin/RemovePersonCard";
import { StaffForm } from "@/components/admin/StaffForm";
import { StudentForm } from "@/components/admin/StudentForm";
import { TeachingCard } from "@/components/admin/TeachingCard";
import { Chip } from "@/components/Chip";
import { requireContext } from "@/lib/ctx";
import { formatPhoneFa, toFaDigits } from "@/lib/format";
import { personDetailQuery, teachingOptionsQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "پروندهٴ فرد | مدیریت" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/people/[id] — the one page for a student or a staff member: edit, account, class, teaching (+ «افزودن تدریس»),
 * roles (read-only) and, last and apart, «حذف دانش‌آموز» / «حذف از کارکنان» when the server says the caller may.
 * A person already removed (reachable by organization admins and their primary school's managers) reads as history:
 * a notice, the facts, no control — every write on them is refused server-side anyway («این شخص حذف شده است.»).
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const ctx = await requireContext();
  const result = await personDetailQuery({ personId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { detail, classes, schools, removable } = result.data;
  const removed = detail.status !== "active";
  const has = (p: Parameters<typeof canAtAnyScope>[1]) => !removed && canAtAnyScope(ctx.assignments, p);
  const caps = {
    canReset: has("iam.account.reset_password"),
    canUnlock: has("iam.account.unlock"),
    canWritePerson: has("iam.person.write"),
    canEnroll: has("academic.enrollment.write"),
    canRoles: has("iam.role_assignment.write"),
    canTeaching: has("academic.teacher_assignment.write"),
  };
  const isStudent = detail.kind === "student";
  // «افزودن تدریس» options only for a colleague and a caller who may assign teachers (the action re-checks everything).
  const teachingOptions = detail.kind === "staff" && caps.canTeaching ? await teachingOptionsQuery() : null;
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={`${detail.firstName} ${detail.lastName}`}
        back={isStudent ? { href: "/admin/students", label: "دانش‌آموزان" } : { href: "/admin/staff", label: "کارکنان" }}
        actions={
          <>
            <Chip tone={isStudent ? "primary" : "neutral"}>{isStudent ? "دانش‌آموز" : detail.kind === "staff" ? "کادر" : "فرد"}</Chip>
            {removed ? <Chip tone="neutral">حذف‌شده</Chip> : null}
            {detail.student ? (
              <Chip tone="neutral">
                <bdi dir="ltr" className="tabular">
                  {toFaDigits(detail.student.studentNumber)}
                </bdi>
              </Chip>
            ) : null}
          </>
        }
      />
      {removed ? (
        <section className="surface-panel p-4 text-sm text-text">
          این شخص حذف شده است: در فهرست‌ها و کلاس‌ها نیست و نمی‌تواند وارد سامانه شود. سوابق تکالیف و حضور و غیاب او نگه داشته شده است.
        </section>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="flex flex-col gap-4">
          {caps.canWritePerson ? (
            <section aria-labelledby="edit-heading" className="surface-work p-4">
              <h3 id="edit-heading" className="mb-3 text-sm font-semibold text-text-muted">
                مشخصات
              </h3>
              {isStudent ? <StudentForm classes={classes} schools={schools} detail={detail} /> : <StaffForm schools={schools} detail={detail} />}
            </section>
          ) : (
            <section className="surface-work p-4 text-sm text-text">
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
                      <bdi dir="ltr">{formatPhoneFa(detail.contactPhone)}</bdi>
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
          )}
          {detail.kind === "staff" && !removed ? <TeachingCard detail={detail} canTeaching={caps.canTeaching} options={teachingOptions?.ok ? teachingOptions.data : null} /> : null}
        </div>
        <div className="flex flex-col gap-4">
          <AccountCard detail={detail} caps={caps} />
          {isStudent && !removed ? <EnrollmentCard detail={detail} classes={classes} canEnroll={caps.canEnroll} /> : null}
          {/* Roles are shown here, never changed here: /admin/roles is their one door (owner, 2026-09-27). */}
          {detail.kind === "staff" && !removed ? <RolesCard detail={detail} caps={caps} /> : null}
        </div>
      </div>
      {/* Last and apart from everything else: only when the removal service would accept it (`removable`). */}
      {removable && !removed && (detail.kind === "student" || detail.kind === "staff") ? (
        <RemovePersonCard personId={detail.id} name={`${detail.firstName} ${detail.lastName}`} kind={detail.kind} />
      ) : null}
    </div>
  );
}
