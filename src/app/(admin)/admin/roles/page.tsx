import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { GrantRoleButton } from "@/components/admin/GrantRoleButton";
import { grantRoleForm } from "@/components/admin/grant-role-form";
import { RevokeRoleButton } from "@/components/admin/RevokeRoleButton";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";
import { roleLabel } from "@/lib/admin/labels";
import { rolesPageQuery } from "@/lib/admin/roles-queries";

export const metadata: Metadata = { title: "نقش‌ها | مدیریت" };

/**
 * What each role does, in the words of a school (owner's polish pass, 2026-09-27: no role codes, permission counts
 * or «دامنه» on this page — it read like a developer screen). A template without an entry keeps its catalog text.
 */
const ROLE_ABOUT: Record<string, string> = {
  org_admin: "همهٴ مدرسه‌های سازمان را مدیریت می‌کند.",
  school_principal: "مدرسهٴ خودش را مدیریت می‌کند: کلاس‌ها، کارکنان، دانش‌آموزان، برنامه و حضور و غیاب.",
  vice_principal: "همان کارهای مدیر مدرسه را در همان مدرسه انجام می‌دهد.",
  teacher: "تکالیف و حضور و غیاب کلاس‌هایی که درس می‌دهد؛ با سپردن درس به او خودکار داده می‌شود.",
  student: "تکالیف، برنامهٴ هفتگی و حضور و غیاب خودش؛ با ثبت‌نام در کلاس خودکار داده می‌شود.",
};

/**
 * /admin/roles — the ONE door for manager roles (owner, 2026-09-27: the staff pages show a colleague's roles, they
 * never change them): «معاون جدید» / «نقش جدید» grants (`GrantRoleButton`, only with something to grant and someone
 * to grant it to), «لغو» revokes where the caller may; then the system roles, read-only.
 */
export default async function RolesPage() {
  const result = await rolesPageQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { templates, assignments, roleGrant, candidates } = result.data;
  const canGrant = roleGrant.roles.length > 0 && candidates.length > 0;
  const grantTitle = grantRoleForm(roleGrant, candidates).title;
  return (
    <div className="flex flex-col gap-5">
      <AdminHeader
        title="نقش‌ها"
        description="نقش مدیر و معاون فقط از همین صفحه داده و لغو می‌شود؛ نقش دبیر و دانش‌آموز خودکار از کلاس‌ها و درس‌ها می‌آید."
        actions={canGrant ? <GrantRoleButton roleGrant={roleGrant} candidates={candidates} /> : null}
      />

      <section aria-labelledby="assignments-heading" className="flex flex-col gap-2">
        <h3 id="assignments-heading" className="text-section font-semibold text-text">
          مدیران و معاونان <span className="tabular">({formatNumberFa(assignments.length)})</span>
        </h3>
        {assignments.length === 0 ? (
          <p className="surface-work px-4 py-6 text-center text-sm text-text-muted">{canGrant ? `هنوز نقش مدیر یا معاونی داده نشده؛ با «${grantTitle}» بدهید.` : "هنوز نقش مدیر یا معاونی داده نشده."}</p>
        ) : (
          <ul className="surface-work divide-y divide-line/70">
            {assignments.map((a) => (
              <li key={a.roleAssignmentId} className="flex min-h-12 items-center justify-between gap-3 px-4 py-1.5">
                <span className="flex min-w-0 flex-col">
                  <Link prefetch={false} href={`/admin/people/${a.personId}`} className="truncate text-row font-medium text-primary-700 hover:underline">
                    <bdi>
                      {a.firstName} {a.lastName}
                    </bdi>
                  </Link>
                  <span className="text-meta text-text-muted">
                    {roleLabel(a.roleCode)}
                    {a.schoolName ? ` — ${a.schoolName}` : a.scopeType === "organization" ? " — سازمان" : ""}
                    {a.validFrom ? ` · از ${isoDateToJalali(a.validFrom)}` : ""}
                  </span>
                </span>
                {a.revocable ? <RevokeRoleButton roleAssignmentId={a.roleAssignmentId} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="templates-heading" className="flex flex-col gap-2">
        <h3 id="templates-heading" className="text-section font-semibold text-text">
          انواع نقش
        </h3>
        <ul className="surface-panel divide-y divide-line">
          {templates.map((t) => (
            <li key={t.code} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-row font-medium text-text">{ROLE_ABOUT[t.code] ? roleLabel(t.code) : t.name}</span>
              </span>
              <span className="text-meta text-text-muted">{ROLE_ABOUT[t.code] ?? t.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
