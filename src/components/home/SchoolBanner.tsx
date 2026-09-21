import { SchoolClay } from "@/components/illustrations";
import { formatJalaliLong } from "@/lib/format";

/**
 * The school's name card at the top of Home — the one persian-blue block of the page: the hero gradient
 * (primary-600 → sky-strong, white text ≥ 4.8:1 on every pixel), the clay school mark on a white plate so its blue
 * roof stays readable, then one line with the greeting and today's Jalali date. Rendered synchronously from the
 * request context — nothing to wait for.
 */
export function SchoolBanner({ schoolName, firstName }: { schoolName: string; firstName: string }) {
  return (
    <section aria-label="مدرسه" className="on-hero flex flex-col items-center gap-1 rounded-hero bg-hero px-4 pt-5 pb-5 text-center text-on-hero shadow-hero">
      <span className="grid size-16 place-items-center rounded-2xl bg-surface shadow-1">
        <SchoolClay size={52} />
      </span>
      <h2 className="mt-2 text-xl font-bold leading-8 text-on-hero">
        <bdi>{schoolName}</bdi>
      </h2>
      <p className="text-sm font-medium text-on-hero">
        سلام، <bdi>{firstName}</bdi>
        <span aria-hidden> · </span>
        {formatJalaliLong()}
      </p>
    </section>
  );
}
