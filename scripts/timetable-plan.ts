// Pure weekly-timetable allocator shared by the demo seed (scripts/seed.ts) and the pilot seed (scripts/seed-pilot.ts):
// every offering of a class gets `sessions` cells of the 6-day × N-period grid, at most one per weekday when
// possible, and a teacher is never placed in two classes at the same (weekday, period). Deterministic — the same
// input yields the same grid, so re-running a seed inserts nothing new. Import-free apart from types.

export interface PlanOffering {
  key: string;
  /** Anything that identifies the teacher across classes (staff id, allocation index). */
  teacherKey: string;
  /** Sessions per week (2–4 in the seeds). */
  sessions: number;
}

export interface PlanClass {
  key: string;
  offerings: PlanOffering[];
}

export interface PlannedSlot {
  weekday: number;
  periodNo: number;
  offeringKey: string;
}

export interface TimetablePlan {
  /** class key → its slots (weekday, period order). */
  slots: Map<string, PlannedSlot[]>;
  /** Sessions that found no clash-free cell (should be empty for the seeds; asserted by the int test). */
  unplaced: Array<{ classKey: string; offeringKey: string }>;
}

/**
 * Greedy per class: cells are visited in a deterministic per-class shuffle (so the first period of شنبه is not
 * the same subject in every class and sessions spread over the week); at each cell the offering with the MOST
 * remaining sessions whose teacher is free and which has no session on that weekday yet is placed; when nothing
 * fits under that rule the same-weekday rule is dropped for the cell; a cell stays empty only if every pending
 * offering's teacher is busy there. A second pass over the empty cells retries the leftovers.
 */
export function planTimetables(classes: readonly PlanClass[], weekdays: readonly number[], periodNos: readonly number[]): TimetablePlan {
  const busy = new Set<string>(); // `${teacherKey}|${weekday}|${periodNo}`
  const slots = new Map<string, PlannedSlot[]>();
  const unplaced: TimetablePlan["unplaced"] = [];
  const cells: Array<{ weekday: number; periodNo: number }> = [];
  for (const weekday of weekdays) for (const periodNo of periodNos) cells.push({ weekday, periodNo });

  classes.forEach((cls, ci) => {
    const remaining = new Map(cls.offerings.map((o) => [o.key, o.sessions]));
    const teacherOf = new Map(cls.offerings.map((o) => [o.key, o.teacherKey]));
    const onDay = new Map<string, Set<number>>(cls.offerings.map((o) => [o.key, new Set<number>()]));
    const placed: PlannedSlot[] = [];
    const taken = new Set<string>();
    // A deterministic per-class shuffle of the cells: a plain weekday- or period-major sweep piles every session
    // onto the first days / first زنگ‌ها; a hashed order spreads them over the grid like a real timetable.
    const order = [...cells].sort((a, b) => mix(ci * 1000 + a.weekday * 20 + a.periodNo) - mix(ci * 1000 + b.weekday * 20 + b.periodNo));

    const pick = (cell: { weekday: number; periodNo: number }, allowSameDay: boolean): string | null => {
      let best: string | null = null;
      for (const [key, left] of remaining) {
        if (left <= 0) continue;
        const teacher = teacherOf.get(key)!;
        if (busy.has(`${teacher}|${cell.weekday}|${cell.periodNo}`)) continue;
        if (!allowSameDay && onDay.get(key)!.has(cell.weekday)) continue;
        if (best === null || left > remaining.get(best)!) best = key;
      }
      return best;
    };
    const place = (cell: { weekday: number; periodNo: number }, key: string) => {
      remaining.set(key, remaining.get(key)! - 1);
      onDay.get(key)!.add(cell.weekday);
      busy.add(`${teacherOf.get(key)!}|${cell.weekday}|${cell.periodNo}`);
      taken.add(`${cell.weekday}|${cell.periodNo}`);
      placed.push({ weekday: cell.weekday, periodNo: cell.periodNo, offeringKey: key });
    };

    for (const pass of [false, true] as const) {
      for (const cell of order) {
        if (taken.has(`${cell.weekday}|${cell.periodNo}`)) continue;
        const key = pick(cell, pass) ?? (pass ? null : pick(cell, true));
        if (key) place(cell, key);
      }
    }
    for (const [key, left] of remaining) for (let i = 0; i < left; i++) unplaced.push({ classKey: cls.key, offeringKey: key });
    placed.sort((a, b) => a.weekday - b.weekday || a.periodNo - b.periodNo);
    slots.set(cls.key, placed);
  });
  return { slots, unplaced };
}

/** A 32-bit integer mixer (the lowbias32 finalizer) — a tiny, dependency-free, deterministic hash for the cell order. */
function mix(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** True when no teacher appears twice at the same (weekday, period) across the plan. */
export function hasTeacherClash(plan: TimetablePlan, classes: readonly PlanClass[]): boolean {
  const seen = new Set<string>();
  for (const cls of classes) {
    const teacherOf = new Map(cls.offerings.map((o) => [o.key, o.teacherKey]));
    for (const s of plan.slots.get(cls.key) ?? []) {
      const k = `${teacherOf.get(s.offeringKey)}|${s.weekday}|${s.periodNo}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
  }
  return false;
}
