import { redirect } from "next/navigation";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { Attention } from "@/components/admin/Attention";
import { OnboardingProgress } from "@/components/admin/OnboardingProgress";
import { adminNavItems, getAdminShell } from "@/lib/admin/admin-shell";
import { onboardingProgress } from "@/lib/admin/onboarding";
import { requireContext } from "@/lib/ctx";

/**
 * /admin — the management hub's landing page, and the ONE place the school's management overview lives (Home is
 * the person's own work; docs/decisions.md «one home per destination»): the counters, «نیازمند توجه» with the
 * fixable problems, the organization admin's setup progress, then the way into each section. One cached overview
 * read, shared with the layout's navs.
 */
export default async function AdminIndexPage() {
  const ctx = await requireContext();
  const shell = await getAdminShell();
  if (!shell.scope || !shell.counts) redirect("/home");
  const counts = shell.counts;
  const onboarding = shell.scope.kind === "organization" ? onboardingProgress(counts) : null;
  return (
    <AdminOverview data={{ scope: shell.scope, counts, schools: shell.schools }} items={adminNavItems(ctx.assignments, shell)}>
      <Attention counts={counts} />
      {onboarding ? <OnboardingProgress progress={onboarding} /> : null}
    </AdminOverview>
  );
}
