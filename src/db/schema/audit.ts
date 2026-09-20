import { index, inet, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common";
import { orgFk } from "./tenancy";

export const audit = pgSchema("audit");

/**
 * Append-only change log written by `audit()` (src/lib/audit.ts) inside the mutating transaction.
 * app_rw holds SELECT + INSERT only — `app.apply_grants()` revokes UPDATE/DELETE (migration 0011), so the
 * application cannot rewrite history. `entity_id` and the actor columns have NO FK on purpose: an audit row must
 * survive the row it describes and a person/account that is later archived.
 */
export const auditLog = audit.table(
  "audit_log",
  {
    id: id(),
    organizationId: orgFk(),
    actorPersonId: uuid("actor_person_id"),
    actorUserId: uuid("actor_user_id"),
    requestId: text("request_id"),
    /** `module.entity.verb`, e.g. `iam.account.password_changed`. */
    action: text("action").notNull(),
    entitySchema: text("entity_schema").notNull(),
    entityTable: text("entity_table").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_at_idx").on(t.organizationId, t.at.desc()),
    index("audit_log_org_entity_idx").on(t.organizationId, t.entityTable, t.entityId),
  ],
);
