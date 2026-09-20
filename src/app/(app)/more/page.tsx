import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { requireContext } from "@/lib/ctx";
import { formatNumberFa } from "@/lib/format";
import { logoutAction, logoutAllAction } from "@/modules/iam/actions";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "بیشتر | سامانهٴ مدرسه" };

const ROLE_NAMES: Record<string, string> = {
  org_admin: "مدیر سازمان",
  school_principal: "مدیر مدرسه",
  vice_principal: "معاون",
  teacher: "معلم",
  student: "دانش‌آموز",
  guardian_full: "ولی",
  principal: "مدیر",
};

export default async function MorePage() {
  const ctx = await requireContext();
  const roles = [...new Set(ctx.assignments.map((a) => ROLE_NAMES[a.roleCode] ?? a.roleCode))];
  const teaching = ctx.assignments.filter((a) => a.roleCode === "teacher").length;
  const isAdmin = canAtAnyScope(ctx.assignments, "iam.admin.access");

  return (
    <div className="flex flex-col gap-6 px-4 pt-5 pb-6 md:pt-8">
      <section className="rounded-card bg-surface p-4 shadow-1">
        <p className="text-xl font-bold text-text">
          <bdi>
            {ctx.firstName} {ctx.lastName}
          </bdi>
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {roles.join("، ") || "عضو"}
          {teaching > 1 ? ` · ${formatNumberFa(teaching)} درس` : ""}
        </p>
        <p className="text-sm text-text-muted">
          {ctx.orgName}
          {ctx.schoolName ? ` · ${ctx.schoolName}` : ""}
        </p>
      </section>

      {isAdmin ? (
        <nav aria-label="مدیریت">
          <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
            <MoreLink href="/admin" label="مدیریت مدرسه" hint="ساختار، افراد، حساب‌ها" />
            <MoreLink href="/admin/onboarding" label="راه‌اندازی مدرسه" />
          </ul>
        </nav>
      ) : null}

      <nav aria-label="حساب">
        <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
          <MoreLink href="/change-password" label="تغییر رمز" />
          <MoreLink href="/help" label="راهنما" hint="به‌زودی" />
          <MoreLink href="/privacy" label="حریم خصوصی" hint="به‌زودی" />
          <MoreLink href="/roadmap" label="نقشهٴ راه" hint="فازهای بعدی" />
        </ul>
      </nav>

      <div className="flex flex-col gap-2">
        <LogoutButton action={logoutAction} label="خروج" />
        <LogoutButton action={logoutAllAction} label="خروج از همهٴ دستگاه‌ها" variant="ghost" className="text-text-muted" />
      </div>
    </div>
  );
}

function MoreLink({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-center justify-between gap-3 px-4 text-base text-text transition-colors duration-150 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
        <span>{label}</span>
        <span className="flex items-center gap-2 text-sm text-text-faint">
          {hint}
          <ChevronLeft className="size-4" aria-hidden />
        </span>
      </Link>
    </li>
  );
}
