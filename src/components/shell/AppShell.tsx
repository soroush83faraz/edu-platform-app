import { DoninoMark } from "@/components/brand/DoninoMark";
import { NotificationsBell } from "@/components/home/NotificationsBell";
import { RoleMark } from "@/components/brand/RoleMark";
import { roleHatsFor } from "@/components/brand/roles";
import { AppNav } from "@/components/shell/AppNav";
import { InboxSummaryProvider } from "@/components/shell/InboxSummaryProvider";
import { ProfileButton } from "@/components/shell/ProfileButton";
import type { AdminNavItem } from "@/lib/admin/nav";
import type { Ctx } from "@/lib/ctx";
import { navRoleFor } from "@/modules/iam/can";
import { getShellContext } from "@/lib/shell-context";
import { getUiVariant } from "@/lib/ui-variant";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

/**
 * The signed-in frame shared by the (app) and (admin) route groups: the summary provider (server-rendered initial
 * counts, one client poller), nav (bottom bar / start rail), the mobile header — whose start corner carries the
 * ROLE MARK, the emblem that says which hat you are signed in with — and the content column; pages cap
 * their own width with `ContentWidth` (1200 px, or the reading measure). The admin layout passes `adminItems`
 * (sections with counts) so the rail can nest them under «مدیریت».
 * The experimental «hub» layout (`getUiVariant`, owner trial — docs/decisions-pending/home-hub.md) swaps the nav and
 * the mobile header for ONE top bar on every size: the profile avatar (→ «بیشتر») at the start, the bell at the end,
 * no school name, no bottom bar or rail (so no bottom padding reserved for it). «classic» renders exactly as before.
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
  // The hats the top-start emblem speaks for, from the same assignments — «مدیر سازمان» / «مدیر مدرسه» / «معاون» /
  // «دبیر» / «دانش‌آموز». Still no query; `navRoleFor` collapses the three admin hats, this does not.
  const hats = roleHatsFor(ctx.assignments);
  const hub = (await getUiVariant()) === "hub";

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
      {hub ? null : <AppNav schoolName={title} role={navRole} hats={hats} adminItems={adminItems} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {hub ? (
          <header className="sticky top-0 z-10 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 bg-canvas/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-sm lg:h-[calc(4rem+env(safe-area-inset-top))] lg:px-8">
            <ProfileButton firstName={ctx.firstName} />
            <NotificationsBell />
          </header>
        ) : (
          <header className="sticky top-0 z-10 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 bg-canvas/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-sm lg:hidden">
            {/* The square that stood for the school is now the ROLE mark (owner): same place, same 32 px, glyph
                swapped for the hat's — the school NAME beside it is untouched. No chip, no second element. */}
            {hats.length > 0 ? <RoleMark hats={hats} /> : <DoninoMark size={32} />}
            <p className="truncate text-base font-semibold text-text">{title}</p>
          </header>
        )}
        <main id="main" tabIndex={-1} className={hub ? "flex w-full flex-1 flex-col pb-8 outline-none" : "flex w-full flex-1 flex-col pb-24 outline-none lg:pb-8"}>
          {children}
        </main>
      </div>
    </div>
    </InboxSummaryProvider>
  );
}
