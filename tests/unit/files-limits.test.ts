// The numbers of «پیوست تکلیف و تحویل پاسخ» (src/modules/files/limits.ts) and the stream-to-disk receiver
// (src/modules/files/receive.ts): caps hold at their exact boundary, a refused upload leaves no temp file behind.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { FILE_LIMITS, FILE_MESSAGES, MiB, fileSizeProblem, formatBytesFa, itemSetProblem, slotCeilingFor, submissionSetProblem, withinDailyQuota } from "@/modules/files/limits";
import { type PaceRule, ReceiveError, paceViolation, paceWaitMs, receiveToTemp } from "@/modules/files/receive";

describe("file limits", () => {
  it("one file: non-empty, at most 10 MiB", () => {
    expect(FILE_LIMITS.maxFileBytes).toBe(10 * MiB);
    expect(fileSizeProblem(0)).toBe(FILE_MESSAGES.empty);
    expect(fileSizeProblem(1)).toBeNull();
    expect(fileSizeProblem(10 * MiB)).toBeNull();
    expect(fileSizeProblem(10 * MiB + 1)).toBe(FILE_MESSAGES.tooLarge);
    expect(fileSizeProblem(Number.NaN)).toBe(FILE_MESSAGES.empty);
  });

  it("a تکلیف holds at most 5 files; a پاسخ at most 5 files and 25 MiB in all", () => {
    expect(itemSetProblem(5)).toBeNull();
    expect(itemSetProblem(6)).toBe(FILE_MESSAGES.tooManyItemFiles);
    expect(submissionSetProblem([5 * MiB, 5 * MiB, 5 * MiB, 5 * MiB, 5 * MiB])).toBeNull();
    expect(submissionSetProblem([5 * MiB, 5 * MiB, 5 * MiB, 5 * MiB, 5 * MiB + 1])).toBe(FILE_MESSAGES.submissionTooLarge);
    expect(submissionSetProblem([1, 1, 1, 1, 1, 1])).toBe(FILE_MESSAGES.tooManySubmissionFiles);
    expect(submissionSetProblem([])).toBeNull();
  });

  it("daily quota: 50 MiB / 100 files for a student's پاسخ, 200 MiB / 300 files for a giver — inclusive", () => {
    expect(withinDailyQuota("submission", { bytes: 49 * MiB, files: 10 }, MiB)).toBe(true);
    expect(withinDailyQuota("submission", { bytes: 49 * MiB, files: 10 }, MiB + 1)).toBe(false);
    expect(withinDailyQuota("submission", { bytes: 0, files: 99 }, 1)).toBe(true);
    expect(withinDailyQuota("submission", { bytes: 0, files: 100 }, 1)).toBe(false);
    expect(withinDailyQuota("work_item", { bytes: 190 * MiB, files: 0 }, 10 * MiB)).toBe(true);
    expect(withinDailyQuota("work_item", { bytes: 190 * MiB + 1, files: 0 }, 10 * MiB)).toBe(false);
  });

  it("sizes read in Persian", () => {
    expect(formatBytesFa(800)).toBe("۸۰۰ بایت");
    expect(formatBytesFa(300 * 1024)).toBe("۳۰۰ کیلوبایت");
    expect(formatBytesFa(2.5 * MiB)).toBe("۲٫۵ مگابایت");
    expect(formatBytesFa(12 * MiB)).toBe("۱۲ مگابایت");
  });
});

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "edu-receive-"));
  dirs.push(d);
  return path.join(d, ".tmp");
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function streamOf(chunks: Uint8Array[], opts: { error?: boolean; hang?: boolean } = {}): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else if (opts.error) controller.error(new Error("connection reset"));
      else if (!opts.hang) controller.close();
      // hang: never enqueue, never close
    },
  });
}

const opts = (tempDirPath: string, over: Partial<Parameters<typeof receiveToTemp>[1]> = {}) => ({
  tempDir: tempDirPath,
  maxBytes: 1000,
  idleTimeoutMs: 2000,
  totalTimeoutMs: 5000,
  ...over,
});

