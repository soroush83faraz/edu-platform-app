import { ClayIcon } from "@/components/ClayIcon";
import { cn } from "@/lib/cn";
import type { UpcomingTile } from "@/lib/modules-registry";

/**
 * The hub Home's «به‌زودی» section (owner, 2026-09-27): the modules that are not built yet, as tiles of the same
 * shape as the live ones — the `grey` clay mark, a muted label and a small «به‌زودی» pill under it — in their OWN
 * section under the live tiles, headed «به‌زودی», so live and upcoming never mix. They are not doors: no link, no
 * href, nothing to tap (`aria-disabled`), no hover; what each one will do is on «بیشتر ← نقشهٴ راه».
 * `gridClassName` is the grid of the live tiles above it (phone grid or desktop board), so both line up.
 */
export function UpcomingTiles({ tiles, gridClassName, compact = false }: { tiles: UpcomingTile[]; gridClassName: string; compact?: boolean }) {
  if (tiles.length === 0) return null;
  return (
    <section aria-label="به‌زودی" className="flex flex-col gap-2">
      <h2 className="text-section font-bold text-text">به‌زودی</h2>
      <ul className={gridClassName}>
        {tiles.map((t) => (
          <li key={t.code} className="flex justify-center">
            <div
              aria-disabled="true"
              className={cn(
                "flex w-full max-w-32 flex-col items-center justify-start px-1 text-center",
                compact ? "min-h-24 gap-1.5 pt-2 pb-1.5" : "min-h-28 gap-2 pt-2.5 pb-2",
              )}
            >
              <ClayIcon icon={t.icon} size={compact ? "xl" : "tile"} shade="grey" />
              <span className="text-meta font-semibold text-balance text-text-muted">{t.labelFa}</span>
              <span className="rounded-full bg-surface px-2 text-xs leading-5 font-medium text-text-muted">به‌زودی</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
