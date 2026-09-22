import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { schoolPeriodsQuery } from "@/modules/academic/queries";
import { PeriodsEditor } from "@/modules/academic/ui/PeriodsEditor";

export const metadata: Metadata = { title: "زنگ‌بندی مدرسه | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /admin/schools/[id]/periods — the bell schedule of one school (structure: org admin + principal edit, vice reads). */
export default async function SchoolPeriodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await schoolPeriodsQuery({ schoolId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { school, periods, canEdit } = result.data;
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={`زنگ‌بندی ${school.name}`}
        description="ساعت شروع و پایان هر زنگ؛ برنامهٴ هفتگی همهٴ کلاس‌های این مدرسه روی همین زنگ‌ها چیده می‌شود. حداکثر ۱۲ زنگ، بدون هم‌پوشانی."
        back={{ href: `/admin/schools/${school.id}`, label: school.name }}
      />
      <PeriodsEditor schoolId={school.id} initial={periods} canEdit={canEdit} />
    </div>
  );
}
