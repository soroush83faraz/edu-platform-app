"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { InlineScript } from "@/components/InlineScript";
import { REVEAL_BOOT_SCRIPT } from "@/lib/reveal-once";

/**
 * Entrances once per session (`src/lib/reveal-once.ts`): the boot script covers document loads, and the first
 * client-side navigation away from the page the session opened on sets `data-seen` for the rest of it.
 */
export function RevealSession() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname !== first.current) document.documentElement.dataset.seen = "";
  }, [pathname]);
  return <InlineScript code={REVEAL_BOOT_SCRIPT} />;
}
