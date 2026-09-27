import { CircleUser } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * The hub layout's profile door (owner trial, docs/decisions-pending/home-hub.md): a 44 px round avatar at the
 * START (right) of the top bar that opens «بیشتر» — which acts as the profile page in hub mode. It shows the
 * viewer's initial (the first letter of the first name) on a `surface-panel` circle; with no usable name, the
 * lucide `CircleUser` glyph. Not a primary action: no fill, no blue.
 */
export function ProfileButton({ firstName, className }: { firstName: string; className?: string }) {
  const initial = Array.from(firstName.trim())[0];
  return (
    <Link
      href="/more"
      aria-label="حساب من"
      className={cn("pressable surface-panel grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-base hover:text-text", className)}
    >
      {initial ? (
        <span aria-hidden className="text-row font-bold text-text">
          {initial}
        </span>
      ) : (
        <CircleUser className="size-6" strokeWidth={1.75} aria-hidden />
      )}
    </Link>
  );
}
