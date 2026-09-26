"use client";

import { useEffect, useState } from "react";

// The last value each remembered counter showed in this app session, so a counter that is mounted again (Home's
// «امروز» line after a trip to an item) still rolls from what the reader saw last. Written only in effects —
// never on the server — so a server render and the client's first render always agree.
const lastShown = new Map<string, number>();

/** Remember a counter that is not on screen right now (a zero fragment that is filtered out). */
export function rememberCount(memoryKey: string, value: number): void {
  lastShown.set(memoryKey, value);
}

type Roll = { value: number; key: number; dir: "up" | "down" | null; from: number | null };

/**
 * `dir` is set when `value` changes after the first render (or differs from what `memoryKey` last showed): the
 * direction the new number rolls in from; `from` is the number it replaced. `key` changes with it so the animation
 * restarts on every change.
 */
export function useCountRoll(value: number, memoryKey?: string): Roll {
  const [roll, setRoll] = useState<Roll>(() => {
    const before = memoryKey === undefined ? undefined : lastShown.get(memoryKey);
    const changed = before !== undefined && before !== value;
    return { value, key: 0, dir: changed ? (value > before ? "up" : "down") : null, from: changed ? before : null };
  });
  // "Adjust state when a prop changes" — compared by value, during render, so the new number never paints still.
  if (roll.value !== value) setRoll({ value, key: roll.key + 1, dir: value > roll.value ? "up" : "down", from: roll.value });
  useEffect(() => {
    if (memoryKey !== undefined) lastShown.set(memoryKey, value);
  }, [memoryKey, value]);
  return roll;
}

/**
 * A number that rolls when it changes — never on first render: up from below when it grew, down from above when it
 * shrank, 250 ms (`count-up` / `count-down` in globals.css; still under reduced motion). `children` is the
 * formatted text («۳», «۹۹+»); `value` is what is compared.
 */
export function RollingNumber({ value, memoryKey, children, className }: { value: number; memoryKey?: string; children: React.ReactNode; className?: string }) {
  const roll = useCountRoll(value, memoryKey);
  const cls = roll.dir === "up" ? "count-up" : roll.dir === "down" ? "count-down" : undefined;
  return (
    <span key={roll.key} className={[cls, className].filter(Boolean).join(" ") || undefined}>
      {children}
    </span>
  );
}
