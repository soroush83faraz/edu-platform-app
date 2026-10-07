import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * «برگشت» in the hub layout's top bar (owner, 2026-10-06): the inner page's way back to its logical parent, drawn in
 * the bar's START slot instead of a row in the page body. A white pill (`bg-surface` + `shadow-1`, like the mock's
 * top-bar controls), 44 px tall, an `ArrowRight` (RTL: back points to the start) and the destination's name in
 * `primary-700` semibold — clearly a control, never a filled button. Long names («دبیرستان شهید …») truncate so
 * the bell and the profile at the end always keep their room.
 *
 * Plumbing (docs/decisions.md «top bar back»): the page declares its parent once, in `PageHeader`'s `back`, and
 * `PageHeader` renders this — still a server component in the page's own tree — as a FIXED layer that repeats the
 * bar's box exactly (full width, safe-area top, the content column's 1200 px and gutters, 56 / 64 px tall), so the
 * pill lands on the bar's start slot from the first paint: no portal, no hydration step, no layout shift (it is out
 * of flow, so the page's own flex gaps do not see it). The layer itself lets taps through (`pointer-events-none`);
 * only the pill takes them. It is a direct child of the page column, never inside the `<header>` grid: a
 * `max-lg:sr-only` header clips its descendants, and the `reveal-*` entrances (opacity + translate) would turn the
 * header into the containing block of a fixed child — so the layer opts out of those entrances (`animate-none!`).
 */
export function TopBarBack({ href, label }: { href: string; label: string }) {
  return (
    <TopBarStart>
      <Link
        href={href}
        className="pressable pointer-events-auto inline-flex min-h-11 max-w-[calc(100%-7rem)] min-w-0 items-center gap-1.5 rounded-full bg-surface ps-2.5 pe-4 text-sm font-semibold text-primary-700 shadow-1 hover:text-primary-800"
      >
        <ArrowRight className="size-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="truncate">{label}</span>
      </Link>
    </TopBarStart>
  );
}

/**
 * The pill's stand-in for a `loading.tsx` whose route segment covers pages with different parents (the admin area,
 * «حضور و غیاب»): the same white pill and arrow with a skeleton where the name goes, so the bar is already in its
 * inner-page arrangement while the page streams and only the label fills in. Not a link.
 */
export function TopBarBackPlaceholder() {
  return (
    <TopBarStart>
      <span aria-hidden className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface ps-2.5 pe-4 text-primary-700 shadow-1">
        <ArrowRight className="size-5 shrink-0" strokeWidth={2} aria-hidden />
        <Skeleton className="h-3.5 w-12" />
      </span>
    </TopBarStart>
  );
}

/**
 * The fixed layer over the top bar's start slot — the bar's own box (`AppShell`), repeated. `data-topbar-back` is
 * the marker the bar reads: while a node carrying it is in the page, the bar moves the profile button from its START
 * slot to the END, beside the bell (`group-has-[[data-topbar-back]]/shell:` on the shell column). Pure CSS, so it is
 * right on the first server paint, follows every client navigation and every streamed `loading.tsx` swap with no
 * JS, and Home — which draws none — keeps its bar exactly as before (profile start, bell end).
 */
function TopBarStart({ children }: { children: React.ReactNode }) {
  return (
    <div data-topbar-back="" className="pointer-events-none fixed inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)] animate-none! print:hidden">
      <div className="mx-auto flex h-14 w-full max-w-content items-center px-4 lg:h-16 lg:px-8">{children}</div>
    </div>
  );
}
