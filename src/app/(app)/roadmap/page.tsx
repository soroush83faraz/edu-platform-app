import { Printer } from "lucide-react";
import type { Metadata } from "next";
import { ModuleTileFace } from "@/components/home/ModuleTileFace";
import { RocketClay } from "@/components/illustrations";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { PrintButton } from "@/components/admin/PrintButton";
import { MODULES, PHASES, type ModuleEntry } from "@/lib/modules-registry";
import { productName } from "@/lib/product";

export const metadata: Metadata = { title: "نقشهٴ راه" };

const UPCOMING_PHASES: ModuleEntry["phase"][] = [2, 3, 4];

/** The Home grid's columns, so the roadmap tiles read as the same icons. */
const GRID = "grid grid-cols-3 items-start gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5";

/** «(نام در برنامهٴ فعلی)» — the client's own term, when it differs from ours. */
const theirTerm = (m: ModuleEntry) => (m.competitorTerm && m.competitorTerm !== m.labelFa ? m.competitorTerm : null);

/**
 * The modules of one group as icon tiles — the Home tile face (`ModuleTileFace`): live-blue for what is delivered,
 * grey with the «به‌زودی» pill for what is coming (owner 2026-09-27). Each tile is a `<details>` (one open at a time,
 * `name`): a tap reveals the month, the one-line description and the school's current term under the tile. No tile is
 * a link — the roadmap explains, the Home tiles are the doors. On paper the tiles give way to a plain list (the closed
 * `<details>` would hide the descriptions).
 */
function ModuleTiles({ modules, soon }: { modules: readonly ModuleEntry[]; soon: boolean }) {
  return (
    <>
      <ul className={`${GRID} print:hidden`}>
        {modules.map((m) => (
          <li key={m.code} id={m.code} className="flex scroll-mt-24 justify-center">
            <details name="roadmap-module" className="group flex w-full max-w-32 flex-col items-center">
              <summary className="pressable flex w-full cursor-pointer list-none justify-center rounded-card group-open:bg-surface/70 hover:bg-surface/50 [&::-webkit-details-marker]:hidden">
                <ModuleTileFace icon={m.icon} label={m.labelFa} soon={soon} />
              </summary>
              <p className="flex flex-col gap-0.5 px-1 pt-1.5 pb-1 text-center text-meta text-balance text-text-muted">
                {m.month ? <span className="font-semibold text-text">{m.month}</span> : null}
                <span>{m.descriptionFa}</span>
                {theirTerm(m) ? <span className="text-text-faint">({theirTerm(m)})</span> : null}
              </p>
            </details>
          </li>
        ))}
      </ul>
      <ul className="hidden flex-col gap-1.5 print:flex">
        {modules.map((m) => (
          <li key={m.code} className="text-meta text-text-muted">
            <span className="font-semibold text-text">{m.labelFa}</span>
            {theirTerm(m) ? <span className="text-text-faint"> ({theirTerm(m)})</span> : null}
            {m.month ? <span> · {m.month}</span> : null}
            <span> — {m.descriptionFa}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The product map — what is live, then what each later phase brings, as the Home's icon tiles. Printable. */
export default function RoadmapPage() {
  const name = productName();
  const live = PHASES[1];
  return (
    <ContentWidth size="reading" className="gap-6 print:px-0">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <RocketClay size={56} className="shrink-0 print:hidden" />
            نقشهٴ راه {name}
          </span>
        }
        description="این نقشه برای شفافیت مسیر است؛ فاز ۱ اکنون فعال است. روی هر بخش بزنید تا ببینید چه می‌کند و کی می‌رسد."
        actions={<PrintButton className="no-print hidden md:inline-flex" />}
      />

      <PageSection id="phase-1" title="فعال" trailing={<span className="text-meta text-text-muted">{live.months}</span>} className="print:break-inside-avoid">
        <p className="px-1 text-meta text-text-muted">{live.summary}</p>
        <ModuleTiles modules={MODULES.filter((m) => m.phase === 1)} soon={false} />
      </PageSection>

      <PageSection id="soon" title="به‌زودی">
        {UPCOMING_PHASES.map((phase) => {
          const info = PHASES[phase];
          return (
            <div key={phase} id={`phase-${phase}`} className="flex scroll-mt-20 flex-col gap-2 pb-2 print:break-inside-avoid">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="text-row font-semibold text-text">{info.title}</h3>
                <span className="text-meta text-text-muted">{info.months}</span>
              </div>
              <p className="px-1 text-meta text-text-muted">{info.summary}</p>
              <ModuleTiles modules={MODULES.filter((m) => m.phase === phase)} soon />
            </div>
          );
        })}
      </PageSection>

      <p className="text-meta text-text-faint print:hidden">
        <Printer className="me-1 inline size-3.5 align-text-bottom" aria-hidden />
        برای چاپ از منوی مرورگر «چاپ» را بزنید؛ صفحه برای کاغذ آماده است.
      </p>
    </ContentWidth>
  );
}
