import { ChevronLeft, LifeBuoy, LockKeyhole, type LucideIcon, Map, Rocket, Settings2, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClayIcon } from "@/components/ClayIcon";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { requireContext } from "@/lib/ctx";
import { formatLoginIdentifierFa, formatNumberFa } from "@/lib/format";
import { UPCOMING_MODULES } from "@/lib/modules-registry";
import { myLoginIdentifierQuery } from "@/lib/profile-queries";
import { logoutAction } from "@/modules/iam/actions";
import { canAtAnyScope, isOrganizationAdmin } from "@/modules/iam/can";

export const metadata: Metadata = { title: "بیشتر | سامانهٴ مدرسه" };

const ROLE_NAMES: Record<string, string> = {
  org_admin: "مدیر سازمان",
  school_principal: "مدیر مدرسه",
  vice_principal: "معاون",
  teacher: "معلم",
  student: "دانش‌آموز",
  principal: "مدیر",
};
/** Phase-2 roles nobody holds yet; never shown as a name. */
const HIDDEN_ROLES = new Set(["guardian_full"]);

/** «به‌زودی: تکالیف، دفتر کلاسی» — the next phase's first two modules as the roadmap link's hint (fits a 390 px row). */
const UPCOMING_HINT = `به‌زودی: ${UPCOMING_MODULES.slice(0, 2)
  .map((m) => m.labelFa)
  .join("، ")}`;

export default async function MorePage() {
  const ctx = await requireContext();
  const roles = [...new Set(ctx.assignments.filter((a) => !HIDDEN_ROLES.has(a.roleCode)).map((a) => ROLE_NAMES[a.roleCode] ?? a.roleCode))];
  const login = await myLoginIdentifierQuery();
  const loginIdentifier = login.ok ? login.data : null;
  const teaching = ctx.assignments.filter((a) => a.roleCode === "teacher").length;
  const isAdmin = canAtAnyScope(ctx.assignments, "iam.admin.access");
  // School setup belongs to whoever defines schools — the organization admin (owner's rule, docs/admin.md).
  const isOrgAdmin = isOrganizationAdmin(ctx.assignments);

  return (
    <ContentWidth className="reveal-stagger gap-6">
      <PageHeader title="بیشتر" />
      <section className="surface-work flex items-center gap-4 p-4">
        <ClayIcon icon={UserRound} size="lg" />
        <div className="flex min-w-0 flex-col">
          <p className="text-xl font-bold text-text">
            <bdi>
              {ctx.firstName} {ctx.lastName}
            </bdi>
          </p>
          <p className="text-sm text-text-muted">
            {roles.join("، ") || "عضو"}
            {teaching > 1 ? ` · ${formatNumberFa(teaching)} درس` : ""}
          </p>
          <p className="text-sm text-text-muted">
            {ctx.orgName}
            {ctx.schoolName ? ` · ${ctx.schoolName}` : ""}
          </p>
          {loginIdentifier ? (
            <p className="text-sm text-text-muted">
              شناسهٴ ورود:{" "}
              <bdi dir="ltr" className="tabular text-text">
                {formatLoginIdentifierFa(loginIdentifier)}
              </bdi>
            </p>
          ) : null}
        </div>
      </section>

      {isAdmin ? (
        <nav aria-label="مدیریت">
          <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
            <MoreLink href="/admin" icon={Settings2} label="مدیریت مدرسه" hint="ساختار، افراد، حساب‌ها" />
            {isOrgAdmin ? <MoreLink href="/admin/onboarding" icon={Rocket} label="راه‌اندازی مدرسه" /> : null}
          </ul>
        </nav>
      ) : null}

      <nav aria-label="حساب">
        <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
          <MoreLink href="/change-password" icon={LockKeyhole} label="تغییر رمز" />
          <MoreLink href="/help" icon={LifeBuoy} label="راهنما" hint="ورود، پنل من، مدیریت" />
          <MoreLink href="/privacy" icon={ShieldCheck} label="حریم خصوصی" hint="چه داده‌ای، چرا، کجا" />
          <MoreLink href="/roadmap" icon={Map} label="نقشهٴ راه" hint={UPCOMING_HINT} />
        </ul>
      </nav>

      {/* Only «خروج» for now (owner, QA round 2): «خروج از همهٴ دستگاه‌ها» is unmounted; `logoutAllAction` /
          `revokeAllForUser` stay for the service paths (password change, admin reset, `pnpm sessions:revoke`). */}
      <nav aria-label="خروج">
        <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
          <LogoutButton action={logoutAction} label="خروج" mark="device" />
        </ul>
      </nav>
    </ContentWidth>
  );
}

/** One row of a «بیشتر» list: the blue clay mark, label, hint, chevron. */
function MoreLink({ href, icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="pressable flex min-h-14 items-center gap-3 px-3 py-2 text-base text-text first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
        <ClayIcon icon={icon} />
        <span className="shrink-0">{label}</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-sm text-text-faint">
          <span className="truncate">{hint}</span>
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
        </span>
      </Link>
    </li>
  );
}
