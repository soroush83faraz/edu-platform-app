// lib/jobs/plan — the pure part of the worker loop: how many jobs of which kind to ask for in one turn. No database.
import { type JobKindDef, leaseSecondsFor } from "@/modules/ops/kinds";

export interface ClaimWant {
  kind: string;
  limit: number;
  leaseSeconds: number;
}

/** What app.claim_jobs accepts as a worker id (and the worker builds from host + pid). */
export const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * Free slots per kind (its `concurrency` minus its runs in this process), within the process-wide `maxConcurrency`,
 * handed out from a rotating start so that no kind starves when the process cap is the tighter one.
 */
export function claimWants(kinds: Readonly<Record<string, JobKindDef>>, running: ReadonlyMap<string, number>, maxConcurrency: number, rotate = 0): ClaimWant[] {
  const names = Object.keys(kinds);
  let free = maxConcurrency - [...running.values()].reduce((a, b) => a + b, 0);
  const out: ClaimWant[] = [];
  for (let i = 0; i < names.length && free > 0; i++) {
    const kind = names[(i + rotate) % names.length];
    const def = kinds[kind];
    const limit = Math.min(def.concurrency - (running.get(kind) ?? 0), free);
    if (limit <= 0) continue;
    out.push({ kind, limit, leaseSeconds: leaseSecondsFor(def) });
    free -= limit;
  }
  return out;
}
