// lib/jobs/runner — claim and run background jobs (ops.job; owner 2026-10-20, docs/decisions.md «صف، زمان‌بند و Feature
// Flag»). The job layer beside the action layer (src/lib/actions): it opens its own transactions, so only this folder,
// scripts/ and tests/ may import it (ESLint) — request code cannot reach `withTenant` of another organization, the
// cross-organization claim, or the system actor.
//
// One run:
//   1. `claimJobs` — app.claim_jobs (migration 0026, SECURITY DEFINER): due jobs of the asked kinds, FOR UPDATE SKIP
//      LOCKED, leased to this worker for the kind's timeout + 30 s; returns ids, organizations, kinds, attempts only;
//   2. `runJob` — ONE transaction in the job's organization (`withTenant`, no person): `statement_timeout` = the kind's
//      timeout, the job row re-read FOR UPDATE SKIP LOCKED and fenced on `locked_by` (a lease taken over by another
//      worker → nothing runs), the payload re-validated, the handler run with the system actor (`SystemCtx`, built
//      only here), then the row marked `done` IN THE SAME TRANSACTION — the handler's writes and the completion commit
//      together or not at all. While it runs the row stays locked, so no other worker can re-claim it even if the
//      run outlives its lease; if this process dies, the connection drops, the transaction rolls back and the job is
//      re-claimed once the lease expires (at least once — handlers are idempotent);
//   3. after the commit, the handler's `afterCommit` (e.g. deleting bytes of archived files);
//   4. on failure, a second transaction: `failed` with run_at = now() + backoff (src/modules/ops/retry.ts), or `dead`
//      after max_attempts or a PermanentJobError; `last_error` is a scrubbed one-liner.
// The timeout is cooperative (the handler's AbortSignal) plus the database's statement_timeout — the transaction is
// never abandoned while the handler still holds it.
import { and, eq, sql } from "drizzle-orm";
import { type Tx, withTenant, withoutTenant } from "@/db/client";
import { logger } from "@/lib/logger";
import { type JobKindDef, kindProblems } from "@/modules/ops/kinds";
import { DEFAULT_BACKOFF, PermanentJobError, type BackoffOptions, backoffMs, errorSummary } from "@/modules/ops/retry";
import { job } from "@/modules/ops/schema";
import { type ClaimWant, WORKER_ID_RE } from "./plan";
import { SYSTEM_USER_AGENT, type SystemCtx, jobRequestId } from "@/modules/ops/system-ctx";

export interface JobRunResult {
  /** Runs after the commit (never inside the transaction); a failure is logged, the job stays done. */
  afterCommit?: () => Promise<void>;
}

export type JobHandler<P = Record<string, unknown>> = (tx: Tx, ctx: SystemCtx, payload: P, signal: AbortSignal) => Promise<JobRunResult | void>;

export interface JobRegistry {
  kinds: Readonly<Record<string, JobKindDef>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler is typed by its own kind in handlers.ts
  handlers: Readonly<Record<string, JobHandler<any>>>;
}

export interface ClaimedJob {
  id: string;
  orgId: string;
  kind: string;
  /** 1-based: this run's attempt. */
  attempt: number;
}

const KIND_LITERAL_RE = /^[a-z][a-z0-9_.]*$/;

/** Every kind has a handler and a valid definition, and no handler is left without a kind. Empty = fine. */
export function registryProblems(registry: JobRegistry): string[] {
  const problems: string[] = [];
  for (const [name, def] of Object.entries(registry.kinds)) {
    problems.push(...kindProblems(name, def));
    if (typeof registry.handlers[name] !== "function") problems.push(`${name}: no handler`);
  }
  for (const name of Object.keys(registry.handlers)) if (!(name in registry.kinds)) problems.push(`${name}: a handler without a kind`);
  return problems;
}

/** Leases due jobs (app.claim_jobs). Kinds are registry names, limits and leases integers — never input. */
export async function claimJobs(workerId: string, wants: readonly ClaimWant[]): Promise<ClaimedJob[]> {
  const ws = wants.filter((w) => w.limit > 0);
  if (ws.length === 0) return [];
  if (!WORKER_ID_RE.test(workerId)) throw new Error("claimJobs: invalid worker id");
  for (const w of ws) {
    if (!KIND_LITERAL_RE.test(w.kind) || !Number.isInteger(w.limit) || !Number.isInteger(w.leaseSeconds)) throw new Error("claimJobs: invalid want");
  }
  const kinds = `{${ws.map((w) => w.kind).join(",")}}`;
  const limits = `{${ws.map((w) => w.limit).join(",")}}`;
  const leases = `{${ws.map((w) => w.leaseSeconds).join(",")}}`;
  const res = await withoutTenant((tx) =>
    tx.execute<{ job_id: string; job_organization_id: string; job_kind: string; job_attempts: number }>(
      sql`select job_id, job_organization_id, job_kind, job_attempts from app.claim_jobs(${workerId}, ${kinds}::text[], ${limits}::int[], ${leases}::int[])`,
    ),
  );
  return res.rows.map((r) => ({ id: r.job_id, orgId: r.job_organization_id, kind: r.job_kind, attempt: Number(r.job_attempts) }));
}

