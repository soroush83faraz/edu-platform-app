// lib/jobs/scheduler — recurring schedules (src/modules/ops/schedules.ts) on top of the job queue. Leader-safe without
// a leader: every worker ticks, and a tick takes the DUE rows of ops.schedule `FOR UPDATE SKIP LOCKED` — one worker
// gets a row, any other skips it — then, while holding it, enqueues one job per organization that is not suspended
// (each in that organization's own `withTenant` transaction, dedupe key `schedule:<name>:<tick>`), and only then moves
// `next_fire_at` on and commits. A crash in between leaves the row due: the next tick re-fires the SAME tick, and the
// dedupe keys make that a no-op for every organization already done. A tick that was missed (no worker running)
// fires once, labelled with the tick it was due at; the next one is computed from now (no burst of catch-up runs).
//
// Needs two pool connections at once (the schedule row's transaction + one organization's) — DB_POOL_MAX ≥ 2.
import { sql } from "drizzle-orm";
import { withTenant, withoutTenant } from "@/db/client";
import { logger } from "@/lib/logger";
import { DEFAULT_TIME_ZONE, nextFire, parseCron } from "@/modules/ops/cron";
import { insertJob } from "@/modules/ops/enqueue";
import type { JobKindDef } from "@/modules/ops/kinds";
import { SCHEDULE_NAME_RE, type ScheduleDef, scheduleDedupeKey } from "@/modules/ops/schedules";

export interface ScheduleCheckInput {
  name: string;
  cron: string;
  kind: string;
}

/** What is wrong with a set of schedules (empty = fine): names, cron, kinds, duplicates. */
export function scheduleProblems(defs: readonly ScheduleCheckInput[], kinds: Readonly<Record<string, JobKindDef>>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (!SCHEDULE_NAME_RE.test(d.name)) problems.push(`${d.name}: bad schedule name`);
    if (seen.has(d.name)) problems.push(`${d.name}: registered twice`);
    seen.add(d.name);
    if (!(d.kind in kinds)) problems.push(`${d.name}: unknown job kind ${d.kind}`);
    try {
      nextFire(parseCron(d.cron), new Date(0));
    } catch (err) {
      problems.push(`${d.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return problems;
}

/**
 * Upserts the code's schedules into ops.schedule; a changed cron restarts its clock from `now`. A stored tick that can
 * never be right is repaired the same way (security review 2026-10-20, F4): not finite, or LATER than the next tick the
 * cron gives from now — only tampering or a broken clock writes either, and either would silence the schedule. (Firing
 * a tick again is harmless: its jobs are deduplicated by `schedule:<name>:<tick>`.) The table refuses non-finite ticks
 * outright since migration 0032.
 */
export async function syncSchedules(defs: readonly ScheduleCheckInput[], kinds: Readonly<Record<string, JobKindDef>>, now: Date = new Date()): Promise<void> {
  const problems = scheduleProblems(defs, kinds);
  if (problems.length > 0) throw new Error(`schedules: ${problems.join("; ")}`);
  await withoutTenant(async (tx) => {
    for (const d of defs) {
      const next = nextFire(parseCron(d.cron), now, DEFAULT_TIME_ZONE);
      await tx.execute(sql`
        insert into ops.schedule as s (name, cron, kind, next_fire_at)
        values (${d.name}, ${d.cron}, ${d.kind}, ${next.toISOString()}::timestamptz)
        on conflict (name) do update
          set kind = excluded.kind,
              cron = excluded.cron,
              next_fire_at = case
                when s.cron is distinct from excluded.cron then excluded.next_fire_at
                when not isfinite(s.next_fire_at) or s.next_fire_at > excluded.next_fire_at then excluded.next_fire_at
                else s.next_fire_at end,
              last_fired_at = case when s.last_fired_at is null or isfinite(s.last_fired_at) then s.last_fired_at end`);
    }
  });
}

export interface FiredTick {
  name: string;
  tick: string;
  organizations: number;
  enqueued: number;
}

/** One scheduler turn at `now`: fires every due schedule this worker could lock. */
export async function tickSchedules(defs: readonly ScheduleDef[] | readonly ScheduleCheckInput[], kinds: Readonly<Record<string, JobKindDef>>, now: Date = new Date()): Promise<FiredTick[]> {
  const byName = new Map(defs.map((d) => [d.name, d]));
  if (byName.size === 0) return [];
  const names = `{${[...byName.keys()].join(",")}}`;
  return withoutTenant(async (tx) => {
    const due = await tx.execute<{ name: string; next_fire_at: Date | string }>(sql`
      select name, next_fire_at from ops.schedule
      where name = any(${names}::text[]) and next_fire_at <= ${now.toISOString()}::timestamptz
      order by next_fire_at, name
      for update skip locked`);
    if (due.rows.length === 0) return [];
    const orgs = await tx.execute<{ id: string }>(sql`select id from tenancy.organization where status <> 'suspended' order by id`);
    const fired: FiredTick[] = [];
    for (const row of due.rows) {
      const def = byName.get(row.name)!;
      const kindDef = kinds[def.kind];
      const tick = new Date(row.next_fire_at);
      const dedupeKey = scheduleDedupeKey(def.name, tick);
      let enqueued = 0;
      for (const org of orgs.rows) {
        const r = await withTenant({ orgId: org.id }, (t) => insertJob(t, org.id, def.kind, kindDef, {}, { dedupeKey }));
        if (r.created) enqueued++;
      }
      const next = nextFire(parseCron(def.cron), now, DEFAULT_TIME_ZONE);
      await tx.execute(sql`update ops.schedule set last_fired_at = ${tick.toISOString()}::timestamptz, next_fire_at = ${next.toISOString()}::timestamptz where name = ${def.name}`);
      fired.push({ name: def.name, tick: tick.toISOString(), organizations: orgs.rows.length, enqueued });
    }
    for (const f of fired) logger.info(f, "scheduler: tick fired");
    return fired;
  });
}
