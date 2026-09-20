import { Bell, Inbox, Settings2 } from "lucide-react";
import Link from "next/link";
import { LIVE_MODULES, UPCOMING_MODULES, type ModuleEntry } from "@/lib/modules-registry";
import type { Permission } from "@/modules/iam/permissions";
import { HomeSection } from "./HomeSection";

const ICONS: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { inbox: Inbox, notifications: Bell, admin: Settings2 };

/**
 * «بخش‌ها», below the fold: the live modules as three quiet tiles, then what is coming as muted chips that open the
 * roadmap — never a full-screen icon grid. `has` tells which permissions the caller holds.
 */
export function ModulesRow({ has }: { has: (p: Permission) => boolean }) {
  const live = LIVE_MODULES.filter((m) => !m.permission || has(m.permission));
  return (
    <HomeSection id="modules" title="بخش‌ها" more={{ href: "/roadmap", label: "نقشهٴ راه" }}>
      <ul className="grid grid-cols-3 gap-2">
        {live.map((m) => {
          const Icon = ICONS[m.code] ?? Inbox;
          return (
            <li key={m.code}>
              <Link href={m.href} className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-card bg-surface text-xs font-medium text-text shadow-1 transition-colors duration-150 hover:bg-surface-sunken">
                <Icon className="size-5 text-sky-strong" aria-hidden />
                {m.labelFa}
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className="flex flex-wrap gap-2" aria-label="به‌زودی">
        {UPCOMING_MODULES.map((m) => (
          <UpcomingChip key={m.code} m={m} />
        ))}
      </ul>
    </HomeSection>
  );
}

function UpcomingChip({ m }: { m: ModuleEntry }) {
  return (
    <li>
      <Link
        href={m.href}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface-sunken/60 px-3 text-xs text-text-muted transition-colors duration-150 hover:border-info hover:bg-info-soft hover:text-primary-900"
      >
        <span className="font-medium text-text-muted">{m.labelFa}</span>
        {m.competitorTerm && m.competitorTerm !== m.labelFa ? <span className="text-text-faint">({m.competitorTerm})</span> : null}
        <span aria-hidden className="text-text-faint">·</span>
        <span>{m.month ?? `فاز ${m.phase}`}</span>
      </Link>
    </li>
  );
}
