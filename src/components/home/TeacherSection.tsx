import Link from "next/link";
import { cn } from "cn";
import { EmptyClay } from "@/components/illustrations";
import { formatNumberFa } from "@/lib/format";
import type { TeachingOffering } from "@/modules/iam/hats";
import { homeOpenItemsQuery } from "@/modules/workspace/queries";
import { CompactItemRow } from "./CompactItemRow";
import { Card, HomeSection } from "./HomeSection";

/** «کلاس‌های من» as a snap-scrolling row of class cards, then the five most urgent items I gave with progress. */
export async function TeacherSection({ offerings }: { offerings: TeachingOffering[] }) {
  const given = await homeOpenItemsQuery({ createdByMe: true, limit: 5 });
  const rows = given.ok ? given.data : [];
  return (
    <>
      <HomeSection id="classes" title="کلاس‌های من">
        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
          {offerings.map((o) => (
            <li key={o.offeringId} className="w-[11.5rem] shrink-0 snap-start md:w-auto">
              <Link
                href="/inbox?mine=1"
                className="flex h-full flex-col gap-3 rounded-card bg-surface p-4 shadow-1 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 active:translate-y-0"
              >
                <div className="flex flex-col">
                  <span className="truncate text-base font-semibold text-text">{o.subjectName}</span>
                  <span className="text-sm text-text-muted">{o.classGroupName}</span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs">
                  <span className="text-text-muted">
                    <span className="tabular font-medium text-text">{formatNumberFa(o.activeStudents)}</span> دانش‌آموز
                  </span>
                  <span className={cn("tabular rounded-full px-2 py-0.5 font-medium", o.openItems > 0 ? "bg-info-soft text-primary-800" : "bg-surface-sunken text-text-muted")}>
                    {formatNumberFa(o.openItems)} کار باز
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </HomeSection>

      <HomeSection id="given" title="کارهایی که دادم" more={{ href: "/inbox?mine=1", label: "همه" }}>
        <Card>
          {rows.length === 0 ? (
            <div className="flex items-center gap-4 px-4 py-5">
              <EmptyClay size={72} />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-text">هنوز کاری به کلاس‌ها نداده‌اید.</p>
                <Link href="/inbox/new" className="text-sm font-medium text-sky-strong hover:underline">
                  اولین کار را بدهید
                </Link>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line/70">
              {rows.map((row) => (
                <CompactItemRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </Card>
      </HomeSection>
    </>
  );
}
