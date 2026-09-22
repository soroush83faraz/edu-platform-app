import { BookOpen } from "lucide-react";
import { AppNav } from "@/components/shell/AppNav";
import { InboxSummaryProvider } from "@/components/shell/InboxSummaryProvider";
import type { AdminNavItem } from "@/lib/admin/nav";
import type { Ctx } from "@/lib/ctx";
import { navRoleFor } from "@/modules/iam/can";
import { productName } from "@/lib/product";
import { getShellContext } from "@/lib/shell-context";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

/**
 * The signed-in frame shared by the (app) and (admin) route groups: the summary provider (server-rendered initial
 * counts, one client poller), nav (bottom bar / start rail), the mobile header, and the content column; pages cap
 * their own width with `ContentWidth` (1200 px, or the reading measure). The admin layout passes `adminItems`
 * (sections with counts) so the rail can nest them under «مدیریت».
 */
export async function AppShell({ ctx, children, adminItems }: { ctx: Ctx; children: React.ReactNode; adminItems?: readonly AdminNavItem[] }) {
  const summary = await inboxSummaryQuery();
  const initial = summary.ok ? summary.data : { overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 0 };
  // An admin whose scope holds more than one school is introduced by the ORGANIZATION, never by whichever school
  // sorts first (owner, QA round 3); the cached shell context already knows (`getShellContext`, no extra query).
  const shell = await getShellContext();
  const title = (shell.schools.length > 1 ? ctx.orgName : ctx.schoolName) ?? ctx.orgName;
  // The nav's role item («مدیریت» / «کلاس‌ها» / «کلاس من»), decided once here from the session — no query.
  const navRole = navRoleFor(ctx.assignments);

  return (
    <InboxSummaryProvider initial={initial}>
    <div className="flex min-h-full flex-1 bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-lg focus:bg-primary-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        پرش به محتوا
      </a>
      <h1 className="sr-only">{title}</h1>
      <AppNav schoolName={title} productName={productName()} role={navRole} adminItems={adminItems} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 bg-canvas/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-sm lg:hidden">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xl bg-hero text-white shadow-1">
            <BookOpen className="size-4" />
          </span>
          <p className="truncate text-base font-semibold text-text">{title}</p>
        </header>
        <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col pb-24 outline-none lg:pb-8">
          {children}
        </main>
      </div>
    </div>
    </InboxSummaryProvider>
  );
}
