import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { AppShell } from "@/components/shell/AppShell";
import { adminNavItems, getAdminShell } from "@/lib/admin/admin-shell";
import { getRequestContext, loginRedirectHref } from "@/lib/ctx";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "مدیریت" };

/**
 * /admin shell: same frame as (app), plus the admin sections — nested under «مدیریت» in the desktop rail, a pill
 * row on phones (organization-only entries hidden from school-scoped admins — `adminNavItems`). Gate: `iam.admin.access` held at ANY scope (org admin, school principal,
 * vice principal) — everyone else gets the not-found page, and every admin action and query re-checks the
 * permission and the scope rule on its own (the layout is not a security boundary). A present-but-dead cookie
 * lands on /login with the requested page as `?next=` (the same rule as the proxy's cookie-less redirect).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect(await loginRedirectHref());
  if (ctx.mustChangePassword) redirect("/change-password");
  if (!canAtAnyScope(ctx.assignments, "iam.admin.access")) notFound();
  // One cached overview read: the scope («مدرسه» vs «مدرسه‌ها») and the section counts for both navs.
  const items = adminNavItems(ctx.assignments, await getAdminShell());
  return (
    <AppShell ctx={ctx} adminItems={items}>
      <ContentWidth className="gap-4 pt-3 lg:pt-0">
        <AdminNav items={items} />
        {children}
      </ContentWidth>
    </AppShell>
  );
}
