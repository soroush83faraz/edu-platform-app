// Login throttling backed by iam.login_attempt (global table). Decisions are pure (`throttleDecision`);
// the counts come from ONE aggregate query. A throttled login still runs an argon2 verify and returns the very
// same generic error as a wrong password — the caller never learns which rule fired.
//
// What counts (`countsForIdentifier` / `countsForIp`, mirrored by the SQL of `countRecentFailures`): a recorded
// attempt with `succeeded = false` that no admin has cleared (`cleared_at IS NULL`). The IDENTIFIER windows
// additionally require that the password WAS evaluated (`outcome` bad_password / unknown / disabled, or NULL on
// rows written before step 2): an attempt refused WITHOUT a verdict (`outcome = 'locked'` — throttled identifier or
// IP, `locked_until`, `status = 'locked'`) stays in the audit trail but never counts against the identifier,
// otherwise retrying during a soft lock (even with the RIGHT password) would extend the window and escalate to the
// 1-hour / permanent lock (QA round 1, B2). The IP window keeps counting refused attempts: a sprayer that hammers on
// through its block must stay blocked. «رفع قفل» stamps `cleared_at` on the identifier's recent failures
// (`clearRecentFailures`) so an unlock really unlocks.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { loginAttempt } from "./schema";

export interface FailureCounts {
  /** counted failures for this identifier in the last 15 minutes */
  identifier15m: number;
  /** … last hour */
  identifier1h: number;
  /** … last 24 hours */
  identifier24h: number;
  /** counted failures for this (identifier, ip) pair in the last 15 minutes */
  identifierIp15m: number;
  /** counted failures from this ip (any identifier) in the last 10 minutes */
  ip10m: number;
}

/**
 * Per identifier the ladder is 5 / 15 min → soft lock, 10 / 1 h → `locked_until = now()+1h`, 20 / 24 h →
 * `status = 'locked'` (admin unlock). Per IP a whole school sits behind one NAT, so the IP rule must not lock a
 * school out because of one bored class: ≥ 300 counted failures / 10 min only SLOWS every login from that IP
 * (`slowDelayMs` added to the response, success or failure alike); ≥ 1000 / 10 min (≈ 1.7 failures per second,
 * sustained — no school does that by hand) refuses. docs/auth.md «محدودسازی».
 */
export const THROTTLE = {
  identifier15m: 5,
  identifier1h: 10,
  identifier24h: 20,
  identifierIp15m: 5,
  ipSlow10m: 300,
  ipBlock10m: 1000,
  slowDelayMs: 1000,
  hardLockMs: 60 * 60 * 1000,
} as const;

export interface ThrottleDecision {
  /** Reject this attempt (before or after verification — the response is the same). */
  blocked: boolean;
  /** Process normally but delay the response by `THROTTLE.slowDelayMs` (busy IP, not yet refused). */
  slow: boolean;
  /** After a COUNTED failure: set `user_account.locked_until = now + 1h`. */
  lockForHour: boolean;
  /** After a COUNTED failure: set `user_account.status = 'locked'` (admin unlock). */
  lockPermanently: boolean;
}

export function throttleDecision(c: FailureCounts): ThrottleDecision {
  const blocked =
    c.identifier15m >= THROTTLE.identifier15m ||
    c.identifier1h >= THROTTLE.identifier1h ||
    c.identifier24h >= THROTTLE.identifier24h ||
    c.identifierIp15m >= THROTTLE.identifierIp15m ||
    c.ip10m >= THROTTLE.ipBlock10m;
  return {
    blocked,
    slow: !blocked && c.ip10m >= THROTTLE.ipSlow10m,
    lockForHour: c.identifier1h + 1 >= THROTTLE.identifier1h,
    lockPermanently: c.identifier24h + 1 >= THROTTLE.identifier24h,
  };
}

/** Mirrors `login_attempt_outcome_chk`. `outcome` says WHY an attempt failed; `locked` = refused without a verdict on the password. */
export const LOGIN_OUTCOMES = ["success", "bad_password", "locked", "unknown", "disabled"] as const;
export type LoginOutcomeCode = (typeof LOGIN_OUTCOMES)[number];

