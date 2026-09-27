import { BrandRipple } from "@/components/brand/BrandRipple";
import { contextLineFa } from "@/lib/context-place";
import { formatJalaliWeekdayDate } from "@/lib/format";
import type { Assignment } from "@/modules/iam/can";
import { getShellContext } from "@/lib/shell-context";

/**
 * The top of Home in the hub layout, on every size (owner, 2026-09-27): ONE blue brand card — the `bg-hero`
 * persian-blue gradient, `rounded-hero` — with «سلام، <first name>» in white, today's Jalali weekday and date, and
 * the school as a meta line. At the end side, clipped by the card, the «دانینو» mark stands faint in a few still
 * water rings (the splash's ripple, docs/decisions-pending/home-hub.md) — white at low opacity, no extra hue, no
 * glow — kept clear of the text (`pe-*`). Every text line is pure white: the gradient's light end (#0B6FD1) takes
 * white at 5:1, but white/80 would drop to 3.8:1 there. The place follows the one rule (`contextLineFa`): the
 * ORGANIZATION admin reads «مدیر سازمان · <organization>» — never the school or branch name, even when the
 * organization has one school (owner, 2026-09-27); an admin whose scope holds several schools is introduced by the
 * organization; everyone else by their school. Static: no link, no hover.
 */
export async function HubGreeting({
  firstName,
  schoolName,
  orgName,
  assignments,
}: {
  firstName: string;
  schoolName: string | null;
  orgName: string;
  assignments: readonly Assignment[];
}) {
  const shell = await getShellContext();
  const line = contextLineFa(shell, { orgName, schoolName, assignments });
  return (
    <header className="relative isolate overflow-hidden rounded-hero bg-hero px-5 py-5 text-white shadow-1 lg:px-8 lg:py-7">
      <BrandRipple className="-end-10 top-1/2 size-48 -translate-y-1/2 lg:end-12 lg:size-72" markClassName="lg:size-20" />
      <div className="flex flex-col gap-1 pe-32 lg:pe-80">
        <h2 className="text-title font-bold text-white">
          سلام، <bdi>{firstName}</bdi>
        </h2>
        <p className="text-meta font-medium text-white">{formatJalaliWeekdayDate()}</p>
        <p className="text-meta text-white">
          {line.role ? `${line.role} · ` : null}
          <bdi>{line.place}</bdi>
        </p>
      </div>
    </header>
  );
}
