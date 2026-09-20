import { redirect } from "next/navigation";
import { AppNav } from "@/components/shell/AppNav";
import { getRequestContext } from "@/lib/ctx";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

/**
 * The signed-in shell. The context comes from the database (cookie → session → membership), so a stale or
 * forged cookie lands on /login here even if proxy.ts let the request through. The nav gets the initial badge
 * counts server-side; a role without `workspace.work_item.read` simply shows none.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  if (ctx.mustChangePassword) redirect("/change-password");

  const summary = await inboxSummaryQuery();
  const initial = summary.ok ? summary.data : { overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 0 };
  const title = ctx.schoolName ?? ctx.orgName;

  return (
    <div className="flex min-h-full flex-1 bg-surface-sunken">
      <AppNav initial={initial} schoolName={title} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-line bg-surface px-4 md:hidden">
          <h1 className="truncate text-base font-semibold text-text">{title}</h1>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 pb-24 md:pb-8">{children}</main>
      </div>
    </div>
  );
}
