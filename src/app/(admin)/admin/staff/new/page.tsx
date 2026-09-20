import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { StaffForm } from "@/components/admin/StaffForm";
import { requireContext } from "@/lib/ctx";
import { peopleFormOptionsQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "همکار جدید | مدیریت" };

export default async function NewStaffPage() {
  const ctx = await requireContext();
  if (!canAtAnyScope(ctx.assignments, "iam.person.write")) notFound();
  const opts = await peopleFormOptionsQuery();
  if (!opts.ok) {
    if (opts.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const canGrantOrgRoles = opts.data.scope.kind === "organization" && canAtAnyScope(ctx.assignments, "iam.role_assignment.write");
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title="همکار جدید" back={{ href: "/admin/staff", label: "کارکنان" }} description="حساب کاربری با شمارهٴ موبایل ساخته می‌شود و رمز اولیه یک‌بار نمایش داده می‌شود." />
      <div className="rounded-card border border-line bg-surface p-4">
        <StaffForm schools={opts.data.schools} canGrantOrgRoles={canGrantOrgRoles} />
      </div>
    </div>
  );
}
