// Audit hook. The audit table (schema `audit`) arrives in DB step 2; until then this is a typed no-op so callers
// already pass the right shape and the real implementation is a one-file change.
// TODO(step2): insert into audit.event inside the SAME transaction as the mutation (callers pass `tx`).
import type { Tx } from "@/lib/actions";

export interface AuditCtx {
  requestId: string;
  userId: string;
  orgId: string;
  personId: string;
}

export interface AuditEntity {
  type: string;
  id: string;
}

export type AuditFn = (ctx: AuditCtx, action: string, entity: AuditEntity, before: unknown, after: unknown, tx?: Tx) => Promise<void>;

export const audit: AuditFn = async () => {
  /* no-op until DB step 2 */
};
