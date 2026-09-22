import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { RevokeRoleButton } from "@/components/admin/RevokeRoleButton";
import { Chip } from "@/components/Chip";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";
import { rolesPageQuery } from "@/lib/admin/roles-queries";

export const metadata: Metadata = { title: "نقش‌ها | مدیریت" };

const SCOPE_LABELS: Record<string, string> = { organization: "سازمان", school: "مدرسه", branch: "شعبه", class_group: "کلاس", class_offering: "کلاس‌درس", student: "دانش‌آموز", family: "خانواده" };

/** /admin/roles — system roles (read-only) and the manual manager assignments of the scope. */
export default async function RolesPage() {
  const result = await rolesPageQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { templates, assignments } = result.data;
  return (
    <div className="flex flex-col gap-5">
      <AdminHeader title="نقش‌ها" description="نقش‌های سیستمی ثابت‌اند. نقش مدیر/معاون از صفحهٴ هر همکار داده می‌شود؛ نقش معلم و دانش‌آموز خودکار است." />

      <section aria-labelledby="assignments-heading" className="flex flex-col gap-2">
        <h3 id="assignments-heading" className="text-section font-semibold text-text">
          تخصیص‌های مدیریتی <span className="tabular">({formatNumberFa(assignments.length)})</span>
        </h3>
        {assignments.length === 0 ? (
          <p className="surface-work px-4 py-6 text-center text-sm text-text-muted">هنوز نقش مدیر یا معاونی داده نشده؛ از صفحهٴ هر همکار می‌دهید.</p>
        ) : (
          <ul className="surface-work divide-y divide-line/70">
            {assignments.map((a) => (
              <li key={a.roleAssignmentId} className="flex min-h-12 items-center justify-between gap-3 px-4 py-1.5">
                <span className="flex min-w-0 flex-col">
                  <Link href={`/admin/people/${a.personId}`} className="truncate text-row font-medium text-primary-700 hover:underline">
                    <bdi>
                      {a.firstName} {a.lastName}
                    </bdi>
                  </Link>
                  <span className="text-meta text-text-muted">
                    {a.roleName}
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
          نقش‌های سیستمی
        </h3>
        <ul className="surface-panel divide-y divide-line">
          {templates.map((t) => (
            <li key={t.code} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-row font-medium text-text">{t.name}</span>
                <Chip tone="neutral">
                  <bdi dir="ltr">{t.code}</bdi>
                </Chip>
                <span className="tabular text-meta text-text-muted">{formatNumberFa(t.permissions)} مجوز</span>
              </span>
              <span className="text-meta text-text-muted">
                {t.description}
                {" · دامنه: "}
                {t.allowedScopeTypes.map((s) => SCOPE_LABELS[s] ?? s).join("، ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
