import { Check, ChevronLeft, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { AdminHeader } from "@/components/admin/AdminPage";
import { onboardingSteps } from "@/lib/admin/onboarding";
import { adminOverviewQuery } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

export const metadata: Metadata = { title: "راه‌اندازی مدرسه | سامانهٴ مدرسه" };

/**
 * /admin/onboarding — what is done and what is missing before students can log in on ۱ مهر. Organization admins
 * only (owner's rule: whoever defines schools sets them up); a school-scoped admin who types the URL gets the
 * Persian not-found page like every other organization-only page — the scope comes from the database
 * (`adminOverviewQuery().scope`), not from the hidden tile or nav entry.
 */
export default async function OnboardingPage() {
  const result = await adminOverviewQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    redirect("/home");
  }
  if (result.data.scope.kind !== "organization") notFound();
  const list = onboardingSteps(result.data.counts);
  const done = list.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title="راه‌اندازی مدرسه" description="ترتیب پیشنهادی از بالا به پایین؛ هر ردیف به بخش مربوط می‌رود." />
      <div className="surface-panel flex items-center gap-3 px-4 py-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done}>
          <div className={cn("h-full rounded-full", done === list.length ? "bg-success" : "bg-sky")} style={{ width: `${Math.round((done / list.length) * 100)}%` }} />
        </div>
        <span className="tabular text-sm font-medium text-text">
          {formatNumberFa(done)}/{formatNumberFa(list.length)}
        </span>
      </div>
      <ol className="surface-work divide-y divide-line/70">
        {list.map((s, i) => (
          <li key={`${s.href}-${i}`}>
            <Link href={s.href} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-sunken">
              {s.done ? <Check className="size-5 shrink-0 text-success" aria-label="انجام شده" /> : <CircleDashed className={cn("size-5 shrink-0", s.warn ? "text-warning-text" : "text-text-faint")} aria-label="انجام نشده" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-row", s.done ? "text-text" : "font-medium text-text")}>{s.title}</span>
                <span className={cn("text-meta", s.warn && !s.done ? "text-warning-text" : "text-text-muted")}>{s.detail}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
