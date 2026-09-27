import { ChevronLeft, Presentation } from "lucide-react";
import Link from "next/link";
import { PageSection } from "@/components/layout/PageSection";
import { SubjectIcon } from "@/components/SubjectStamp";
import { formatNumberFa } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { TeachingOffering } from "@/modules/iam/hats";
import type { HomeTiles } from "../home-data";
import { Tile } from "../Tile";

/**
 * The top of every desktop dashboard's work column: the person's live tiles as a grid of 56 px marks (the same
 * tiles as the phone grid, smaller), with the «تکالیف نزدیک» card right under it (owner, nav round 2026-09-27 —
 * tiles first, then the tasks card, stacked). `full` is the one-column board (no role panels beside it), which
 * spreads the marks over more columns. No «به‌زودی» panel: the roadmap is reached from «بیشتر».
 */
export function DashboardTiles({ home, full = false }: { home: HomeTiles; full?: boolean }) {
  const { tiles } = home;
  if (tiles.length === 0) return null;
  return (
    <nav aria-label="بخش‌ها">
      <ul className={cn("reveal-grid grid gap-x-1 gap-y-2", full ? "grid-cols-6 xl:grid-cols-8" : "grid-cols-4 xl:grid-cols-6")}>
        {tiles.map((t) => (
          <Tile key={t.code} href={t.href} label={t.labelFa} icon={t.icon} shade={t.shade} mirror={t.mirror} compact />
        ))}
      </ul>
    </nav>
  );
}

/** (Teacher) «کلاس‌های من» as a compact list: درس، کلاس، the open items I gave that class; each row opens the subject page. */
export function MyClassesCompact({ offerings }: { offerings: TeachingOffering[] }) {
  return (
    <PageSection
      id="my-classes-aside"
      title="کلاس‌های من"
      icon={Presentation}
      count={offerings.length}
      surface="panel"
      headingAs="h3"
      flush
      trailing={
        <Link href="/classes" className="pressable inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          همهٴ کلاس‌ها
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      }
    >
      {offerings.length === 0 ? (
        <p className="px-4 py-5 text-sm text-text-muted">هنوز درسی به شما سپرده نشده.</p>
      ) : (
        <ul className="divide-y divide-line">
          {offerings.slice(0, 8).map((o) => (
            <li key={o.offeringId}>
              <Link href={`/subjects/${o.offeringId}`} className="pressable flex min-h-12 items-center gap-3 px-4 py-1.5 first:rounded-t-card last:rounded-b-card hover:bg-surface">
                <SubjectIcon subjectId={o.subjectId} name={o.subjectName} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-text">
                    <bdi>{o.subjectName}</bdi>
                  </span>
                  <span className="truncate text-meta text-text-muted">
                    کلاس <bdi>{o.classGroupName}</bdi> · {formatNumberFa(o.activeStudents)} دانش‌آموز
                  </span>
                </span>
                {o.openItems > 0 ? <span className="tabular shrink-0 rounded-full bg-info-soft px-2 text-xs font-medium leading-5 text-primary-800">{formatNumberFa(o.openItems)} تکلیف باز</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
