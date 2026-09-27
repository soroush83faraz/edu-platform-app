import { UserRound } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * The hub layout's profile door (docs/decisions-pending/home-hub.md): a 44 px round button at the START (right) of
 * the top bar that opens «بیشتر» — the account page (profile, password, help, logout). It draws the person glyph
 * (lucide `UserRound`) on a `surface-panel` circle — the owner preferred an icon to the first-name initial
 * (2026-09-27). Not a primary action: no fill, no blue.
 */
export function ProfileButton({ className }: { className?: string }) {
  return (
    <Link
      href="/more"
      aria-label="حساب من"
      className={cn("pressable surface-panel grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-base hover:text-text", className)}
    >
      <UserRound className="size-6" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}
