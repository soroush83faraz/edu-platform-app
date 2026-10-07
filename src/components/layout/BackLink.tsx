import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * The «بازگشت» control at the top (start/right) of a page BODY — the public pages' `PublicBackLink` and the classic
 * layout's `PageHeader` `back` (owner, nav round 2026-09-27: the grey text link was hard to see). In the hub layout an
 * inner page's way back lives in the top bar instead (`TopBarBack`, owner 2026-10-06). A quiet pill:
 * `primary-700` semibold text after a `ChevronRight` (in RTL it points right, back towards the start), on the
 * `surface-sunken` tint with a `primary-100` hairline — clearly a control, never a filled button, so it does not
 * compete with the page's one primary action. 44 px tall (the touch-target rule) on every breakpoint.
 */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "pressable inline-flex min-h-11 items-center gap-1 self-start rounded-full bg-surface-sunken ps-2.5 pe-4 text-sm font-semibold text-primary-700 ring-1 ring-primary-100 ring-inset hover:bg-primary-50 hover:text-primary-800 active:bg-primary-50",
        className,
      )}
    >
      <ChevronRight className="size-4.5 shrink-0" strokeWidth={2.25} aria-hidden />
      {label}
    </Link>
  );
}
