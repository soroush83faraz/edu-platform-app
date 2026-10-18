import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { GuardianCredentialsSheet } from "@/components/admin/GuardianCredentialsSheet";
import { classGuardianCredentialsQuery } from "@/lib/admin/guardian-queries";

export const metadata: Metadata = { title: "برگه‌های ورود اولیا | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «برگه‌های ورود اولیا» of a class — where «ساخت حساب اولیا» lands (and reachable again by its URL). */
export default async function ClassGuardiansSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await classGuardianCredentialsQuery({ classGroupId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { className, schoolName, rows } = result.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print">
        <AdminHeader title={`برگه‌های ورود اولیای کلاس ${className}`} back={{ href: `/admin/classes/${id}`, label: `کلاس ${className}` }} />
      </div>
      <GuardianCredentialsSheet title={`اولیای کلاس ${className}`} schoolName={schoolName} rows={rows} />
    </div>
  );
}
