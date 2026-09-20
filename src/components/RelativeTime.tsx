"use client";

import { useEffect, useState } from "react";
import { formatJalaliDateTime, formatRelativeDayFa, formatRelativeTimeFa } from "@/lib/format";

/**
 * Relative Jalali time. `mode="day"` → «فردا» / «۲ روز گذشته» (due dates); `mode="time"` → «۵ دقیقه پیش» (events).
 * Re-renders every minute so a long-open tab stays right; the first paint matches the server (same minute).
 */
export function RelativeTime({ at, mode = "day", className }: { at: Date | string; mode?: "day" | "time"; className?: string }) {
  const date = typeof at === "string" ? new Date(at) : at;
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const text = mode === "day" ? formatRelativeDayFa(date) : formatRelativeTimeFa(date);
  return (
    <time dateTime={date.toISOString()} title={formatJalaliDateTime(date)} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
