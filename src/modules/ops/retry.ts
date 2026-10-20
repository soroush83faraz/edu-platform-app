// ops/retry — what the runner does after a failed attempt (pure): when to try again (exponential backoff with
// jitter) and what to write into `ops.job.last_error` — an error's class, its SQLSTATE and a truncated message with
// anything that looks like personal data (e-mail addresses, phone-like digit runs, quoted values) masked. Never the
// payload, never a stack.

export interface BackoffOptions {
  /** The first retry waits about this long. */
  baseMs: number;
  /** No wait is longer than this. */
  capMs: number;
  /** ± this share of the wait is random, so failed jobs of many organizations do not retry in lockstep. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 30_000, capMs: 60 * 60_000, jitter: 0.2 };

/** Wait before attempt `attempt + 1`, after `attempt` (1-based) failed: base · 2^(attempt − 1), capped, jittered. */
export function backoffMs(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(opts.capMs, opts.baseMs * 2 ** Math.min(n - 1, 30));
  const factor = 1 - opts.jitter + 2 * opts.jitter * Math.min(Math.max(random(), 0), 1);
  return Math.round(Math.min(opts.capMs, exp * factor));
}

/** Errors a retry cannot fix (a payload that no longer validates, an unknown kind): straight to `dead`. */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

export const LAST_ERROR_MAX = 300;

function pgCodeOf(err: unknown, depth = 0): string | undefined {
  if (depth > 4 || typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return pgCodeOf(e.cause, depth + 1);
}

/** Masks what could be personal data in an error message: quoted values, e-mail addresses, digit runs of 5+. */
export function scrubMessage(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'|«[^»]{0,200}»/g, "…")
    .replace(/[^\s@]+@[^\s@]+/g, "…")
    .replace(/[0-9۰-۹٠-٩]{5,}/g, "…")
    .trim();
}

/** The `last_error` line of a failure: «Name [SQLSTATE]: scrubbed message», at most LAST_ERROR_MAX characters. */
export function errorSummary(err: unknown): string {
  const name = err instanceof Error ? err.name || "Error" : typeof err;
  const code = pgCodeOf(err);
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const text = `${name}${code ? ` [${code}]` : ""}${raw ? `: ${scrubMessage(raw)}` : ""}`;
  return text.length > LAST_ERROR_MAX ? `${text.slice(0, LAST_ERROR_MAX - 1)}…` : text;
}
