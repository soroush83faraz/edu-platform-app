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
  // No role picker on this form (owner, 2026-09-27): a manager role is given afterwards, on /admin/roles only. The
  // sentence about it is for the callers who can give one; the server never trusted the form for it anyway.
  const rolesNote = canAtAnyScope(ctx.assignments, "iam.role_assignment.write") ? " نقش مدیر یا معاون را بعد از ثبت، از بخش «نقش‌ها» بدهید." : "";
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title="همکار جدید" back={{ href: "/admin/staff", label: "کارکنان" }} description={`حساب کاربری با شمارهٴ موبایل ساخته می‌شود و رمز اولیه یک‌بار نمایش داده می‌شود.${rolesNote}`} />
      <div className="surface-work p-4">
        <StaffForm schools={opts.data.schools} />
      </div>
    </div>
  );
}
