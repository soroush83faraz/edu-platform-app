import { Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { RowMark } from "@/components/RowMark";
import { RocketClay } from "@/components/illustrations";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/admin/PrintButton";
import { MODULES, PHASES, type ModuleEntry } from "@/lib/modules-registry";
import { productName } from "@/lib/product";

export const metadata: Metadata = { title: "نقشهٴ راه" };

const PHASE_ORDER: ModuleEntry["phase"][] = [1, 2, 3, 4];

/** The product map — four phases with months, every item with the client's own term in parentheses. Printable. */
export default function RoadmapPage() {
  const name = productName();
  return (
    <ContentWidth size="reading" className="gap-6 print:px-0">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <RocketClay size={56} className="shrink-0 print:hidden" />
            نقشهٴ راه {name}
          </span>
        }
        description="این نقشه برای شفافیت مسیر است؛ فاز ۱ اکنون فعال است. نام‌های داخل پرانتز همان واژه‌های برنامهٴ فعلی مدرسه‌اند."
        actions={<PrintButton className="no-print hidden md:inline-flex" />}
      />

      <ol className="flex flex-col gap-5">
        {PHASE_ORDER.map((phase) => {
          const info = PHASES[phase];
          const items = MODULES.filter((m) => m.phase === phase);
          const live = phase === 1;
          return (
            <li key={phase} id={`phase-${phase}`} className="scroll-mt-20 surface-work print:break-inside-avoid print:shadow-none print:ring-1 print:ring-line">
              <div className={cn("flex items-baseline justify-between gap-3 rounded-t-card px-4 py-3", live ? "bg-hero text-white" : "border-b border-line/70")}>
                <h3 className={cn("text-base font-semibold", live ? "text-white" : "text-text")}>{info.title}</h3>
                <span className={cn("text-meta", live ? "text-on-hero-muted" : "text-text-muted")}>{info.months}</span>
              </div>
              <p className="px-4 pt-3 text-sm text-text-muted">{info.summary}</p>
              <ul className="flex flex-col divide-y divide-line/70 px-4 pt-2">
                {items.map((m) => (
                  <li key={m.code} id={m.code} className="flex scroll-mt-24 items-start gap-3 py-3 target:-mx-2 target:rounded-xl target:bg-info-soft/60 target:px-2">
                    <RowMark icon={m.icon} className="mt-0.5" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="text-sm font-medium text-text">
                        {live ? <Link href={m.href} className="hover:underline">{m.labelFa}</Link> : m.labelFa}
                        {m.competitorTerm && m.competitorTerm !== m.labelFa ? <span className="text-text-faint"> ({m.competitorTerm})</span> : null}
                        {m.month && !live ? <span className="ms-2 text-meta font-normal text-text-muted">{m.month}</span> : null}
                      </p>
                      <p className="text-meta text-text-muted">{m.descriptionFa}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <p className="text-meta text-text-faint print:hidden">
        <Printer className="me-1 inline size-3.5 align-text-bottom" aria-hidden />
        برای چاپ از منوی مرورگر «چاپ» را بزنید؛ صفحه برای کاغذ آماده است.
      </p>
    </ContentWidth>
  );
}
