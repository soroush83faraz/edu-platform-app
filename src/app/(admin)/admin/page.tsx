import { redirect } from "next/navigation";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { adminNavItems, getAdminShell } from "@/lib/admin/admin-shell";
import { requireContext } from "@/lib/ctx";

/** /admin — counters and the way into each section (the same cached overview read the layout's nav uses). */
export default async function AdminIndexPage() {
  const ctx = await requireContext();
  const shell = await getAdminShell();
  if (!shell.scope || !shell.counts) redirect("/home");
  return <AdminOverview data={{ scope: shell.scope, counts: shell.counts }} items={adminNavItems(ctx.assignments, shell)} />;
}