/** The actor of one run. The ONLY place a SystemCtx is made; not exported. */
function systemCtxFor(c: ClaimedJob): SystemCtx {
  return {
    actor: "system",
    orgId: c.orgId,
    jobId: c.id,
    kind: c.kind,
    attempt: c.attempt,
    requestId: jobRequestId(c.id),
    personId: null,
    userId: null,
    ip: null,
    userAgent: SYSTEM_USER_AGENT,
  } as SystemCtx;
}

/** The lease was taken over (or the row is gone): this run must not commit anything. */
class LeaseLost extends Error {
  override name = "LeaseLost";
}

export class JobTimeoutError extends Error {
  override name = "JobTimeoutError";
}

export type RunOutcome = "done" | "retry" | "dead" | "lost";

export interface RunReport {
  outcome: RunOutcome;
  ms: number;
  error?: string;
}

export interface RunOptions {
  backoff?: BackoffOptions;
  random?: () => number;
}

const fence = (c: ClaimedJob, workerId: string) => and(eq(job.id, c.id), eq(job.lockedBy, workerId), eq(job.status, "running"));

export async function runJob(c: ClaimedJob, registry: JobRegistry, workerId: string, opts: RunOptions = {}): Promise<RunReport> {
  const started = Date.now();
  const def = registry.kinds[c.kind];
  const handler = registry.handlers[c.kind];
  const ac = new AbortController();
  const timer = def ? setTimeout(() => ac.abort(new JobTimeoutError(`${c.kind}: over ${def.timeoutMs} ms`)), def.timeoutMs) : undefined;
  const log = { jobId: c.id, kind: c.kind, organizationId: c.orgId, attempt: c.attempt };
  try {
    if (!def || !handler) throw new PermanentJobError(`unknown job kind ${c.kind}`);
    const ctx = systemCtxFor(c);
    const result = await withTenant({ orgId: c.orgId }, async (tx) => {
      await tx.execute(sql.raw(`set local statement_timeout = ${Math.floor(def.timeoutMs)}`));
      const [row] = await tx.select({ payload: job.payload }).from(job).where(fence(c, workerId)).for("update", { skipLocked: true });
      if (!row) throw new LeaseLost();
      const parsed = def.payload.safeParse(row.payload);
      if (!parsed.success) throw new PermanentJobError(`${c.kind}: the payload no longer matches its schema`);
      const out = await handler(tx, ctx, parsed.data, ac.signal);
      if (ac.signal.aborted) throw ac.signal.reason;
      const done = await tx
        .update(job)
        .set({ status: "done", lockedBy: null, lockedUntil: null, finishedAt: sql`now()`, lastError: null })
        .where(fence(c, workerId))
        .returning({ id: job.id });
      if (done.length === 0) throw new LeaseLost();
      return out;
    });
    clearTimeout(timer);
    if (result?.afterCommit) {
      try {
        await result.afterCommit();
      } catch (err) {
        logger.warn({ ...log, err: errorSummary(err) }, "job: after-commit step failed (the job stays done)");
      }
    }
    const ms = Date.now() - started;
    logger.info({ ...log, ms }, "job: done");
    return { outcome: "done", ms };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - started;
    if (err instanceof LeaseLost) {
      logger.warn({ ...log, ms }, "job: lease lost — another worker owns it, nothing committed");
      return { outcome: "lost", ms };
    }
    return recordFailure(c, workerId, err, def, opts, started);
  }
}

async function recordFailure(c: ClaimedJob, workerId: string, err: unknown, def: JobKindDef | undefined, opts: RunOptions, started: number): Promise<RunReport> {
  const summary = errorSummary(err);
  const permanent = err instanceof PermanentJobError || !def;
  const delayMs = backoffMs(c.attempt, opts.backoff ?? DEFAULT_BACKOFF, opts.random);
  const log = { jobId: c.id, kind: c.kind, organizationId: c.orgId, attempt: c.attempt, error: summary };
  try {
    const rows = await withTenant({ orgId: c.orgId }, (tx) => {
      const dead = sql`(${permanent}::boolean or ${job.attempts} >= ${job.maxAttempts})`;
      return tx
        .update(job)
        .set({
          status: sql`case when ${dead} then 'dead' else 'failed' end`,
          runAt: sql`case when ${dead} then ${job.runAt} else now() + ${delayMs}::int * interval '1 millisecond' end`,
          finishedAt: sql`case when ${dead} then now() else null end`,
          lockedBy: null,
          lockedUntil: null,
          lastError: summary,
        })
        .where(fence(c, workerId))
        .returning({ status: job.status });
    });
    const ms = Date.now() - started;
    if (rows.length === 0) {
      logger.warn({ ...log, ms }, "job: failed after its lease was taken over");
      return { outcome: "lost", ms, error: summary };
    }
    const outcome: RunOutcome = rows[0].status === "dead" ? "dead" : "retry";
    if (outcome === "dead") logger.error({ ...log, ms }, "job: dead — no attempts left (docs/ops/runbook.md «کارهای پس‌زمینه»)");
    else logger.warn({ ...log, ms, retryInMs: delayMs }, "job: failed, will retry");
    return { outcome, ms, error: summary };
  } catch (recordErr) {
    // The database is unreachable: the job stays `running` until its lease expires and is claimed again.
    logger.error({ ...log, recordError: errorSummary(recordErr) }, "job: failure not recorded");
    return { outcome: "lost", ms: Date.now() - started, error: summary };
  }
}
