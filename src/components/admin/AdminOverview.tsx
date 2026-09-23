import { ChevronLeft, School } from "lucide-react";
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
  roles: "چه کسی مدیر یا معاون کدام مدرسه است",
  schools: "مدرسهٴ جدید، شعبه‌ها و صفحهٴ هر مدرسه",
  setup: "گام‌های مانده تا آمادگی برای شروع سال",
};

/**
 * /admin landing: the counters, the management panels the page passes in («نیازمند توجه»), then every section the
 * caller may open — in the nav's order, each with its quiet glyph, a one-line hint and its count. «مدرسه‌ها» and
 * «راه‌اندازی مدرسه» are ordinary rows of that list for the organization admin (round 7): the setup checklist has
 * no panel of its own here any more, it is a section like its neighbours and its number is the steps still
 * missing. The remaining structure pages and the «حضور و غیاب» report live on Home as their own tiles, so this
 * list never carries a second door to them.
 * On phones this list IS the admin navigation (the pill row is for inner pages); on desktop the rail repeats it
 * under «مدیریت», which is the group header, not a second link.
 */
export function AdminOverview({ data, items, children }: { data: AdminOverviewData; items: readonly AdminNavItem[]; children?: React.ReactNode }) {
  const c = data.counts;
  const countOf: Partial<Record<AdminSectionKey, number>> = {
    classes: c.classes,
    students: c.students,
    staff: c.staff,
  };
  // «نمای کلی» is this page — it never gets a row (one home per destination, docs/decisions.md). The multi-school
  // breakdown is the numbers BEHIND the «مدرسه‌ها» row, not a second door to the list: each of its rows opens one
  // school's own hub, and it carries no «فهرست مدرسه‌ها» link of its own.
  const schools = data.schools ?? [];
  const many = schools.length > 1;
  const sections = items.filter((s) => s.key !== "overview");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="مدیریت مدرسه" description={scopeLine(data, schools)} />
      <AdminCounters counts={c} />
      {many ? <SchoolBreakdown schools={schools} counts={c} /> : null}
      {children}
      <ul className="surface-work divide-y divide-line/70">
        {sections.map((s) => {
          // `adminNavItems` already computed the section's own number (schools, setup steps left); the local map
          // is the fallback for callers that pass the bare sections.
          const count = s.count ?? countOf[s.key];
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
function SchoolBreakdown({ schools, counts }: { schools: readonly SchoolCounts[]; counts: AdminCounts }) {
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
      icon={School}
      count={schools.length}
      surface="work"
      flush
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
