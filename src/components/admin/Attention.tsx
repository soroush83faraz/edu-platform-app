import { ChevronLeft, CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { PageSection } from "@/components/layout/PageSection";
import type { AdminCounts } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

interface AttentionRow {
  href: string;
  label: string;
  count: number;
  /** One line of what to do about it. */
  fix: string;
}

/** The problems an admin can fix today, each row opening the page that fixes it; zero-count rows are not listed. */
export function attentionRows(c: AdminCounts): AttentionRow[] {
  return [
    { href: "/admin/students?pending=1", label: "حساب‌های فعال‌نشده", count: c.accountsPending, fix: "رمز اولیه هنوز عوض نشده؛ به این افراد یادآوری کنید وارد شوند." },
    { href: "/admin/classes", label: "ارائه‌های بدون دبیر", count: c.offeringsWithoutTeacher, fix: "از صفحهٴ کلاس، «ارائهٴ درس‌ها» → دبیر را انتخاب کنید." },
    { href: "/admin/classes", label: "کلاس‌های بدون ارائهٴ درس", count: c.classesWithoutOfferings, fix: "برای هر کلاس درس‌ها و دبیرها را تعریف کنید." },
    { href: "/admin/classes", label: "کلاس‌های بدون برنامهٴ هفتگی", count: c.classesWithoutTimetable, fix: "از صفحهٴ کلاس، «برنامهٴ هفتگی» را پر کنید." },
    { href: "/admin/students?noclass=1", label: "دانش‌آموزان بدون کلاس", count: c.studentsWithoutClass, fix: "از صفحهٴ هر دانش‌آموز، کلاس را ثبت کنید." },
  ].filter((r) => r.count > 0);
}

/**
 * «نیازمند توجه»: the attention rows as a work list; when nothing is wrong, one calm line instead of an empty box.
 * Lives on the /admin landing page — the management overview — and nowhere else (Home is personal work now).
 */
export function Attention({ counts }: { counts: AdminCounts }) {
  const rows = attentionRows(counts);
  return (
    <PageSection id="attention" title="نیازمند توجه" icon={CircleAlert} count={rows.length > 0 ? rows.length : undefined} surface="work" flush>
      {rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-text-muted">
          <CircleCheck className="size-5 text-success" aria-hidden />
          همه‌چیز سر جایش است: حساب‌ها فعال، کلاس‌ها با دبیر و برنامه.
        </p>
      ) : (
        <ul className="divide-y divide-line/70">
          {rows.map((r) => (
            <li key={r.label}>
              <Link href={r.href} className="pressable flex min-h-14 items-center gap-4 px-4 py-2.5 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                <span className="tabular w-10 shrink-0 text-title font-extrabold text-danger">{formatNumberFa(r.count)}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-row font-semibold text-text">{r.label}</span>
                  <span className="text-meta text-text-muted">{r.fix}</span>
                </span>
                <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
