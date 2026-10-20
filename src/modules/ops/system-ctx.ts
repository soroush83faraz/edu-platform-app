// ops/system-ctx — the actor of a background job: «سامانه», not a person. Type only.
//
// A job handler runs with no session, no person and no role assignment, so it can NEVER pass `can()` and is never
// handed a request `Ctx` (src/lib/ctx.ts) — the two types do not mix. Authorization of system work is by
// construction instead:
//   • a job exists only because server code put it there — inside an action that was itself authorized
//     (defineAction: session → permission → withTenant) and committed in the same transaction (`enqueueJob`), or
//     because a schedule registered in code fired (src/modules/ops/schedules.ts). No client input names a kind or a
//     payload;
//   • the handler runs inside `withTenant` of the job's organization (RLS: that tenant only), re-reads the rows its
//     payload names and re-checks the domain rule it acts on (an item still open, a deadline unchanged), since time
//     has passed since the enqueue;
//   • every business mutation it makes is audited with THIS context: `actor_person_id` / `actor_user_id` NULL,
//     `request_id` = `job:<job id>`, `user_agent` = `system:worker` — so the trail says «سامانه, job X» (docs/db.md).
// The only constructor is the runner (src/lib/jobs/runner.ts), which nothing under src/app, src/modules or
// src/components may import (ESLint `no-restricted-imports`); the brand below makes a hand-built object a type error.
import type { AuditCtx } from "@/lib/audit";

declare const systemActorBrand: unique symbol;

export const SYSTEM_USER_AGENT = "system:worker";

export interface SystemCtx extends AuditCtx {
  readonly actor: "system";
  /** The job's organization — what `withTenant` is bound to. */
  readonly orgId: string;
  readonly jobId: string;
  readonly kind: string;
  /** 1-based attempt number of this run. */
  readonly attempt: number;
  /** `job:<jobId>` — the audit trail's request id for everything this run writes. */
  readonly requestId: string;
  readonly personId: null;
  readonly userId: null;
  readonly ip: null;
  readonly userAgent: typeof SYSTEM_USER_AGENT;
  readonly [systemActorBrand]: true;
}

/** `request_id` of an audit row written by a job run. */
export function jobRequestId(jobId: string): string {
  return `job:${jobId}`;
}
