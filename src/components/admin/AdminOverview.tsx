import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { AdminCounters } from "@/components/admin/AdminCounters";
import { PageHeader } from "@/components/layout/PageHeader";
import { RowMark } from "@/components/RowMark";
import { ADMIN_SECTION_ICONS, type AdminNavItem, type AdminSectionKey } from "@/lib/admin/nav";
import type { AdminOverviewData } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

/** One line under each section on the landing page — what the section is for, in the admin's own words. */
const HINTS: Record<AdminSectionKey, string> = {
  overview: "",
  students: "ثبت، حساب کاربری، انتقال کلاس",
  staff: "دبیران و کادر؛ نقش مدیر/معاون",
  classes: "دانش‌آموزان کلاس، ارائهٴ درس‌ها، برنامهٴ هفتگی",
  schools: "نام، کد، شعبه‌ها، زنگ‌بندی",
  years: "سال جاری هر مدرسه و نوبت‌ها",
  grades: "کاتالوگ سازمان",
  subjects: "کاتالوگ سازمان",
  levels: "کاتالوگ سازمان",
  roles: "چه کسی مدیر یا معاون کدام مدرسه است",
  onboarding: "گام‌های باقی‌مانده تا ورود دانش‌آموزان",
};

/**
 * /admin landing: the counters, the management panels the page passes in («نیازمند توجه», the setup progress),
 * then every section the caller may open — in the nav's order (people and classes first), each with its quiet
 * glyph, a one-line hint and its count. On phones this list IS the admin navigation (the pill row is for inner
 * pages); on desktop the rail repeats it under «مدیریت», which is the group header, not a second link.
 */
export function AdminOverview({ data, items, children }: { data: AdminOverviewData; items: readonly AdminNavItem[]; children?: React.ReactNode }) {
  const c = data.counts;
  const countOf: Partial<Record<AdminSectionKey, number>> = {
    schools: c.schools,
    years: c.years,
    grades: c.grades,
    subjects: c.subjects,
    levels: c.levels,
    classes: c.classes,
    students: c.students,
    staff: c.staff,
  };
  const sections = items.filter((s) => s.key !== "overview");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="مدیریت مدرسه" description={data.scope.kind === "organization" ? "دامنهٴ شما: همهٴ مدرسه‌های سازمان." : data.scope.schoolIds.length === 1 ? "دامنهٴ شما: مدرسهٴ خودتان." : `دامنهٴ شما: ${formatNumberFa(data.scope.schoolIds.length)} مدرسه.`} />
      <AdminCounters counts={c} />
      {children}
      <ul className="surface-work divide-y divide-line/70">
        {sections.map((s) => {
          const count = countOf[s.key];
          return (
            <li key={s.href}>
              <Link href={s.href} className="pressable flex min-h-16 items-center gap-3 px-3 py-2 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                <RowMark icon={ADMIN_SECTION_ICONS[s.key]} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-row font-medium text-text">{s.labelFa}</span>
                  <span className="text-meta text-text-muted">{HINTS[s.key]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-text-faint">
                  {count !== undefined ? <span className="tabular">{formatNumberFa(count)}</span> : null}
                  <ChevronLeft className="size-4" aria-hidden />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
