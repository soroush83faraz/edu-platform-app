// Login throttling backed by iam.login_attempt (global table). Decisions are pure (`throttleDecision`);
// the counts come from ONE aggregate query. A throttled login still runs an argon2 verify and returns the very
// same generic error as a wrong password — the caller never learns which rule fired.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { loginAttempt } from "./schema";

export interface FailureCounts {
  /** failures for this identifier in the last 15 minutes */
  identifier15m: number;
  /** … last hour */
  identifier1h: number;
  /** … last 24 hours */
  identifier24h: number;
  /** failures for this (identifier, ip) pair in the last 15 minutes */
  identifierIp15m: number;
  /** failures from this ip (any identifier) in the last 10 minutes */
  ip10m: number;
}

export const THROTTLE = {
  identifier15m: 5,
  identifier1h: 10,
  identifier24h: 20,
  identifierIp15m: 5,
  ip10m: 60,
  hardLockMs: 60 * 60 * 1000,
} as const;

export interface ThrottleDecision {
  /** Reject this attempt (before or after verification — the response is the same). */
  blocked: boolean;
  /** After ANOTHER failure: set `user_account.locked_until = now + 1h`. */
  lockForHour: boolean;
  /** After ANOTHER failure: set `user_account.status = 'locked'` (admin unlock). */
  lockPermanently: boolean;
}

export function throttleDecision(c: FailureCounts): ThrottleDecision {
  const blocked =
    c.identifier15m >= THROTTLE.identifier15m ||
    c.identifier1h >= THROTTLE.identifier1h ||
    c.identifier24h >= THROTTLE.identifier24h ||
    c.identifierIp15m >= THROTTLE.identifierIp15m ||
    c.ip10m >= THROTTLE.ip10m;
  return {
    blocked,
    lockForHour: c.identifier1h + 1 >= THROTTLE.identifier1h,
    lockPermanently: c.identifier24h + 1 >= THROTTLE.identifier24h,
  };
}

/** Global transaction. */
export async function countRecentFailures(tx: Tx, identifier: string, ip: string): Promise<FailureCounts> {
  const res = await tx.execute<{
    identifier15m: number;
    identifier1h: number;
    identifier24h: number;
    identifierIp15m: number;
    ip10m: number;
  }>(sql`
    select
      count(*) filter (where ${loginAttempt.identifier} = ${identifier} and ${loginAttempt.at} > now() - interval '15 minutes')::int as "identifier15m",
      count(*) filter (where ${loginAttempt.identifier} = ${identifier} and ${loginAttempt.at} > now() - interval '1 hour')::int as "identifier1h",
      count(*) filter (where ${loginAttempt.identifier} = ${identifier})::int as "identifier24h",
      count(*) filter (where ${loginAttempt.identifier} = ${identifier} and ${loginAttempt.ip} = ${ip}::inet and ${loginAttempt.at} > now() - interval '15 minutes')::int as "identifierIp15m",
      count(*) filter (where ${loginAttempt.ip} = ${ip}::inet and ${loginAttempt.at} > now() - interval '10 minutes')::int as "ip10m"
    from ${loginAttempt}
    where ${loginAttempt.succeeded} = false
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

/** Mirrors `login_attempt_outcome_chk`. `succeeded` drives throttling; `outcome` is the audit explanation. */
export const LOGIN_OUTCOMES = ["success", "bad_password", "locked", "unknown", "disabled"] as const;
export type LoginOutcomeCode = (typeof LOGIN_OUTCOMES)[number];

export interface AttemptRecord {
  identifier: string;
  ip: string;
  succeeded: boolean;
  outcome: LoginOutcomeCode;
  userAgent: string | null;
}

/** Global transaction. Every attempt is recorded — throttled ones too. */
export async function recordAttempt(tx: Tx, a: AttemptRecord): Promise<void> {
  await tx.insert(loginAttempt).values({
    identifier: a.identifier,
    ip: a.ip,
    succeeded: a.succeeded,
    outcome: a.outcome,
    userAgent: a.userAgent?.slice(0, 512) ?? null,
  });
}
