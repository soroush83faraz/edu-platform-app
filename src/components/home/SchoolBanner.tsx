import { SchoolClay } from "@/components/illustrations";
import { formatJalaliLong } from "@/lib/format";

/**
 * The school's name card at the top of Home (the reference app opens the same way): icy tint, centred, the clay
 * school mark, then one quiet line with the greeting and today's Jalali date. Rendered synchronously from the
 * request context — nothing to wait for.
 */
export function SchoolBanner({ schoolName, firstName }: { schoolName: string; firstName: string }) {
  return (
    <section aria-label="مدرسه" className="flex flex-col items-center gap-1 rounded-card bg-info-soft px-4 pt-4 pb-4 text-center">
      <SchoolClay size={56} />
      <h2 className="mt-1 text-lg font-bold leading-7 text-primary-900">
        <bdi>{schoolName}</bdi>
      </h2>
      <p className="text-sm text-primary-800/80">
        سلام، <bdi>{firstName}</bdi>
        <span aria-hidden> · </span>
        {formatJalaliLong()}
      </p>
    </section>
  );
}
