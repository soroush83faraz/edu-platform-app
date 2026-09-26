"use client";

import { useEffect, useState } from "react";
import { tehranClock, tehranMinutesPrecise, timeToMinutes, type Weekday } from "@/lib/timetable";

export interface LiveClock {
  /** Saturday-start weekday of the Tehran day. */
  weekday: Weekday;
  /** Minutes since Tehran midnight, fractional (seconds included) once the client ticks. */
  minutes: number;
}

/** How often the clock re-reads the time; the progress bar's transition lasts exactly this long, so it glides. */
export const CLOCK_TICK_MS = 30_000;

interface FakeNow {
  base: number | null;
  weekday: Weekday | null;
  at: number;
}

/**
 * Development only: `?now=10:20` pins the Tehran time (it then keeps running from there) and `?today=3` the
 * weekday, so the live states and the progress bar can be seen outside school hours. The `NODE_ENV` check is a
 * build-time constant — the production bundle drops this branch and ignores both params.
 */
function devOverride(): FakeNow | null {
  if (process.env.NODE_ENV === "production") return null;
  const q = new URLSearchParams(window.location.search);
  const t = q.get("now");
  const d = q.get("today");
  const base = t ? timeToMinutes(t) : Number.NaN;
  const weekday = d !== null && /^[0-6]$/.test(d) ? (Number(d) as Weekday) : null;
  if (Number.isNaN(base) && weekday === null) return null;
  return { base: Number.isNaN(base) ? null : base, weekday, at: Date.now() };
}

function read(fake: FakeNow | null): LiveClock {
  const now = new Date();
  const real = { weekday: tehranClock(now).weekday, minutes: tehranMinutesPrecise(now) };
  if (!fake) return real;
  return {
    weekday: fake.weekday ?? real.weekday,
    minutes: fake.base === null ? real.minutes : fake.base + (now.getTime() - fake.at) / 60_000,
  };
}

/**
 * The Tehran clock of the timetable on the client. The first render uses `initial` (the server's clock at render
 * time, so hydration matches); after mount it reads the real time and re-reads every `CLOCK_TICK_MS` and whenever
 * the tab becomes visible again — a page left open through the morning moves «الان» from زنگ to زنگ on its own.
 */
export function useLiveClock(initial: LiveClock): LiveClock {
  const [clock, setClock] = useState<LiveClock>(initial);
  useEffect(() => {
    const fake = devOverride();
    const tick = () => setClock(read(fake));
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, CLOCK_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return clock;
}
