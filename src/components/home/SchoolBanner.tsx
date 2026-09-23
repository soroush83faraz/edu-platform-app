import { RoleMark } from "@/components/brand/RoleMark";
import type { RoleKey } from "@/components/brand/roles";
import { NotificationsBell } from "@/components/home/NotificationsBell";
import { SchoolClay } from "@/components/illustrations";
import { formatJalaliLong } from "@/lib/format";

/**
 * The school's name card at the top of Home on phones and tablets — the one persian-blue block of the page: the
 * hero gradient (primary-600 → sky-strong, white text ≥ 4.8:1 on every pixel), the ROLE mark on the white plate
 * that used to carry the clay school mark (branding round — the emblem names the kind of account; the school name
 * is the line under it), then one line with the greeting and today's Jalali date. ~145 px tall
 * (Design v2 trimmed it a fifth). From `lg:` the page draws the compact `PageHeader` instead — no gradient block on
 * desktop. Rendered synchronously from the request context — nothing to wait for.
 */
export function SchoolBanner({ schoolName, firstName, hats = [] }: { schoolName: string; firstName: string; hats?: readonly RoleKey[] }) {
  return (
    <section aria-label="مدرسه" className="on-hero relative flex flex-col items-center gap-0.5 rounded-hero bg-hero px-4 pt-4 pb-4 text-center text-on-hero shadow-hero lg:hidden">
      {/* «اعلان‌ها» left the bottom bar in round 3 and its one door is this bell, in the banner's start corner
          with its unread pill. «پنل من» used to sit beside it; round 5 made the کارتابل a TILE in the grid
          below (owner: an icon you tap on Home), so the bell stands alone here. */}
      <span className="absolute top-2 start-2 flex items-center gap-0.5">
        <NotificationsBell tone="hero" />
      </span>
      {/* The white plate that carried the clay school mark now carries the ROLE glyph (owner, branding round):
          same plate, same 52 px, same place — only the glyph changes, and the school name stays right under it.
          A person with no hat keeps the school illustration. */}
      {hats.length > 0 ? (
        <RoleMark hats={hats} tone="plate" />
      ) : (
        <span className="grid size-13 place-items-center rounded-2xl bg-surface shadow-1">
          <SchoolClay size={44} />
        </span>
      )}
      <h2 className="mt-1.5 text-lg font-bold leading-7 text-on-hero">
        <bdi>{schoolName}</bdi>
      </h2>
      <p className="text-meta font-medium text-on-hero">
        سلام، <bdi>{firstName}</bdi>
        <span aria-hidden> · </span>
        {formatJalaliLong()}
      </p>
    </section>
  );
}
