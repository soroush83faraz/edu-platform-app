import type { UpcomingTile } from "@/lib/modules-registry";
import { ModuleTileFace } from "./ModuleTileFace";

/**
 * The hub Home's «به‌زودی» section (owner, 2026-09-27): the modules that are not built yet, as tiles of the same
 * shape as the live ones — the `grey` clay mark, a muted label and a small «به‌زودی» pill under it — in their OWN
 * section under the live tiles, headed «به‌زودی», so live and upcoming never mix. They are not doors: no link, no
 * href, nothing to tap (`aria-disabled`), no hover; what each one will do is on «بیشتر ← نقشهٴ راه».
 * `gridClassName` is the grid of the live tiles above it (phone grid or desktop board), so both line up. The tile face
 * (`ModuleTileFace`) is shared with the roadmap page, where the same tiles open their description.
 */
export function UpcomingTiles({ tiles, gridClassName, compact = false }: { tiles: UpcomingTile[]; gridClassName: string; compact?: boolean }) {
  if (tiles.length === 0) return null;
  return (
    <section aria-label="به‌زودی" className="flex flex-col gap-2">
      <h2 className="text-section font-bold text-text">به‌زودی</h2>
      <ul className={gridClassName}>
        {tiles.map((t) => (
          <li key={t.code} className="flex justify-center">
            <ModuleTileFace icon={t.icon} label={t.labelFa} soon inert compact={compact} />
          </li>
        ))}
      </ul>
    </section>
  );
}
