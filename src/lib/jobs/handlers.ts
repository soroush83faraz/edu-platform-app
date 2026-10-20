// lib/jobs/handlers — what each job kind does (src/modules/ops/kinds.ts). Thin: the domain logic stays in its module;
// a handler binds it to the job's transaction (`withTenant` of the job's organization) and the system actor. Typed per
// kind, and a `Record` over every kind — a new kind without a handler does not compile.
import { sql } from "drizzle-orm";
import { expireStaleUploads } from "@/modules/files/expire";
import { filesRoot, removeStored } from "@/modules/files/storage";
import { liveFileIds, sweepOrphans } from "@/modules/files/sweep";
import { JOB_KINDS, type JobKind, type JobPayload } from "@/modules/ops/kinds";
import type { JobHandler, JobRegistry } from "./runner";

/** One expire call archives at most this many uploads; a job takes up to EXPIRE_BATCHES of them. */
const EXPIRE_BATCH = 50;
const EXPIRE_BATCHES = 10;
/** Rows one prune run deletes at most (the next night continues). */
const PRUNE_LIMIT = 5000;

export const HANDLERS: { [K in JobKind]: JobHandler<JobPayload<K>> } = {
  "files.sweep_orphans": async (tx, ctx) => {
    const report = await sweepOrphans({ root: filesRoot(), orgId: ctx.orgId, liveIds: (ids) => liveFileIds(tx, ids) });
    // A failed lookup deleted nothing; retrying later is the right answer. A braked run is a warning, not a failure.
    if (report.lookupFailed) throw new Error("files.sweep_orphans: the live-row lookup failed");
  },

  "files.expire_uploads": async (tx, ctx, _payload, signal) => {
    const keys: string[] = [];
    for (let i = 0; i < EXPIRE_BATCHES && !signal.aborted; i++) {
      const batch = await expireStaleUploads(tx, ctx, EXPIRE_BATCH);
      keys.push(...batch);
      if (batch.length < EXPIRE_BATCH) break;
    }
    // The rows are archived in this transaction; their bytes go only once it has committed.
    return keys.length > 0 ? { afterCommit: () => removeStored(keys) } : undefined;
  },

  "ops.prune_jobs": async (tx) => {
    await tx.execute(sql`
      delete from ops.job
      where id in (
        select id from ops.job
        where (status = 'done' and finished_at < now() - interval '14 days')
           or (status = 'dead' and finished_at < now() - interval '90 days')
        order by finished_at
        limit ${PRUNE_LIMIT})`);
  },
};

export const REGISTRY: JobRegistry = { kinds: JOB_KINDS, handlers: HANDLERS };
