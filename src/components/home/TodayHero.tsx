import Link from "next/link";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumberFa } from "@/lib/format";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

/**
 * «امروز چه کنم؟» answered in one sentence, then the three numbers that are also the way in (each tile opens the
 * کارتابل pre-filtered). The only gradient surface in the product. Danger is a small red dot next to «سررسیده»,
 * never a red card. Rendered inside <Suspense>; `HeroSkeleton` has the same box.
 */
export async function TodayHero() {
  const summary = await inboxSummaryQuery();
  if (!summary.ok) return null; // a role without a کارتابل simply has no hero
  const { overdue, dueToday, unread } = summary.data;
  return (
    <section aria-labelledby="today-heading" className="on-hero rounded-hero bg-hero p-5 text-on-hero shadow-hero">
      <p className="text-sm text-on-hero-muted">امروز چه کنم؟</p>
      <h3 id="today-heading" className="mt-1 text-xl font-bold leading-8 text-balance">
        {headline(overdue, dueToday, unread)}
      </h3>
      <ul className="mt-5 grid grid-cols-3 gap-2">
        <Tile href="/inbox?bucket=overdue" label="سررسیده" value={overdue} alert={overdue > 0} order={0} />
        <Tile href="/inbox?bucket=today" label="امروز" value={dueToday} order={1} />
        <Tile href="/inbox?unread=1" label="خوانده‌نشده" value={unread} order={2} />
      </ul>
    </section>
  );
}

function headline(overdue: number, dueToday: number, unread: number): string {
  if (overdue > 0) return `${formatNumberFa(overdue)} کار از مهلتش گذشته است.`;
  if (dueToday > 0) return `${formatNumberFa(dueToday)} کار تا امشب مهلت دارد.`;
  if (unread > 0) return `${formatNumberFa(unread)} کار تازه منتظر خواندن است.`;
  return "کاری برای امروز نمانده.";
}

/** `order` staggers the number's entrance by 40 ms per tile (after the hero's own 120 ms). */
function Tile({ href, label, value, alert = false, order }: { href: string; label: string; value: number; alert?: boolean; order: number }) {
  return (
    <li>
      <Link
        href={href}
        className="pressable flex min-h-[4.75rem] flex-col justify-between rounded-2xl bg-primary-900/25 px-3 py-2.5 hover:bg-primary-900/35 active:bg-primary-900/45"
      >
        <span
          className={cn("reveal-pop tabular block origin-[center_start] text-3xl font-semibold leading-none", value === 0 && "text-white/60")}
          style={{ animationDelay: `${120 + order * 40}ms` }}
        >
          {formatNumberFa(value)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-white/90">
          {alert ? <span aria-hidden className="size-2 rounded-full bg-danger ring-2 ring-white/70" /> : null}
          {label}
        </span>
      </Link>
    </li>
  );
}

export function HeroSkeleton() {
  return (
    <div aria-busy="true" aria-label="در حال بارگذاری" className="rounded-hero bg-hero p-5 shadow-hero">
      <Skeleton className="h-4 w-24 bg-white/25" />
      <Skeleton className="mt-3 h-7 w-3/4 bg-white/30" />
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[4.75rem] rounded-2xl bg-primary-900/25" />
        ))}
      </div>
    </div>
  );
}
