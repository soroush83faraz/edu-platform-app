import { DoninoMark } from "@/components/brand/DoninoMark";
import { formatJalaliWeekdayDate } from "@/lib/format";
import { getShellContext } from "@/lib/shell-context";

/** The water rings round the mark, strongest inside — the splash's ripple, standing still (radii in a 200 unit box). */
const RINGS: readonly [r: number, opacity: number][] = [
  [44, 0.22],
  [64, 0.15],
  [84, 0.1],
  [99, 0.06],
];

/**
 * The top of Home in the hub layout, on every size (owner, 2026-09-27): ONE blue brand card — the `bg-hero`
 * persian-blue gradient, `rounded-hero` — with «سلام، <first name>» in white, today's Jalali weekday and date, and
 * the school as a meta line. At the end side, clipped by the card, the «دانینو» mark stands faint in a few still
 * water rings (the splash's ripple, docs/decisions-pending/home-hub.md) — white at low opacity, no extra hue, no
 * glow — kept clear of the text (`pe-*`). Every text line is pure white: the gradient's light end (#0B6FD1) takes
 * white at 5:1, but white/80 would drop to 3.8:1 there. The school follows the shell's rule (`AppShell`): an admin
 * whose scope holds several schools is introduced by the ORGANIZATION. Static: no link, no hover.
 */
export async function HubGreeting({ firstName, schoolName, orgName }: { firstName: string; schoolName: string | null; orgName: string }) {
  const shell = await getShellContext();
  const school = (shell.schools.length > 1 ? orgName : schoolName) ?? orgName;
  return (
    <header className="relative isolate overflow-hidden rounded-hero bg-hero px-5 py-5 text-white shadow-1 lg:px-8 lg:py-7">
      <div aria-hidden className="pointer-events-none absolute -end-10 top-1/2 -z-10 grid size-48 -translate-y-1/2 place-items-center lg:end-12 lg:size-72">
        <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" focusable="false">
          {RINGS.map(([r, opacity]) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeOpacity={opacity} strokeWidth="1.5" />
          ))}
        </svg>
        <DoninoMark size={56} className="relative text-white/20 lg:size-20" />
      </div>
      <div className="flex flex-col gap-1 pe-32 lg:pe-80">
        <h2 className="text-title font-bold text-white">
          سلام، <bdi>{firstName}</bdi>
        </h2>
        <p className="text-meta font-medium text-white">{formatJalaliWeekdayDate()}</p>
        <p className="text-meta text-white">
          <bdi>{school}</bdi>
        </p>
      </div>
    </header>
  );
}
