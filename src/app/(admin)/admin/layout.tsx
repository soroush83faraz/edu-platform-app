import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { AppShell } from "@/components/shell/AppShell";
import { ADMIN_NAV } from "@/lib/admin/resources";
import { getRequestContext } from "@/lib/ctx";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "مدیریت | سامانهٴ مدرسه" };

/**
 * /admin shell: same frame as (app), plus the admin sub-navigation. Gate: `iam.admin.access` held at ANY scope
 * (org admin, school principal, vice principal) — everyone else gets the not-found page, and every admin action
 * and query re-checks the permission and the scope rule on its own (the layout is not a security boundary).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  if (ctx.mustChangePassword) redirect("/change-password");
  if (!canAtAnyScope(ctx.assignments, "iam.admin.access")) notFound();
  return (
    <AppShell ctx={ctx} wide>
      <div className="flex flex-col gap-4 px-4 pt-4 md:pt-8">
        <AdminNav items={ADMIN_NAV} />
        {children}
      </div>
    </AppShell>
  );
}
