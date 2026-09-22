import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { AdminCounters } from "@/components/admin/AdminCounters";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { RowMark } from "@/components/RowMark";
import { ADMIN_SECTION_ICONS, type AdminNavItem, type AdminSectionKey } from "@/lib/admin/nav";
import type { AdminCounts, AdminOverviewData, SchoolCounts } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

/** One line under each section on the landing page — what the section is for, in the admin's own words. */
const HINTS: Record<AdminSectionKey, string> = {
  overview: "",
  students: "ثبت، حساب کاربری، انتقال کلاس",
  staff: "دبیران و کادر؛ نقش مدیر/معاون",
  classes: "دانش‌آموزان کلاس، ارائهٴ درس‌ها، برنامهٴ هفتگی",
  attendance: "گزارش حضور و غیاب کلاس‌ها و زنگ‌های ثبت‌نشدهٴ امروز",
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
  // «نمای کلی» is this page, and «راه‌اندازی» is the setup panel the page already renders above this list
  // (`OnboardingProgress`, organization admin only) — neither gets a row: one home per destination
  // (docs/decisions.md). With two or more schools the «مدرسه‌ها» row is replaced by the breakdown below, which
  // is the same door with the numbers on it — still one home.
  const schools = data.schools ?? [];
  const many = schools.length > 1;
  const sections = items.filter((s) => s.key !== "overview" && s.key !== "onboarding" && !(many && s.key === "schools"));
  const schoolsHref = items.find((s) => s.key === "schools")?.href ?? "/admin/schools";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="مدیریت مدرسه" description={scopeLine(data, schools)} />
      <AdminCounters counts={c} />
      {many ? <SchoolBreakdown schools={schools} href={schoolsHref} counts={c} /> : null}
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

/** «دامنهٴ شما: …» — an organization admin sees the whole organization, a school admin every school they hold. */
function scopeLine(data: AdminOverviewData, schools: readonly SchoolCounts[]): string {
  const names = schools.map((s) => s.name).join("، ");
  if (data.scope.kind === "organization") return schools.length > 1 ? `دامنهٴ شما: همهٴ مدرسه‌های سازمان — ${names}.` : "دامنهٴ شما: همهٴ مدرسه‌های سازمان.";
  if (data.scope.schoolIds.length === 1) return "دامنهٴ شما: مدرسهٴ خودتان.";
  return `دامنهٴ شما: ${formatNumberFa(data.scope.schoolIds.length)} مدرسه${names ? ` — ${names}` : ""}.`;
}

/**
 * The counters above are the SUM over the scope; this panel says where the numbers come from — one row per
 * school, each opening that school's hub (owner, QA round 3: «۲ مدرسه» must never collapse to the first one).
 */
function SchoolBreakdown({ schools, href, counts }: { schools: readonly SchoolCounts[]; href: string; counts: AdminCounts }) {
  // The rows must add up to the counters above; whoever is anchored to no school is named here instead of vanishing.
  const sum = (pick: (s: SchoolCounts) => number) => schools.reduce((t, s) => t + pick(s), 0);
  const loose = [
    { href: "/admin/students", labelFa: "دانش‌آموز بدون ثبت‌نام در مدرسه", n: counts.students - sum((s) => s.students) },
    { href: "/admin/staff", labelFa: "همکار بدون مدرسهٴ اصلی", n: counts.staff - sum((s) => s.staff) },
  ].filter((x) => x.n > 0);
  return (
    <PageSection
      id="school-breakdown"
      title="مدرسه‌ها"
      icon={ADMIN_SECTION_ICONS.schools}
      count={schools.length}
      surface="work"
      flush
      trailing={
        <Link href={href} className="inline-flex min-h-11 items-center text-meta text-primary-700 hover:underline">
          فهرست مدرسه‌ها
        </Link>
      }
    >
      <ul className="divide-y divide-line/70">
        {schools.map((s) => (
          <li key={s.id}>
            <Link href={`/admin/schools/${s.id}`} className="pressable flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-sunken">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-row font-medium text-text">
                  <bdi>{s.name}</bdi>
                </span>
                <span className="text-meta text-text-muted">
                  <span className="tabular">{formatNumberFa(s.students)}</span> دانش‌آموز
                  <span aria-hidden> · </span>
                  <span className="tabular">{formatNumberFa(s.classes)}</span> کلاس
                  <span aria-hidden> · </span>
                  <span className="tabular">{formatNumberFa(s.staff)}</span> همکار
                </span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
        {loose.map((x) => (
          <li key={x.href}>
            <Link href={x.href} className="pressable flex min-h-12 items-center gap-3 px-4 py-2 text-meta text-text-muted hover:bg-surface-sunken">
              <span className="flex-1">
                <span className="tabular">{formatNumberFa(x.n)}</span> {x.labelFa}
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
