import { redirect } from "next/navigation";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { Attention } from "@/components/admin/Attention";
import { adminNavItems, getAdminShell } from "@/lib/admin/admin-shell";
import { requireContext } from "@/lib/ctx";

/**
 * /admin — the management hub's landing page, and the ONE place the school's management overview lives (Home is
 * the person's own work; docs/decisions.md «one home per destination»): the counters, «نیازمند توجه» with the
 * fixable problems, then the way into each section — «راه‌اندازی مدرسه» among them, as an ordinary section row
 * (round 7), not a panel of its own. One cached overview read, shared with the layout's navs.
 */
export default async function AdminIndexPage() {
  const ctx = await requireContext();
  const shell = await getAdminShell();
  if (!shell.scope || !shell.counts) redirect("/home");
  const counts = shell.counts;
  return (
    <AdminOverview data={{ scope: shell.scope, counts, schools: shell.schools }} items={adminNavItems(ctx.assignments, shell)}>
      <Attention counts={counts} />
    </AdminOverview>
  );
}
