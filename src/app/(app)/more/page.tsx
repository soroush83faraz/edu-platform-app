import { ChevronLeft, LifeBuoy, LockKeyhole, type LucideIcon, Map, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { RowMark } from "@/components/RowMark";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { requireContext } from "@/lib/ctx";
import { formatLoginIdentifierFa, formatNumberFa } from "@/lib/format";
import { UPCOMING_MODULES } from "@/lib/modules-registry";
import { myLoginIdentifierQuery } from "@/lib/profile-queries";
import { logoutAction } from "@/modules/iam/actions";

export const metadata: Metadata = { title: "بیشتر | سامانهٴ مدرسه" };

const ROLE_NAMES: Record<string, string> = {
  org_admin: "مدیر سازمان",
  school_principal: "مدیر مدرسه",
  vice_principal: "معاون",
  teacher: "دبیر",
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

  return (
    <ContentWidth className="reveal-stagger gap-6">
      <PageHeader title="بیشتر" />
      <section className="surface-work flex items-center gap-4 p-4">
        <RowMark icon={UserRound} size="lg" />
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

      {/* Nothing under /admin is listed here (owner, QA round 3 — «one home per destination», docs/decisions.md):
          «مدیریت» is the nav's role item, and «راه‌اندازی مدرسه» is the organization admin's own entry inside the
          management hub (the admin nav + the setup panel on /admin). «بیشتر» is the account, not a second door. */}
      <nav aria-label="حساب">
        <ul className="surface-work divide-y divide-line/70">
          <MoreLink href="/change-password" icon={LockKeyhole} label="تغییر رمز" />
          <MoreLink href="/help" icon={LifeBuoy} label="راهنما" hint="ورود، پنل من، مدیریت" />
          <MoreLink href="/privacy" icon={ShieldCheck} label="حریم خصوصی" hint="چه داده‌ای، چرا، کجا" />
          <MoreLink href="/roadmap" icon={Map} label="نقشهٴ راه" hint={UPCOMING_HINT} />
        </ul>
      </nav>

      {/* Only «خروج» for now (owner, QA round 2): «خروج از همهٴ دستگاه‌ها» is unmounted; `logoutAllAction` /
          `revokeAllForUser` stay for the service paths (password change, admin reset, `pnpm sessions:revoke`). */}
      <nav aria-label="خروج">
        <ul className="surface-work divide-y divide-line/70">
          <LogoutButton action={logoutAction} label="خروج" mark="device" />
        </ul>
      </nav>
    </ContentWidth>
  );
}

/** One row of a «بیشتر» list: the quiet glyph, label, hint, chevron. */
function MoreLink({ href, icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="pressable flex min-h-14 items-center gap-3 px-3 py-2 text-row text-text first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
        <RowMark icon={icon} />
        <span className="shrink-0">{label}</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-sm text-text-faint">
          <span className="truncate">{hint}</span>
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
        </span>
      </Link>
    </li>
  );
}
