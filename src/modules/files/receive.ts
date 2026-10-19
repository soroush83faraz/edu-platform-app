// files/receive — an upload's body streamed to a temp file, never held in memory: chunk by chunk into a fresh
// `<temp dir>/<random>.part` (O_EXCL, mode 0600), hashed (SHA-256) and counted on the way, aborted the moment it
// passes the cap, when fewer bytes arrive than the request's Content-Length announced, and when it breaks the PACE
// rule (security review 2026-10-19, D2 — a slow body must not hold an upload slot): no byte for `idleTimeoutMs`, an
// average rate under `minBytesPerSecond` once `slowGraceMs` have passed, or longer than `totalTimeoutMs` in all (a
// hard wall clock). On ANY failure the temp file is removed before the error propagates; the caller frees its slot.
// fsync before close, so a later rename publishes complete bytes. No `env` (unit-tested with a temp dir and fake
// timers: tests/unit/files-limits.test.ts).
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

export type ReceiveFailure = "too_large" | "incomplete" | "timeout" | "empty";

/** Which pace rule a `timeout` broke: the wall clock, the idle limit, or the minimum average rate. */
export type PaceViolation = "total" | "idle" | "slow";

export class ReceiveError extends Error {
  /** Set for a `timeout`: which rule ended it (the route counts `idle` / `slow` / `total` as a slow abort). */
  readonly pace: PaceViolation | null;

  constructor(
    readonly reason: ReceiveFailure,
    options?: { cause?: unknown; pace?: PaceViolation },
  ) {
    super(`upload ${reason}${options?.pace ? ` (${options.pace})` : ""}`, options);
    this.name = "ReceiveError";
    this.pace = options?.pace ?? null;
  }
}

export interface PaceRule {
  /** No byte for this long → `idle`. */
  idleTimeoutMs: number;
  /** The whole body, from the moment the receiver starts waiting for it → `total`. */
  totalTimeoutMs: number;
  /** The average since the start may not fall under this (bytes per second) once `slowGraceMs` have passed; 0 = off. */
  minBytesPerSecond: number;
  slowGraceMs: number;
}

export interface PaceState {
  /** Since the receiver started waiting for the body. */
  elapsedMs: number;
  /** Since the last chunk (since the start, before the first). */
  idleMs: number;
  /** Received so far. */
  bytes: number;
}

/** Pure: the rule an upload in flight breaks NOW, or null. The wall clock first, then the idle limit, then the rate. */
export function paceViolation(rule: PaceRule, s: PaceState): PaceViolation | null {
  if (s.elapsedMs >= rule.totalTimeoutMs) return "total";
  if (s.idleMs >= rule.idleTimeoutMs) return "idle";
  if (rule.minBytesPerSecond > 0 && s.elapsedMs >= rule.slowGraceMs && s.bytes * 1000 < rule.minBytesPerSecond * s.elapsedMs) return "slow";
  return null;
}

/** setTimeout's ceiling (a larger delay fires at once). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Pure: how long the receiver may wait for the next chunk before `paceViolation` can turn true if nothing arrives —
 * 0 only when it already is. With no new byte the average falls under the floor once
 * `elapsed > bytes × 1000 / floor`, so that moment (but never before the grace) is one of the deadlines.
 */
export function paceWaitMs(rule: PaceRule, s: PaceState): number {
  let wait = Math.min(rule.totalTimeoutMs - s.elapsedMs, rule.idleTimeoutMs - s.idleMs);
  if (rule.minBytesPerSecond > 0) {
    const slowAt = Math.max(rule.slowGraceMs, Math.floor((s.bytes * 1000) / rule.minBytesPerSecond) + 1);
    wait = Math.min(wait, slowAt - s.elapsedMs);
  }
  return Math.min(MAX_TIMER_MS, Math.max(0, wait));
}

export interface ReceiveOptions {
  tempDir: string;
  maxBytes: number;
  /** From Content-Length when the client sent one: fewer bytes than this = `incomplete`, more = `too_large`. */
  expectedBytes?: number | null;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  /** The rate floor (bytes per second, the average since the start) and its grace; omitted = no floor. */
  minBytesPerSecond?: number;
  slowGraceMs?: number;
}

export interface Received {
  tempPath: string;
  size: number;
  sha256: string;
}

type Chunk = ReadableStreamReadResult<Uint8Array>;

const WAITED = Symbol("waited");

/** The read, or WAITED after `ms` — the read stays pending (the next round waits on the same one). */
async function within(read: Promise<Chunk>, ms: number): Promise<Chunk | typeof WAITED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<typeof WAITED>((resolve) => (timer = setTimeout(resolve, ms, WAITED)))]);
  } finally {
    clearTimeout(timer);
  }
}

export async function receiveToTemp(body: ReadableStream<Uint8Array> | null, opts: ReceiveOptions): Promise<Received> {
  if (!body) throw new ReceiveError("empty");
  if (opts.expectedBytes != null && opts.expectedBytes > opts.maxBytes) throw new ReceiveError("too_large");
  const rule: PaceRule = {
    idleTimeoutMs: opts.idleTimeoutMs,
    totalTimeoutMs: opts.totalTimeoutMs,
    minBytesPerSecond: opts.minBytesPerSecond ?? 0,
    slowGraceMs: opts.slowGraceMs ?? 0,
  };
  await mkdir(opts.tempDir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(opts.tempDir, `${randomUUID()}.part`);
  const handle = await open(tempPath, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  const startedAt = Date.now();
  let lastChunkAt = startedAt;
  let size = 0;
  let closed = false;
  let pending: Promise<Chunk> | null = null;
  const state = (): PaceState => {
    const t = Date.now();
    return { elapsedMs: t - startedAt, idleMs: t - lastChunkAt, bytes: size };
  };
  try {
    for (;;) {
      const broken = paceViolation(rule, state());
      if (broken) throw new ReceiveError("timeout", { pace: broken });
      pending ??= reader.read();
      const next = await within(pending, paceWaitMs(rule, state()));
      if (next === WAITED) continue; // re-checked at the top: a deadline of the rule has come
      pending = null;
      if (next.done) break;
      const value = next.value;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      lastChunkAt = Date.now();
      if (size > opts.maxBytes) throw new ReceiveError("too_large");
      hash.update(value);
      let written = 0;
      while (written < value.byteLength) {
        const { bytesWritten } = await handle.write(value, written, value.byteLength - written);
        written += bytesWritten;
      }
    }
    if (size === 0) throw new ReceiveError("empty");
    if (opts.expectedBytes != null && size !== opts.expectedBytes) throw new ReceiveError(size < opts.expectedBytes ? "incomplete" : "too_large");
    await handle.sync();
    await handle.close();
    closed = true;
    return { tempPath, size, sha256: hash.digest("hex") };
  } catch (err) {
    // A read still pending when a rule ended the upload settles after cancel(); it must never become unhandled.
    pending?.catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    if (!closed) await handle.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    // A body that broke off (client gone, connection reset) is just an incomplete upload; a disk error rides along
    // as the cause for the caller's log.
    throw err instanceof ReceiveError ? err : new ReceiveError("incomplete", { cause: err });
  }
}
