// ops/enqueue — put a background job into ops.job INSIDE the caller's transaction: the job commits with the business
// change that caused it and rolls back with it (outbox semantics — no job for a change that never happened, no change
// without its job). `tx` is the caller's tenant transaction (a defineAction handler's, or a job handler's), so the
// row's organization is the session's — RLS refuses any other. The payload is validated against the kind's schema
// (./kinds.ts: ids and numbers only) and capped at PAYLOAD_MAX_BYTES; enqueueing is not a business mutation of its
// own (the change it belongs to is audited by its service), so no audit row is written here.
import { v7 as uuidv7 } from "uuid";
import type { Tx } from "@/lib/actions";
import { job } from "./schema";
import { JOB_KINDS, PAYLOAD_MAX_BYTES, type JobKind, type JobKindDef, type JobPayload } from "./kinds";

export interface EnqueueOptions {
  /** Not before this instant (default: now). */
  runAt?: Date;
  /**
   * Idempotency key, unique per organization for as long as the job row lives (finished jobs are pruned after 14 / 90
   * days): a second enqueue with the same key creates nothing. E.g. `reminder:<work item>:<deadline iso>`.
   */
  dedupeKey?: string;
  /** Overrides the kind's maxAttempts (1 … 25). */
  maxAttempts?: number;
}

export interface Enqueued {
  /** The new job's id; null when `dedupeKey` matched an existing job. */
  id: string | null;
  created: boolean;
}

/** Shared by `enqueueJob` and the int tests' own kinds: validate, cap, insert (dedupe = do nothing). */
export async function insertJob(tx: Tx, orgId: string, kind: string, def: JobKindDef, payload: unknown, opts: EnqueueOptions = {}): Promise<Enqueued> {
  const parsed = def.payload.parse(payload) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > PAYLOAD_MAX_BYTES) throw new Error(`enqueueJob: ${kind} payload over ${PAYLOAD_MAX_BYTES} bytes`);
  if (opts.dedupeKey !== undefined && !(opts.dedupeKey.length >= 1 && opts.dedupeKey.length <= 200)) throw new Error("enqueueJob: dedupeKey must be 1 … 200 characters");
  const maxAttempts = opts.maxAttempts ?? def.maxAttempts;
  const id = uuidv7();
  const rows = await tx
    .insert(job)
    .values({
      id,
      organizationId: orgId,
      kind,
      payload: parsed,
      maxAttempts,
      ...(opts.runAt ? { runAt: opts.runAt } : {}),
      ...(opts.dedupeKey !== undefined ? { dedupeKey: opts.dedupeKey } : {}),
    })
    .onConflictDoNothing({ target: [job.organizationId, job.dedupeKey] })
    .returning({ id: job.id });
  return rows.length > 0 ? { id, created: true } : { id: null, created: false };
}

/** Enqueue a job of a registered kind for the transaction's organization (`ctx.orgId` — the session's, never input). */
export function enqueueJob<K extends JobKind>(tx: Tx, ctx: { orgId: string }, kind: K, payload: JobPayload<K>, opts: EnqueueOptions = {}): Promise<Enqueued> {
  return insertJob(tx, ctx.orgId, kind, JOB_KINDS[kind], payload, opts);
}
