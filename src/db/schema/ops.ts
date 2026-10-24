import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { orgFk } from "./tenancy";

export const ops = pgSchema("ops");

/**
 * «صف کارهای پس‌زمینه» — the Postgres job runner (owner 2026-10-20, docs/decisions.md; migration 0026). A tenant row:
 * every job belongs to ONE organization and its handler runs inside `withTenant` of that organization with the system
 * actor (src/lib/jobs). Enqueued inside the business transaction that causes it (outbox semantics: the job commits or
 * rolls back with the change — src/modules/ops/enqueue.ts). `payload` carries ids and numbers only, never personal
 * text (registry-validated, ≤ 2 KiB). Claimed across organizations ONLY through `app.claim_jobs` (SECURITY DEFINER,
 * FOR UPDATE SKIP LOCKED); every other read/write is the tenant's own. Lifecycle:
 *   queued → running (leased: locked_by/locked_until) → done | failed (retry at run_at, exponential backoff) → … → dead
 * (attempts = max_attempts). A running job whose lease expired is re-claimed (at-least-once delivery; handlers are
 * idempotent; the completion is fenced on `locked_by`).
 */
export const job = ops.table(
  "job",
  {
    id: id(),
    organizationId: orgFk(),
    /** Registry key (src/modules/ops/kinds.ts), `module.verb_noun`. */
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    /** Error class / SQLSTATE / a truncated, scrubbed message — never a payload value or personal text. */
    lastError: text("last_error"),
    /** Idempotent enqueue: a second job with the same key in the organization is not created. */
    dedupeKey: text("dedupe_key"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("job_org_id_uq").on(t.organizationId, t.id),
    unique("job_org_dedupe_uq").on(t.organizationId, t.dedupeKey),
    index("job_claim_idx").on(t.kind, t.runAt).where(sql`${t.status} IN ('queued', 'failed')`),
    index("job_lease_idx").on(t.kind, t.lockedUntil).where(sql`${t.status} = 'running'`),
    index("job_org_status_idx").on(t.organizationId, t.status, t.updatedAt),
    check("job_kind_chk", sql`${t.kind} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' AND char_length(${t.kind}) <= 80`),
    check("job_status_chk", sql`${t.status} IN ('queued', 'running', 'done', 'failed', 'dead')`),
    check("job_payload_chk", sql`jsonb_typeof(${t.payload}) = 'object' AND octet_length(${t.payload}::text) <= 2048`),
    check("job_attempts_chk", sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 25`),
    check("job_lease_chk", sql`(${t.status} = 'running') = (${t.lockedBy} IS NOT NULL AND ${t.lockedUntil} IS NOT NULL)`),
    check("job_finished_chk", sql`(${t.status} IN ('done', 'dead')) = (${t.finishedAt} IS NOT NULL)`),
    check("job_last_error_chk", sql`char_length(${t.lastError}) <= 500`),
    check("job_dedupe_key_chk", sql`char_length(${t.dedupeKey}) BETWEEN 1 AND 200`),
  ],
);

/**
 * Recurring schedules registered in code (src/modules/ops/schedules.ts), one row each — a GLOBAL table (no
 * organization_id, no RLS): name, cron, the tick it fired last and the next one. The scheduler takes due rows
 * `FOR UPDATE SKIP LOCKED`, so with two workers exactly one fires a tick; the jobs it fans out (one per active
 * organization) carry the dedupe key `schedule:<name>:<tick>`, so even a re-fired tick enqueues nothing twice.
 */
export const schedule = ops.table(
  "schedule",
  {
    name: text("name").primaryKey(),
    cron: text("cron").notNull(),
    kind: text("kind").notNull(),
    nextFireAt: timestamp("next_fire_at", { withTimezone: true }).notNull(),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check("schedule_name_chk", sql`${t.name} ~ '^[a-z][a-z0-9_.-]{2,79}$'`),
    check("schedule_cron_chk", sql`char_length(${t.cron}) BETWEEN 9 AND 100`),
    // A tick is a real instant (migration 0032; security review 2026-10-20, F4): 'infinity' would silence a schedule
    // for good, '-infinity' would break every tick that reads it.
    check("schedule_finite_chk", sql`isfinite(${t.nextFireAt}) AND (${t.lastFiredAt} IS NULL OR isfinite(${t.lastFiredAt}))`),
  ],
);
