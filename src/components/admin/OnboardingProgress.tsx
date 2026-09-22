import { ChevronLeft, Rocket } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { PageSection } from "@/components/layout/PageSection";
import { formatNumberFa } from "@/lib/format";

/**
 * (Organization admin) the setup checklist's progress as one panel with a bar and the link to the steps. It sits
 * on the /admin landing page — the management overview — beside «نیازمند توجه»; Home never shows it (Home is the
 * person's own work).
 */
export function OnboardingProgress({ progress }: { progress: { done: number; total: number } }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <PageSection
      id="onboarding-progress"
      title="راه‌اندازی مدرسه"
      icon={Rocket}
      surface="panel"
      headingAs="h3"
      trailing={
        <Link href="/admin/onboarding" className="pressable inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          گام‌ها
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      }
    >
      <div className="flex items-center gap-3">
        <span className="tabular text-title font-bold text-text">
          {formatNumberFa(progress.done)}
          <span className="text-section font-normal text-text-muted">/{formatNumberFa(progress.total)}</span>
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="پیشرفت راه‌اندازی">
          <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-sky")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="mt-1.5 text-meta text-text-muted">{pct === 100 ? "همهٴ گام‌ها انجام شده." : `${formatNumberFa(progress.total - progress.done)} گام مانده تا دانش‌آموزان بتوانند وارد شوند.`}</p>
    </PageSection>
  );
}
