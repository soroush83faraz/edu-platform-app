// Audit hook: ONE row in audit.audit_log per business mutation, written inside the caller's transaction (`tx`) so
// the change and its trail commit or roll back together. app_rw may INSERT and SELECT the table but never
// UPDATE/DELETE it (app.apply_grants(), migration 0011). Actor/request facts come from the request context
// (`Ctx` from src/lib/ctx is assignable to `AuditCtx`); seeds pass a minimal ctx of their own.
//
// Keep this module free of Next imports: scripts/seed.ts reaches it through the academic service under tsx.
import type { Tx } from "@/lib/actions";
import { auditLog } from "@/db/schema/audit";

export interface AuditCtx {
  /** tenancy.organization.id — audit rows are tenant rows (RLS). */
  orgId: string;
  /** iam.person.id of the actor inside that organization; null for system/seed writes. */
  personId?: string | null;
  /** iam.user_account.id of the actor (global login); null for system/seed writes. */
  userId?: string | null;
  /** `x-request-id` of the request that caused the change. */
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntity {
  /** PostgreSQL schema + table of the changed row, e.g. `iam` / `user_account`. */
  schema: string;
  table: string;
  /** Primary key of the row; null when the action has no single subject. */
  id: string | null;
}

export type AuditFn = (ctx: AuditCtx, action: string, entity: AuditEntity, before: unknown, after: unknown, tx: Tx) => Promise<void>;

/** A failed INSERT (e.g. RLS mismatch) propagates and rolls the caller's transaction back — by design. */
export const audit: AuditFn = async (ctx, action, entity, before, after, tx) => {
  await tx.insert(auditLog).values({
    organizationId: ctx.orgId,
    actorPersonId: ctx.personId ?? null,
    actorUserId: ctx.userId ?? null,
    requestId: ctx.requestId ?? null,
    action,
    entitySchema: entity.schema,
    entityTable: entity.table,
    entityId: entity.id,
    before: before ?? null,
    after: after ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
  });
};
