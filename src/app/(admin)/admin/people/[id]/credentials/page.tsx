import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { CredentialsSheet } from "@/components/admin/CredentialsSheet";
import { personCredentialsQuery } from "@/lib/admin/people-queries";

export const metadata: Metadata = { title: "اعتبارنامه | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PersonCredentialsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await personCredentialsQuery({ personId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { schoolName, row } = result.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print">
        <AdminHeader title="اعتبارنامهٴ ورود" back={{ href: `/admin/people/${id}`, label: `${row.firstName} ${row.lastName}` }} />
      </div>
      <CredentialsSheet title={`${row.firstName} ${row.lastName}`} schoolName={schoolName} rows={[row]} />
    </div>
  );
}
