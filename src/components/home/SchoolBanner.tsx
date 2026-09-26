import { NotificationsBell } from "@/components/home/NotificationsBell";
import { formatJalaliWeekdayDate } from "@/lib/format";

/**
 * The top of Home on phones and tablets: a flat, start-aligned greeting straight on the canvas — the first name as
 * the title, a meta line with today («سه‌شنبه ۷ مهر»), and «اعلان‌ها» (the bell, its one door) at the end. The school
 * is NOT repeated here: the shell's sticky header names it one line above (role mark + school) on every page.
 * UX review 2026-09-27 (owner): no gradient block, no blue glow, no centred emblem — a school app says good morning
 * and the date, the way a notebook page does. From `lg:` the page draws the `PageHeader` instead, whose
 * context bar already carries the school and the date. Rendered synchronously from the request context.
 */
export function SchoolBanner({ firstName }: { firstName: string }) {
  return (
    <header className="flex items-start gap-3 lg:hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-title font-bold text-text">
          سلام، <bdi>{firstName}</bdi>
        </h2>
        <p className="text-meta text-text-muted">{formatJalaliWeekdayDate()}</p>
      </div>
      <NotificationsBell />
    </header>
  );
}
