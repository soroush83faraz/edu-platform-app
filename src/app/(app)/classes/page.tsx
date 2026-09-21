import { ArrowRight, Plus, Presentation } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { IconChip } from "@/components/IconChip";
import { BookClay } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { formatNumberFa } from "@/lib/format";
import { hatsQuery } from "@/modules/iam/hats";

export const metadata: Metadata = { title: "کلاس‌های من | سامانهٴ مدرسه" };

/**
 * «کلاس‌های من» for a teacher: one card per offering — درس, کلاس, students, open items I gave that class — each
 * opening the کارتابل filtered to my items. Reads the same `hatsQuery` as Home (one statement).
 */
export default async function ClassesPage() {
  const hats = await hatsQuery();
  if (!hats.ok) {
    if (hats.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس‌ها در دسترس نیست" description={hats.message} />;
  }
  const offerings = hats.data.teachingOfferings;
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-8 md:pt-6">
      <Link href="/home" className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
        <ArrowRight className="size-4" aria-hidden />
        خانه
      </Link>
      <div className="flex items-center gap-3">
        <IconChip icon={Presentation} size="lg" />
        <div className="flex flex-col">
          <h2 className="text-xl font-bold leading-8 text-text">کلاس‌های من</h2>
          <p className="text-sm text-text-muted">{offerings.length > 0 ? `${formatNumberFa(offerings.length)} درس در این سال` : "درسی به شما سپرده نشده"}</p>
        </div>
        <Button asChild className="ms-auto shrink-0">
          <Link href="/inbox/new">
            <Plus aria-hidden />
            کار جدید
          </Link>
        </Button>
      </div>

      {offerings.length === 0 ? (
        <EmptyState illustration={<BookClay size={112} />} title="هنوز درسی به شما سپرده نشده" description="وقتی مدیر درسی را به شما بدهد، کلاس‌ها همین‌جا می‌آیند." />
      ) : (
        <ul className="reveal-grid grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {offerings.map((o) => (
            <li key={o.offeringId} className="flex">
              <Link href="/inbox?mine=1" className="pressable flex w-full flex-col gap-3 rounded-card bg-surface p-4 shadow-1 hover:bg-info-soft/40">
                <div className="flex flex-col">
                  <span className="truncate text-base font-semibold text-text">
                    <bdi>{o.subjectName}</bdi>
                  </span>
                  <span className="text-sm text-text-muted">
                    کلاس <bdi>{o.classGroupName}</bdi>
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs">
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
      )}
    </div>
  );
}
