import { Plus } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

/**
 * The one floating action of the product: «کار جدید». School-bus yellow fill with navy text (yellow is never text),
 * phones only — desktop pages show the same action in their header. Sits above the bottom nav and the safe area.
 */
export function Fab({ href = "/inbox/new", label = "کار جدید", className }: { href?: string; label?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "pressable fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] end-4 z-20 inline-flex h-12 items-center gap-2 rounded-full bg-warning ps-4 pe-5 text-sm font-semibold text-primary-900 shadow-fab hover:-translate-y-0.5 active:translate-y-0 active:shadow-1 md:hidden",
        className,
      )}
    >
      <Plus className="size-5" aria-hidden />
      {label}
    </Link>
  );
}
