"use client";

import { useTransition } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { clearAllCaches } from "@/lib/pwa/client";

/**
 * Logout that first empties this origin's Cache Storage (a shared phone must not keep the previous student's
 * shell), then calls the server action, which revokes the session and redirects to /login?out=1 (Clear-Site-Data).
 */
export function LogoutButton({
  action,
  label,
  variant = "outline",
  className,
}: {
  action: () => Promise<never>;
  label: string;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      className={cn("h-12 w-full rounded-xl", className)}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await clearAllCaches();
          await action();
        })
      }
    >
      {pending ? "در حال خروج…" : label}
    </Button>
  );
}
