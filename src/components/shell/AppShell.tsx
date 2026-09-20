import { AppNav } from "@/components/shell/AppNav";
import type { Ctx } from "@/lib/ctx";
import { canAtAnyScope } from "@/modules/iam/can";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

/**
 * The signed-in frame shared by the (app) and (admin) route groups: nav (bottom bar / start rail) with the
 * initial badge counts, the mobile header, and the content column. `wide` widens the column for admin tables.
 */
export async function AppShell({ ctx, children, wide = false }: { ctx: Ctx; children: React.ReactNode; wide?: boolean }) {
  const summary = await inboxSummaryQuery();
  const initial = summary.ok ? summary.data : { overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 0 };
  const title = ctx.schoolName ?? ctx.orgName;
  const showAdmin = canAtAnyScope(ctx.assignments, "iam.admin.access");

  return (
    <div className="flex min-h-full flex-1 bg-surface-sunken">
      <AppNav initial={initial} schoolName={title} showAdmin={showAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-line bg-surface px-4 md:hidden">
          <h1 className="truncate text-base font-semibold text-text">{title}</h1>
        </header>
        <main className={`mx-auto w-full flex-1 pb-24 md:pb-8 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</main>
      </div>
    </div>
  );
}
