// The numbers of «پیوست تکلیف و تحویل پاسخ» (src/modules/files/limits.ts) and the stream-to-disk receiver
// (src/modules/files/receive.ts): caps hold at their exact boundary, a refused upload leaves no temp file behind.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FILE_LIMITS, FILE_MESSAGES, MiB, fileSizeProblem, formatBytesFa, itemSetProblem, submissionSetProblem, withinDailyQuota } from "@/modules/files/limits";
import { ReceiveError, receiveToTemp } from "@/modules/files/receive";

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
