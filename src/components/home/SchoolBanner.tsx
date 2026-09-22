import { NotificationsBell } from "@/components/home/NotificationsBell";
import { SchoolClay } from "@/components/illustrations";
import { formatJalaliLong } from "@/lib/format";

/**
 * The school's name card at the top of Home on phones and tablets — the one persian-blue block of the page: the
 * hero gradient (primary-600 → sky-strong, white text ≥ 4.8:1 on every pixel), the clay school mark on a white
 * plate so its blue roof stays readable, then one line with the greeting and today's Jalali date. ~145 px tall
 * (Design v2 trimmed it a fifth). From `lg:` the page draws the compact `PageHeader` instead — no gradient block on
 * desktop. Rendered synchronously from the request context — nothing to wait for.
 */
export function SchoolBanner({ schoolName, firstName }: { schoolName: string; firstName: string }) {
  return (
    <section aria-label="مدرسه" className="on-hero relative flex flex-col items-center gap-0.5 rounded-hero bg-hero px-4 pt-4 pb-4 text-center text-on-hero shadow-hero lg:hidden">
      {/* The one door to «اعلان‌ها» on phones (it left the bottom bar): the bell in the banner's start corner. */}
      <span className="absolute top-2 start-2">
        <NotificationsBell tone="hero" />
      </span>
      <span className="grid size-13 place-items-center rounded-2xl bg-surface shadow-1">
        <SchoolClay size={44} />
      </span>
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
