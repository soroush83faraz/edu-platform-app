import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { StudentForm } from "@/components/admin/StudentForm";
import { requireContext } from "@/lib/ctx";
import { peopleFormOptionsQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "دانش‌آموز جدید | مدیریت" };

export default async function NewStudentPage() {
  const ctx = await requireContext();
  if (!canAtAnyScope(ctx.assignments, "iam.person.write")) notFound();
  const opts = await peopleFormOptionsQuery();
  if (!opts.ok) {
    if (opts.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title="دانش‌آموز جدید" back={{ href: "/admin/students", label: "دانش‌آموزان" }} description="نام، شمارهٴ دانش‌آموزی و (اختیاری) موبایل؛ اگر موبایل ندارد، نام‌کاربری از کد مدرسه ساخته می‌شود." />
      <div className="rounded-card bg-surface shadow-1 p-4">
        <StudentForm classes={opts.data.classes} schools={opts.data.schools} />
      </div>
    </div>
  );
}