export interface RecordedAttempt {
  succeeded: boolean;
  outcome: LoginOutcomeCode | null;
  clearedAt: Date | null;
}

/** Pure mirrors of the SQL predicates in `countRecentFailures` (unit-tested; the int tests prove the SQL). */
export function countsForIdentifier(a: RecordedAttempt): boolean {
  return !a.succeeded && a.clearedAt === null && a.outcome !== "locked";
}

export function countsForIp(a: RecordedAttempt): boolean {
  return !a.succeeded && a.clearedAt === null;
}

/** Global transaction. */
export async function countRecentFailures(tx: Tx, identifier: string, ip: string): Promise<FailureCounts> {
  // Identifier windows: this identifier AND the password was evaluated (`countsForIdentifier`).
  const forIdentifier = sql`(${loginAttempt.identifier} = ${identifier} and (${loginAttempt.outcome} is null or ${loginAttempt.outcome} <> 'locked'))`;
  const res = await tx.execute<{
    identifier15m: number;
    identifier1h: number;
    identifier24h: number;
    identifierIp15m: number;
    ip10m: number;
  }>(sql`
    select
      count(*) filter (where ${forIdentifier} and ${loginAttempt.at} > now() - interval '15 minutes')::int as "identifier15m",
      count(*) filter (where ${forIdentifier} and ${loginAttempt.at} > now() - interval '1 hour')::int as "identifier1h",
      count(*) filter (where ${forIdentifier})::int as "identifier24h",
      count(*) filter (where ${forIdentifier} and ${loginAttempt.ip} = ${ip}::inet and ${loginAttempt.at} > now() - interval '15 minutes')::int as "identifierIp15m",
      count(*) filter (where ${loginAttempt.ip} = ${ip}::inet and ${loginAttempt.at} > now() - interval '10 minutes')::int as "ip10m"
    from ${loginAttempt}
    where ${loginAttempt.succeeded} = false
      and ${loginAttempt.clearedAt} is null
      and ${loginAttempt.at} > now() - interval '24 hours'
      and (${loginAttempt.identifier} = ${identifier} or ${loginAttempt.ip} = ${ip}::inet)
  `);
  const row = res.rows[0];
  return {
    identifier15m: row?.identifier15m ?? 0,
    identifier1h: row?.identifier1h ?? 0,
    identifier24h: row?.identifier24h ?? 0,
    identifierIp15m: row?.identifierIp15m ?? 0,
    ip10m: row?.ip10m ?? 0,
  };
}

/**
 * «رفع قفل»: stamps `cleared_at` on the identifier's uncleared failures of the last 24 hours (the widest window
 * the counters look at). The rows stay for the audit trail. Returns how many were cleared. Global table — callable
 * from a tenant transaction too.
 */
export async function clearRecentFailures(tx: Tx, identifier: string): Promise<number> {
  const rows = await tx
    .update(loginAttempt)
    .set({ clearedAt: sql`now()` })
    .where(sql`${loginAttempt.identifier} = ${identifier} and ${loginAttempt.succeeded} = false and ${loginAttempt.clearedAt} is null and ${loginAttempt.at} > now() - interval '24 hours'`)
    .returning({ id: loginAttempt.id });
  return rows.length;
}

export interface AttemptRecord {
  identifier: string;
  ip: string;
  succeeded: boolean;
  outcome: LoginOutcomeCode;
  userAgent: string | null;
}

/** Global transaction. Every attempt is recorded — refused ones too (as `locked`, which the identifier windows skip). */
export async function recordAttempt(tx: Tx, a: AttemptRecord): Promise<void> {
  await tx.insert(loginAttempt).values({
    identifier: a.identifier,
    ip: a.ip,
    succeeded: a.succeeded,
    outcome: a.outcome,
    userAgent: a.userAgent?.slice(0, 512) ?? null,
  });
}

/** The «slow» rule: one fixed delay for the whole attempt, success or failure alike (no timing oracle). */
export function slowDown(ms: number = THROTTLE.slowDelayMs): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
