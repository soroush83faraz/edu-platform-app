import Link from "next/link";
import { cn } from "cn";
import type { AdminCounts } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

/**
 * The four numbers an admin looks at every day — students, staff, classes, accounts not yet activated — in ONE
 * panel with a hairline grid (no bordered tiles); every cell is a link. Numbers are neutral text; the one red dot
 * marks the count that is a problem (pending accounts). Used on /admin and the Home glance card.
 */
export function AdminCounters({ counts: c }: { counts: AdminCounts }) {
  const counters: Array<{ href: string; label: string; value: number; warn?: boolean }> = [
    { href: "/admin/students", label: "دانش‌آموزان", value: c.students },
    { href: "/admin/staff", label: "کارکنان", value: c.staff },
    { href: "/admin/classes", label: "کلاس‌ها", value: c.classes },
    { href: "/admin/students?pending=1", label: "حساب‌های فعال‌نشده", value: c.accountsPending, warn: c.accountsPending > 0 },
  ];
  return (
    <ul className="surface-panel grid grid-cols-2 sm:grid-cols-4">
        {counters.map((t, i) => (
          <li key={t.href} className={cn("border-line", i % 2 === 1 && "border-s", i >= 2 && "border-t sm:border-t-0", "sm:border-s sm:first:border-s-0")}>
            <Link href={t.href} className="pressable flex min-h-20 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-surface">
              <span className={cn("tabular text-title font-extrabold leading-8", t.value === 0 ? "text-text-faint" : "text-text")}>{formatNumberFa(t.value)}</span>
              <span className="flex items-center gap-1.5 text-meta text-text-muted">
                {t.warn ? <span aria-hidden className="size-2 rounded-full bg-danger" /> : null}
                {t.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
  );
}
