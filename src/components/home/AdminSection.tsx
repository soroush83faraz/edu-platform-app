import { ChevronLeft, Printer, Settings2, UserPlus } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { onboardingProgress } from "@/lib/admin/onboarding";
import { adminOverviewQuery } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";
import { Card, HomeSection } from "./HomeSection";

/**
 * «مدرسه در یک نگاه»: the four counters an admin checks every day inside ONE card (hairline grid, not four tiles),
 * the onboarding progress as a single row, and the three quick actions of the first weeks.
 */
export async function AdminSection() {
  const overview = await adminOverviewQuery();
  if (!overview.ok) return null;
  const c = overview.data.counts;
  const progress = onboardingProgress(c);
  const counters: Array<{ href: string; label: string; value: number; warn?: boolean }> = [
    { href: "/admin/students", label: "دانش‌آموزان", value: c.students },
    { href: "/admin/staff", label: "کارکنان", value: c.staff },
    { href: "/admin/classes", label: "کلاس‌ها", value: c.classes },
    { href: "/admin/students?pending=1", label: "حساب‌های فعال‌نشده", value: c.accountsPending, warn: c.accountsPending > 0 },
  ];
  const complete = progress.done === progress.total;

  return (
    <HomeSection id="admin" title="مدرسه در یک نگاه" more={{ href: "/admin", label: "مدیریت" }}>
      <Card>
        <ul className="grid grid-cols-2 sm:grid-cols-4">
          {counters.map((t, i) => (
            <li key={t.href} className={cn("border-line/70", i % 2 === 1 && "border-s", i >= 2 && "border-t sm:border-t-0", "sm:border-s sm:first:border-s-0")}>
              <Link href={t.href} className="pressable flex min-h-20 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-surface-sunken">
                <span className={cn("tabular text-2xl font-semibold leading-none", t.value === 0 ? "text-text-faint" : "text-text")}>{formatNumberFa(t.value)}</span>
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  {t.warn ? <span aria-hidden className="size-2 rounded-full bg-warning" /> : null}
                  {t.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link href="/admin/onboarding" className="pressable flex items-center gap-3 border-t border-line/70 px-4 py-3 hover:bg-surface-sunken">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-text">راه‌اندازی مدرسه</span>
              <span className="tabular text-xs text-text-muted">
                {formatNumberFa(progress.done)}/{formatNumberFa(progress.total)}
              </span>
            </div>
            <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="پیشرفت راه‌اندازی">
              <span className={cn("block h-full rounded-full", complete ? "bg-success" : "bg-sky")} style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </span>
          </div>
          <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
        </Link>
      </Card>

      <ul className="grid grid-cols-3 gap-2">
        <Quick href="/admin/students/new" label="افزودن دانش‌آموز" icon={UserPlus} />
        <Quick href="/admin/classes" label="چاپ اعتبارنامه" icon={Printer} />
        <Quick href="/admin" label="مدیریت" icon={Settings2} />
      </ul>
    </HomeSection>
  );
}

function Quick({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }) {
  return (
    <li>
      <Link href={href} className="pressable flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-card bg-info-soft px-2 text-center text-xs font-medium text-primary-900 hover:bg-info/60">
        <Icon className="size-5 text-primary-700" aria-hidden />
        {label}
      </Link>
    </li>
  );
}
