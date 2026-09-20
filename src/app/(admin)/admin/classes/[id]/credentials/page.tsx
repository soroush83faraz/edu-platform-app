import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { CredentialsSheet } from "@/components/admin/CredentialsSheet";
import { classCredentialsQuery } from "@/lib/admin/people-queries";

export const metadata: Metadata = { title: "اعتبارنامه‌های کلاس | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassCredentialsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await classCredentialsQuery({ classGroupId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { className, schoolName, rows } = result.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print">
        <AdminHeader title={`اعتبارنامه‌های کلاس ${className}`} back={{ href: `/admin/classes/${id}`, label: `کلاس ${className}` }} />
      </div>
      <CredentialsSheet title={`کلاس ${className}`} schoolName={schoolName} rows={rows} />
    </div>
  );
}
