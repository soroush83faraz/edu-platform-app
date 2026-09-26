"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { RollingNumber } from "@/components/motion/RollingNumber";

export interface SegmentedLinkItem {
  key: string;
  href: string;
  label: string;
  /** A rendered glyph (it takes the segment's colour through `currentColor`). */
  icon: React.ReactNode;
  count?: { value: number; text: string; label: string };
}

/**
 * A segmented control made of links (the کارتابل's «انجام‌نشده / انجام‌شده»). ONE white pill slides under the
 * active segment (translate, 240 ms, the house ease) instead of each segment switching its own background; it moves
 * the moment a segment is tapped, before the new list arrives, and settles on the server's answer. Tabs' counts roll
 * when they change. RTL: the first segment sits at the start (right) and the pill moves towards the end.
 */
export function SegmentedLinks({ label, items, current }: { label: string; items: SegmentedLinkItem[]; current: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [server, setServer] = useState(current);
  if (server !== current) {
    setServer(current);
    setPicked(null);
  }
  const active = picked ?? current;
  const index = Math.max(0, items.findIndex((i) => i.key === active));
  const n = items.length;

  return (
    <nav aria-label={label}>
      <div className="relative rounded-2xl bg-neutral-200/60 p-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-1 start-1 rounded-xl bg-surface shadow-1 transition-[translate] duration-(--duration-slow) ease-(--ease-out)"
          style={{ width: `calc((100% - 0.5rem - ${(n - 1) * 0.25}rem) / ${n})`, translate: `calc(${-index} * (100% + 0.25rem)) 0` }}
        />
        <ul className="relative grid gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {items.map((item) => {
            const on = item.key === active;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={item.key === current ? "page" : undefined}
                  onClick={(e) => {
                    if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) setPicked(item.key);
                  }}
                  className={cn(
                    "pressable flex h-14 flex-col items-center justify-center gap-0 rounded-xl px-1 text-sm sm:h-11 sm:flex-row sm:gap-1.5",
                    on ? "font-semibold text-primary-800" : "text-text-muted hover:text-text",
                  )}
                >
                  <span className={cn("flex shrink-0 transition-base", on ? "text-primary-600" : "text-text-faint")}>{item.icon}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{item.label}</span>
                    {item.count && item.count.value > 0 ? (
                      <span className={cn("tabular rounded-full px-1.5 text-xs leading-5 transition-base", on ? "bg-info-soft text-primary-800" : "bg-surface/70 text-text-muted")} aria-label={item.count.label}>
                        <RollingNumber value={item.count.value}>{item.count.text}</RollingNumber>
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
