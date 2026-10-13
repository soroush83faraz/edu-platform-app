import { ChevronLeft, NotebookText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatNumberFa } from "@/lib/format";
import { reportCardClassesQuery, reportCardReachQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "کارنامهٴ توصیفی" };

/**
 * «کارنامهٴ توصیفی» — the staff door (Home tile): the primary classes the caller may open — a teacher's own classes,
 * an admin's schools. One class goes straight to it; a primary student who lands here belongs on «کارنامهٴ من».
 */
export default async function ReportCardPage() {
  const res = await reportCardClassesQuery();
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    return (
      <ContentWidth>
        <PageHeader title="کارنامهٴ توصیفی" />
        <EmptyState title="کارنامهٴ توصیفی برای شما در دسترس نیست" description="این بخش برای آموزگاران و مدیران دبستان است." />
      </ContentWidth>
    );
  }
  const classes = res.data;
  if (classes.length === 1) redirect(`/report-card/${classes[0].id}`);
  if (classes.length === 0) {
    const reach = await reportCardReachQuery();
    if (reach.ok && reach.data.student) redirect("/report-card/me");
  }

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader title="کارنامهٴ توصیفی" description="کلاس را انتخاب کنید" count={classes.length} />
      {classes.length === 0 ? (
        <EmptyState title="کلاس دبستانی‌ای برای شما نیست" description="کارنامهٴ توصیفی برای کلاس‌های پایهٴ اول تا ششم است؛ کلاسی که در آن تدریس می‌کنید یا مدیر آن هستید این‌جا می‌آید." />
      ) : (
        <ul className="reveal-rows surface-work divide-y divide-line/70 overflow-hidden">
          {classes.map((c) => (
            <li key={c.id}>
              <Link prefetch={false} href={`/report-card/${c.id}`} className="surface-link pressable flex min-h-14 items-center gap-3 px-4 py-2">
                <RowMark icon={NotebookText} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-row font-medium text-text">
                    کلاس <bdi>{c.name}</bdi>
                  </span>
                  <span className="truncate text-meta text-text-muted">
                    پایهٴ {c.gradeName} · <bdi>{c.schoolName}</bdi> · {formatNumberFa(c.students)} دانش‌آموز
                  </span>
                </span>
                <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ContentWidth>
  );
}
