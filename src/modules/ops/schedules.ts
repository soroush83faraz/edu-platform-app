// ops/schedules — the recurring schedules, registered in code (the worker upserts them into ops.schedule at start;
// src/lib/jobs/scheduler.ts). Cron in Asia/Tehran wall-clock time (./cron.ts). Each tick fans out: ONE job of `kind`
// per organization that is not suspended, with the dedupe key `schedule:<name>:<tick>` — so a tick fires once even
// with two workers, a crashed scheduler re-firing it, or both. A missed tick (no worker running) fires once when a
// worker comes back, never as a burst; the next one is computed from that moment.
//
// Minutes are spread off the hour on purpose (load on the database, and on the one CPU of the server).
import type { JobKind } from "./kinds";

export interface ScheduleDef {
  /** Unique, stable: renaming a schedule starts a new row (the old one is ignored). */
  name: string;
  cron: string;
  kind: JobKind;
  description: string;
}

export const SCHEDULES: readonly ScheduleDef[] = [
  { name: "files.sweep_orphans.hourly", cron: "17 * * * *", kind: "files.sweep_orphans", description: "orphan upload bytes, every hour at :17" },
  { name: "files.expire_uploads.hourly", cron: "47 * * * *", kind: "files.expire_uploads", description: "uploads left pending for 24 h, every hour at :47" },
  { name: "workspace.scan_deadlines.15min", cron: "7,22,37,52 * * * *", kind: "workspace.scan_deadlines", description: "deadline reminders and overdue notices, every 15 minutes at :07" },
  { name: "workspace.check_request_slas.15min", cron: "4,19,34,49 * * * *", kind: "workspace.check_request_slas", description: "request response times, every 15 minutes at :04" },
  { name: "ops.prune_jobs.nightly", cron: "30 3 * * *", kind: "ops.prune_jobs", description: "finished jobs, every night at 03:30 Tehran" },
];

export const SCHEDULE_NAME_RE = /^[a-z][a-z0-9_.-]{2,79}$/;

/** The dedupe key of the jobs one tick of a schedule fans out. */
export function scheduleDedupeKey(name: string, tick: Date): string {
  return `schedule:${name}:${tick.toISOString()}`;
}