describe("receiveToTemp", () => {
  it("streams the body to a temp file, counting and hashing on the way", async () => {
    const dir = tempDir();
    const parts = [Buffer.from("سلام "), Buffer.from("دنیا")];
    const r = await receiveToTemp(streamOf(parts), opts(dir, { expectedBytes: Buffer.concat(parts).length }));
    const all = Buffer.concat(parts);
    expect(r.size).toBe(all.length);
    expect(r.sha256).toBe(createHash("sha256").update(all).digest("hex"));
    expect(readFileSync(r.tempPath)).toEqual(all);
    expect(path.dirname(r.tempPath)).toBe(dir);
  });

  it("aborts past the cap — also when Content-Length already says so — and leaves nothing behind", async () => {
    const dir = tempDir();
    await expect(receiveToTemp(streamOf([Buffer.alloc(600), Buffer.alloc(600)]), opts(dir))).rejects.toMatchObject({ reason: "too_large" });
    expect(readdirSync(dir)).toEqual([]);
    await expect(receiveToTemp(streamOf([Buffer.alloc(10)]), opts(dir, { expectedBytes: 5000 }))).rejects.toMatchObject({ reason: "too_large" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a body shorter than its Content-Length, a broken connection, an empty body and a stalled one are refused, with nothing left", async () => {
    const dir = tempDir();
    await expect(receiveToTemp(streamOf([Buffer.alloc(10)]), opts(dir, { expectedBytes: 20 }))).rejects.toMatchObject({ reason: "incomplete" });
    await expect(receiveToTemp(streamOf([Buffer.alloc(10)], { error: true }), opts(dir))).rejects.toBeInstanceOf(ReceiveError);
    await expect(receiveToTemp(streamOf([]), opts(dir))).rejects.toMatchObject({ reason: "empty" });
    await expect(receiveToTemp(null, opts(dir))).rejects.toMatchObject({ reason: "empty" });
    await expect(receiveToTemp(streamOf([Buffer.alloc(3)], { hang: true }), opts(dir, { idleTimeoutMs: 50 }))).rejects.toMatchObject({ reason: "timeout" });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("upload slots", () => {
  it("at most N in flight per process and ONE per person; a release frees exactly one slot, twice is harmless", async () => {
    const { keyedSlots, uploadSlots } = await import("@/modules/files/storage");
    const proc = uploadSlots(2);
    const a = proc.tryAcquire();
    const b = proc.tryAcquire();
    expect(a && b).toBeTruthy();
    expect(proc.tryAcquire()).toBeNull();
    expect(proc.inFlight()).toBe(2);
    a!();
    a!();
    expect(proc.inFlight()).toBe(1);
    const c = proc.tryAcquire();
    expect(c).toBeTruthy();
    expect(proc.tryAcquire()).toBeNull();

    expect(FILE_LIMITS.maxConcurrentUploadsPerPerson).toBe(1);
    const people = keyedSlots(FILE_LIMITS.maxConcurrentUploadsPerPerson);
    const p1 = people.tryAcquire("p1");
    expect(p1).toBeTruthy();
    expect(people.tryAcquire("p1")).toBeNull();
    expect(people.tryAcquire("p2")).toBeTruthy();
    p1!();
    expect(people.tryAcquire("p1")).toBeTruthy();
  });

  it("the last 2 of the 8 process slots are only for a person with no slow abort; 3 slow aborts in 10 minutes refuse", async () => {
    const { uploadSlots } = await import("@/modules/files/storage");
    expect([slotCeilingFor(0), slotCeilingFor(1), slotCeilingFor(2), slotCeilingFor(3), slotCeilingFor(9)]).toEqual([8, 6, 6, null, null]);
    const proc = uploadSlots(FILE_LIMITS.maxConcurrentUploads);
    // Six people who were slow once fill what they may…
    const struck = Array.from({ length: 6 }, () => proc.tryAcquire(slotCeilingFor(1)!));
    expect(struck.every(Boolean)).toBe(true);
    expect(proc.tryAcquire(slotCeilingFor(1)!)).toBeNull();
    // …and two people with a clean record still get in.
    const clean = [proc.tryAcquire(slotCeilingFor(0)!), proc.tryAcquire(slotCeilingFor(0)!)];
    expect(clean.every(Boolean)).toBe(true);
    expect(proc.tryAcquire(slotCeilingFor(0)!)).toBeNull();
    // A ceiling never lifts the process limit.
    expect(proc.tryAcquire(99)).toBeNull();
    struck[0]!();
    expect(proc.tryAcquire(slotCeilingFor(1)!)).toBeNull(); // 7 in flight: still the reserved zone
    expect(proc.tryAcquire(slotCeilingFor(0)!)).toBeTruthy();
  });

  it("slidingCounter: events per key inside the window only", async () => {
    const { slidingCounter } = await import("@/modules/files/storage");
    const c = slidingCounter(FILE_LIMITS.slowStrikeWindowMs);
    expect(FILE_LIMITS.slowStrikeWindowMs).toBe(10 * 60 * 1000);
    c.add("p", 0);
    c.add("p", 1_000);
    c.add("q", 1_000);
    expect(c.count("p", 599_999)).toBe(2);
    expect(c.count("p", 600_000)).toBe(1);
    expect(c.count("p", 601_000)).toBe(0);
    expect(c.count("q", 600_500)).toBe(1);
    expect(c.count("nobody", 0)).toBe(0);
  });
});

describe("the pace rule of an upload body (D2)", () => {
  const rule: PaceRule = { idleTimeoutMs: FILE_LIMITS.idleTimeoutMs, totalTimeoutMs: FILE_LIMITS.totalTimeoutMs, minBytesPerSecond: FILE_LIMITS.minBytesPerSecond, slowGraceMs: FILE_LIMITS.slowGraceMs };

  it("the production numbers: 15 s idle, 100 KiB/s on average after 10 s, 90 s in all — under Caddy's 120 s and Node's 300 s", () => {
    expect(rule).toEqual({ idleTimeoutMs: 15_000, totalTimeoutMs: 90_000, minBytesPerSecond: 100 * 1024, slowGraceMs: 10_000 });
    expect(FILE_LIMITS.totalTimeoutMs).toBeLessThan(120_000);
    // A full-size file at the floor would need longer than the wall clock: the wall clock is the real bound for it.
    expect((FILE_LIMITS.maxFileBytes / FILE_LIMITS.minBytesPerSecond) * 1000).toBeGreaterThan(FILE_LIMITS.totalTimeoutMs);
  });

  it("paceViolation: the grace, the exact rate boundary, the idle limit and the wall clock", () => {
    expect(paceViolation(rule, { elapsedMs: 9_999, idleMs: 9_999, bytes: 0 })).toBeNull();
    expect(paceViolation(rule, { elapsedMs: 10_000, idleMs: 10_000, bytes: 0 })).toBe("slow");
    expect(paceViolation(rule, { elapsedMs: 10_000, idleMs: 0, bytes: 100 * 1024 * 10 })).toBeNull();
    expect(paceViolation(rule, { elapsedMs: 10_000, idleMs: 0, bytes: 100 * 1024 * 10 - 1 })).toBe("slow");
    expect(paceViolation(rule, { elapsedMs: 20_000, idleMs: 15_000, bytes: 9 * MiB })).toBe("idle");
    expect(paceViolation(rule, { elapsedMs: 90_000, idleMs: 0, bytes: 10 * MiB })).toBe("total");
    expect(paceViolation({ ...rule, minBytesPerSecond: 0 }, { elapsedMs: 60_000, idleMs: 14_999, bytes: 1 })).toBeNull();
  });

  it("paceWaitMs: the next moment the rule can break — and waiting exactly that long with no byte always breaks it", () => {
    expect(paceWaitMs(rule, { elapsedMs: 0, idleMs: 0, bytes: 0 })).toBe(10_000);
    // 2 MiB in 5 s: the average holds until 20.48 s, but the idle limit comes first.
    expect(paceWaitMs(rule, { elapsedMs: 5_000, idleMs: 0, bytes: 2 * MiB })).toBe(15_000);
    expect(paceWaitMs(rule, { elapsedMs: 89_000, idleMs: 0, bytes: 10 * MiB })).toBe(1_000);
    expect(paceWaitMs(rule, { elapsedMs: 95_000, idleMs: 0, bytes: 0 })).toBe(0);
    for (const elapsedMs of [0, 3_000, 9_999, 10_000, 12_345, 40_000, 89_999]) {
      for (const idleMs of [0, 1, 7_000, 14_999].filter((i) => i <= elapsedMs)) {
        for (const bytes of [0, 1, 50_000, 1_024_000, 3 * MiB, 9 * MiB]) {
          const s = { elapsedMs, idleMs, bytes };
          if (paceViolation(rule, s)) continue;
          const wait = paceWaitMs(rule, s);
          expect(wait, JSON.stringify(s)).toBeGreaterThan(0);
          expect(paceViolation(rule, { elapsedMs: elapsedMs + wait, idleMs: idleMs + wait, bytes }), JSON.stringify(s)).not.toBeNull();
          expect(paceViolation(rule, { elapsedMs: elapsedMs + wait - 1, idleMs: idleMs + wait - 1, bytes }), JSON.stringify(s)).toBeNull();
        }
      }
    }
  });
});

/** A body the test feeds by hand: `untilPulled(n)` resolves once the receiver has asked for its n-th chunk. */
function handFed() {
  let pulls = 0;
  let deliver: (() => void) | null = null;
  const waiting: Array<{ n: number; resolve: () => void }> = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      pull() {
        pulls++;
        for (const w of waiting.filter((x) => x.n <= pulls)) w.resolve();
        return new Promise<void>((resolve) => (deliver = resolve));
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    untilPulled: (n: number) => (pulls >= n ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ n, resolve }))),
    push(chunk: Uint8Array) {
      controller.enqueue(chunk);
      deliver?.();
    },
    close() {
      controller.close();
      deliver?.();
    },
  };
}

function settle(p: Promise<unknown>): { settled: boolean } {
  const s = { settled: false };
  p.then(
    () => (s.settled = true),
    () => (s.settled = true),
  );
  return s;
}

describe("receiveToTemp — the pace rule under fake timers (D2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const fake = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const paced = (dir: string, over: Partial<Parameters<typeof receiveToTemp>[1]> = {}) => ({
    tempDir: dir,
    maxBytes: 50 * MiB,
    idleTimeoutMs: FILE_LIMITS.idleTimeoutMs,
    totalTimeoutMs: FILE_LIMITS.totalTimeoutMs,
    minBytesPerSecond: FILE_LIMITS.minBytesPerSecond,
    slowGraceMs: FILE_LIMITS.slowGraceMs,
    ...over,
  });

  it("a trickle (1 KiB, then nothing fast enough) is aborted as slow exactly when the 10 s grace ends — nothing left behind", async () => {
    const dir = tempDir();
    fake();
    const body = handFed();
    const p = receiveToTemp(body.stream, paced(dir));
    const state = settle(p);
    await body.untilPulled(1);
    body.push(Buffer.alloc(1024));
    await body.untilPulled(2); // written, waiting for more
    await vi.advanceTimersByTimeAsync(9_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toMatchObject({ reason: "timeout", pace: "slow" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a body that stops is aborted as idle after 15 s without a byte (rate floor off)", async () => {
    const dir = tempDir();
    fake();
    const body = handFed();
    const p = receiveToTemp(body.stream, paced(dir, { minBytesPerSecond: 0 }));
    const state = settle(p);
    await body.untilPulled(1);
    await vi.advanceTimersByTimeAsync(5_000);
    body.push(Buffer.alloc(10));
    await body.untilPulled(2);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toMatchObject({ reason: "timeout", pace: "idle" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a body that keeps its pace but never ends is cut by the 90 s wall clock", async () => {
    const dir = tempDir();
    fake();
    const body = handFed();
    // 2 KiB a second over a 1 KiB/s floor: never slow, never idle.
    const p = receiveToTemp(body.stream, paced(dir, { minBytesPerSecond: 1024 }));
    const state = settle(p);
    for (let second = 1; second <= 89; second++) {
      await body.untilPulled(second);
      await vi.advanceTimersByTimeAsync(1_000);
      body.push(Buffer.alloc(2048));
    }
    await body.untilPulled(90);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).rejects.toMatchObject({ reason: "timeout", pace: "total" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a body above the floor that ends is received whole", async () => {
    const dir = tempDir();
    fake();
    const body = handFed();
    const p = receiveToTemp(body.stream, paced(dir));
    for (let i = 1; i <= 3; i++) {
      await body.untilPulled(i);
      await vi.advanceTimersByTimeAsync(1_000);
      body.push(Buffer.alloc(200 * 1024, i));
    }
    await body.untilPulled(4);
    body.close();
    const r = await p;
    expect(r.size).toBe(3 * 200 * 1024);
    expect(readFileSync(r.tempPath).subarray(200 * 1024, 200 * 1024 + 1)).toEqual(Buffer.from([2]));
  });
});

describe("attemptWindow", () => {
  it("allows `limit` attempts per key in the window, then refuses until the oldest ages out", async () => {
    const { attemptWindow } = await import("@/modules/files/storage");
    const w = attemptWindow(3, 1000);
    expect([w.allow("p", 0), w.allow("p", 10), w.allow("p", 20)]).toEqual([true, true, true]);
    expect(w.allow("p", 30)).toBe(false);
    expect(w.allow("q", 30)).toBe(true);
    expect(w.allow("p", 1001)).toBe(true);
    expect(w.allow("p", 1002)).toBe(false);
  });
});
