import { BookOpen, CalendarDays, ChevronLeft, GraduationCap, Layers, type LucideIcon, School, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { AdminCounters } from "@/components/admin/AdminCounters";
import { AdminHeader } from "@/components/admin/AdminPage";
import { ClayIcon } from "@/components/ClayIcon";
import { formatNumberFa } from "@/lib/format";
import type { AdminOverviewData } from "@/lib/admin/overview";

/** /admin index: four counters that are also links, then every section with a one-line description and the blue clay mark. */
export function AdminOverview({ data }: { data: AdminOverviewData }) {
  const c = data.counts;
  const sections: Array<{ href: string; icon: LucideIcon; title: string; hint: string; count?: number }> = [
    { href: "/admin/schools", icon: School, title: "مدرسه‌ها و شعبه‌ها", hint: "نام، کد، جنسیت", count: c.schools },
    { href: "/admin/years", icon: CalendarDays, title: "سال‌های تحصیلی و نوبت‌ها", hint: "سال جاری هر مدرسه و ترم‌ها", count: c.years },
    { href: "/admin/grades", icon: Layers, title: "مقطع‌ها و پایه‌ها", hint: "کاتالوگ سازمان", count: c.grades },
    { href: "/admin/subjects", icon: BookOpen, title: "درس‌ها", hint: "کاتالوگ سازمان", count: c.subjects },
    { href: "/admin/classes", icon: Users, title: "کلاس‌ها", hint: "دانش‌آموزان کلاس، ارائهٴ درس‌ها، چاپ اعتبارنامه", count: c.classes },
    { href: "/admin/students", icon: GraduationCap, title: "دانش‌آموزان", hint: "ثبت، حساب کاربری، انتقال کلاس", count: c.students },
    { href: "/admin/staff", icon: Users, title: "کارکنان", hint: "دبیران و کادر؛ نقش مدیر/معاون", count: c.staff },
    { href: "/admin/roles", icon: ShieldCheck, title: "نقش‌ها", hint: "چه کسی مدیر یا معاون کدام مدرسه است" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <AdminHeader title="مدیریت مدرسه" description={data.scope.kind === "organization" ? "دامنهٴ شما: همهٴ مدرسه‌های سازمان." : `دامنهٴ شما: ${formatNumberFa(data.scope.schoolIds.length)} مدرسه.`} />
      <AdminCounters counts={c} />
      <ul className="divide-y divide-line/70 rounded-card bg-surface shadow-1">
        {sections.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="pressable flex min-h-16 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
              <ClayIcon icon={s.icon} />
              <span className="flex min-w-0 flex-1 flex-col">
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
