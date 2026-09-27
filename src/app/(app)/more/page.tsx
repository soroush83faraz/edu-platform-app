import { LifeBuoy, LockKeyhole, Map, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { roleHatsFor } from "@/components/brand/roles";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { ProfileRow } from "@/components/profile/ProfileRow";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { requireContext } from "@/lib/ctx";
import { UPCOMING_MODULES } from "@/lib/modules-registry";
import { myLoginIdentifierQuery } from "@/lib/profile-queries";
import { logoutAction } from "@/modules/iam/actions";

export const metadata: Metadata = { title: "حساب من" };

/** «به‌زودی: تکالیف، دفتر کلاسی» — the next phase's first two modules as the roadmap link's hint (fits a 390 px row). */
const UPCOMING_HINT = `به‌زودی: ${UPCOMING_MODULES.slice(0, 2)
  .map((m) => m.labelFa)
  .join("، ")}`;

/**
 * «حساب من» — the account page the hub top bar's profile icon opens (the route stays /more; the kept classic nav
 * still calls it «بیشتر»). No visible title (owner, 2026-09-27): the blue profile card IS the top of the page; the
 * title lives on for assistive tech and the browser tab, and `PageHeader`'s hub default draws the «خانه» back link
 * above the card. Then the destinations in titled groups — each ONE `surface-work` card of rows — and «خروج» apart
 * at the bottom (docs/decisions-pending/home-hub.md).
 */
export default async function MorePage() {
  const ctx = await requireContext();
  const hats = roleHatsFor(ctx.assignments);
  const login = await myLoginIdentifierQuery();
  const teaching = ctx.assignments.filter((a) => a.roleCode === "teacher").length;
  // The organization admin speaks for the organization, everyone else for their school.
  const place = hats[0] === "org_admin" ? ctx.orgName : (ctx.schoolName ?? ctx.orgName);

  return (
    <ContentWidth size="reading" className="reveal-stagger gap-6">
      <PageHeader title="حساب من" hideTitle />
      <ProfileCard firstName={ctx.firstName} lastName={ctx.lastName} hats={hats} teaching={teaching} place={place} loginIdentifier={login.ok ? login.data : null} />

      {/* Nothing under /admin is listed here (owner, QA round 3 — «one home per destination», docs/decisions.md):
          «مدیریت» is the role's own entry, and «راه‌اندازی مدرسه» is the organization admin's own entry inside the
          management hub. This page is the account, not a second door. */}
      <PageSection id="account" title="حساب کاربری" surface="work" flush>
        <ul className="divide-y divide-line/70">
          <ProfileRow href="/change-password" icon={LockKeyhole} label="تغییر رمز" hint="رمز تازه برای ورود به حساب" />
        </ul>
      </PageSection>

      <PageSection id="info" title="راهنما و اطلاعات" surface="work" flush>
        <ul className="divide-y divide-line/70">
          <ProfileRow href="/help" icon={LifeBuoy} label="راهنما" hint="ورود، تکالیف، مدیریت" />
          <ProfileRow href="/privacy" icon={ShieldCheck} label="حریم خصوصی" hint="چه داده‌ای، چه کسی می‌بیند" />
          <ProfileRow href="/roadmap" icon={Map} label="نقشهٴ راه" hint={UPCOMING_HINT} />
        </ul>
      </PageSection>

      {/* Only «خروج» for now (owner, QA round 2): «خروج از همهٴ دستگاه‌ها» is unmounted; `logoutAllAction` /
          `revokeAllForUser` stay for the service paths (password change, admin reset, `pnpm sessions:revoke`). */}
      <nav aria-label="خروج">
        <ul className="surface-work">
          <LogoutButton action={logoutAction} label="خروج" mark="device" />
        </ul>
      </nav>
    </ContentWidth>
  );
}
