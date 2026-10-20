// lib/jobs/worker — the worker process's loop (scripts/worker.ts; the `worker` compose service). One turn: touch the
// liveness file, run the scheduler when its interval is up, ask for as many jobs as there are free slots (per kind and
// per process), start them, and sleep until the next poll or until a run finishes. Abort the signal (SIGTERM / SIGINT)
// and it stops claiming, waits up to `shutdownGraceMs` for the runs in flight, and returns; a run still going then is
// abandoned with its connection — its transaction rolls back and the job is re-claimed when its lease expires.
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { errorSummary } from "@/modules/ops/retry";
import type { ScheduleDef } from "@/modules/ops/schedules";
import { WORKER_ID_RE, claimWants } from "./plan";
import { type ClaimedJob, type JobRegistry, claimJobs, registryProblems, runJob } from "./runner";
import { scheduleProblems, syncSchedules, tickSchedules } from "./scheduler";

const WorkerEnv = z.object({
  /** Idle poll interval: how long a worker with nothing to do waits before asking again. */
  WORKER_POLL_MS: z.coerce.number().int().min(200).max(60_000).default(3_000),
  /** How often the scheduler looks for due schedules (the schedules have minute resolution). */
  WORKER_TICK_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  /** Runs at once in this process, all kinds together (each kind also has its own cap). */
  WORKER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** After SIGTERM: how long to wait for runs in flight (compose `stop_grace_period` must be longer). */
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(20_000),
  /** The file the healthcheck reads: its mtime is the last loop turn. */
  WORKER_ALIVE_FILE: z.string().trim().min(1).optional(),
  WORKER_ID: z.string().regex(WORKER_ID_RE).optional(),
});

export interface WorkerConfig {
  workerId: string;
  pollMs: number;
  tickEveryMs: number;
  maxConcurrency: number;
  shutdownGraceMs: number;
  aliveFile: string;
}

export const DEFAULT_ALIVE_FILE = path.join(os.tmpdir(), "edu-worker-alive");

export function workerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const e = WorkerEnv.parse(env);
  const host = os.hostname().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "host";
  return {
    workerId: e.WORKER_ID ?? `${host}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`,
    pollMs: e.WORKER_POLL_MS,
    tickEveryMs: e.WORKER_TICK_MS,
    maxConcurrency: e.WORKER_MAX_CONCURRENCY,
    shutdownGraceMs: e.WORKER_SHUTDOWN_GRACE_MS,
    aliveFile: e.WORKER_ALIVE_FILE ?? DEFAULT_ALIVE_FILE,
  };
}

export interface WorkerOptions extends WorkerConfig {
  registry: JobRegistry;
  schedules: readonly ScheduleDef[];
  signal: AbortSignal;
}

function sleep(ms: number, signal: AbortSignal, wake: { fn: (() => void) | null }): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      wake.fn = null;
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    wake.fn = done;
  });
}

export async function runWorker(o: WorkerOptions): Promise<void> {
  const problems = [...registryProblems(o.registry), ...scheduleProblems(o.schedules, o.registry.kinds)];
  if (problems.length > 0) throw new Error(`worker: invalid registry — ${problems.join("; ")}`);
  await syncSchedules(o.schedules, o.registry.kinds);
  logger.info({ workerId: o.workerId, kinds: Object.keys(o.registry.kinds), schedules: o.schedules.map((s) => s.name), maxConcurrency: o.maxConcurrency }, "worker: started");

  const running = new Map<string, number>();
  const inflight = new Set<Promise<void>>();
  const wake: { fn: (() => void) | null } = { fn: null };
  let lastTick = 0;
  let turn = 0;

  const start = (c: ClaimedJob) => {
    running.set(c.kind, (running.get(c.kind) ?? 0) + 1);
    const p: Promise<void> = runJob(c, o.registry, o.workerId)
      .then(() => undefined)
      .catch((err: unknown) => logger.error({ jobId: c.id, kind: c.kind, err: errorSummary(err) }, "job: runner crashed"))
      .finally(() => {
        running.set(c.kind, (running.get(c.kind) ?? 1) - 1);
        inflight.delete(p);
        wake.fn?.();
      });
    inflight.add(p);
  };

  while (!o.signal.aborted) {
    turn++;
    await writeFile(o.aliveFile, String(Date.now())).catch(() => undefined);
    if (Date.now() - lastTick >= o.tickEveryMs) {
      lastTick = Date.now();
      try {
        await tickSchedules(o.schedules, o.registry.kinds);
      } catch (err) {
        logger.error({ err: errorSummary(err) }, "scheduler: tick failed (retried next turn)");
      }
    }
    let claimed: ClaimedJob[] = [];
    const wants = claimWants(o.registry.kinds, running, o.maxConcurrency, turn);
    if (wants.length > 0) {
      try {
        claimed = await claimJobs(o.workerId, wants);
      } catch (err) {
        logger.error({ err: errorSummary(err) }, "worker: claim failed");
      }
    }
    for (const c of claimed) start(c);
    if (claimed.length === 0) await sleep(o.pollMs, o.signal, wake);
  }

  logger.info({ workerId: o.workerId, inflight: inflight.size }, "worker: stopping");
  if (inflight.size > 0) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled([...inflight]), new Promise<void>((r) => (timer = setTimeout(r, o.shutdownGraceMs)))]);
    clearTimeout(timer);
  }
  logger.info({ workerId: o.workerId, abandoned: inflight.size }, "worker: stopped");
}
