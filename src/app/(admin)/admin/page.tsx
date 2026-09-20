import { redirect } from "next/navigation";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { adminOverviewQuery } from "@/lib/admin/overview";

/** /admin — counters and the way into each section. */
export default async function AdminIndexPage() {
  const result = await adminOverviewQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    redirect("/home");
  }
  return <AdminOverview data={result.data} />;
}
