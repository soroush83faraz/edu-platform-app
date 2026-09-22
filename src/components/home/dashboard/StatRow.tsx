import Link from "next/link";
import { cn } from "cn";
import type { AdminCounts } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

/**
 * The counters as one compact `surface-panel` row — neutral text numbers, a hairline between cells, every cell a
 * link. No colour: a count is a fact, not a verdict (the verdicts live in «نیازمند توجه»).
 */
export function StatRow({ counts: c }: { counts: AdminCounts }) {
  const stats: Array<{ href: string; label: string; value: number }> = [
    { href: "/admin/students", label: "دانش‌آموزان", value: c.students },
    { href: "/admin/staff", label: "کارکنان", value: c.staff },
    { href: "/admin/classes", label: "کلاس‌ها", value: c.classes },
    { href: "/admin/staff", label: "دبیران", value: c.teachers },
  ];
  return (
    <ul className="surface-panel grid grid-cols-2 sm:grid-cols-4" aria-label="آمار مدرسه">
      {stats.map((s, i) => (
        <li key={s.label} className={cn("border-line", i % 2 === 1 && "border-s", i >= 2 && "border-t sm:border-t-0", "sm:border-s sm:first:border-s-0")}>
          <Link href={s.href} className="pressable flex min-h-16 flex-col justify-center gap-0.5 px-4 py-2 hover:bg-surface">
            <span className={cn("tabular text-title font-semibold leading-8", s.value === 0 ? "text-text-faint" : "text-text")}>{formatNumberFa(s.value)}</span>
            <span className="text-meta text-text-muted">{s.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
