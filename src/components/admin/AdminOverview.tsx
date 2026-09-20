import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { AdminHeader } from "@/components/admin/AdminPage";
import { formatNumberFa } from "@/lib/format";
import type { AdminCounts, AdminOverviewData } from "@/lib/admin/overview";

/** /admin index: four counters that are also links, then every section with a one-line description. */
export function AdminOverview({ data }: { data: AdminOverviewData }) {
  const c = data.counts;
  const sections: Array<{ href: string; title: string; hint: string; count?: number }> = [
    { href: "/admin/schools", title: "مدرسه‌ها و شعبه‌ها", hint: "نام، کد، جنسیت", count: c.schools },
    { href: "/admin/years", title: "سال‌های تحصیلی و نوبت‌ها", hint: "سال جاری هر مدرسه و ترم‌ها", count: c.years },
    { href: "/admin/grades", title: "مقطع‌ها و پایه‌ها", hint: "کاتالوگ سازمان", count: c.grades },
    { href: "/admin/subjects", title: "درس‌ها", hint: "کاتالوگ سازمان", count: c.subjects },
    { href: "/admin/classes", title: "کلاس‌ها", hint: "دانش‌آموزان کلاس، ارائهٴ درس‌ها، چاپ اعتبارنامه", count: c.classes },
    { href: "/admin/students", title: "دانش‌آموزان", hint: "ثبت، حساب کاربری، انتقال کلاس", count: c.students },
    { href: "/admin/staff", title: "کارکنان", hint: "دبیران و کادر؛ نقش مدیر/معاون", count: c.staff },
    { href: "/admin/roles", title: "نقش‌ها", hint: "چه کسی مدیر یا معاون کدام مدرسه است" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <AdminHeader title="مدیریت مدرسه" description={data.scope.kind === "organization" ? "دامنهٴ شما: همهٴ مدرسه‌های سازمان." : `دامنهٴ شما: ${formatNumberFa(data.scope.schoolIds.length)} مدرسه.`} />
      <AdminCounters counts={c} />
      <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
        {sections.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-surface-sunken">
              <span className="flex min-w-0 flex-col">
                <span className="text-base text-text">{s.title}</span>
                <span className="text-xs text-text-muted">{s.hint}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-text-faint">
                {s.count !== undefined ? <span className="tabular">{formatNumberFa(s.count)}</span> : null}
                <ChevronLeft className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The four numbers an admin looks at every day. Reused on /home. */
export function AdminCounters({ counts, compact = false }: { counts: AdminCounts; compact?: boolean }) {
  const tiles: Array<{ href: string; label: string; value: number; warn?: boolean }> = [
    { href: "/admin/students", label: "دانش‌آموزان", value: counts.students },
    { href: "/admin/staff", label: "کارکنان", value: counts.staff },
    { href: "/admin/classes", label: "کلاس‌ها", value: counts.classes },
    { href: "/admin/students?pending=1", label: "حساب‌های فعال‌نشده", value: counts.accountsPending, warn: counts.accountsPending > 0 },
  ];
  return (
    <ul className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 md:grid-cols-4")}>
      {tiles.map((t) => (
        <li key={t.href}>
          <Link href={t.href} className={cn("flex min-h-20 flex-col justify-between rounded-card border bg-surface p-3 transition-colors hover:bg-surface-sunken", t.warn ? "border-warning/50" : "border-line")}>
            <span className={cn("tabular text-2xl font-bold leading-none", t.value === 0 ? "text-text-faint" : t.warn ? "text-warning-text" : "text-text")}>{formatNumberFa(t.value)}</span>
            <span className="text-sm text-text-muted">{t.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
