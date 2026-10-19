// files/receive — an upload's body streamed to a temp file, never held in memory: chunk by chunk into a fresh
// `<temp dir>/<random>.part` (O_EXCL, mode 0600), hashed (SHA-256) and counted on the way, aborted the moment it
// passes the cap, when it stalls (`idleTimeoutMs` without a byte) or runs past `totalTimeoutMs`, and when fewer bytes
// arrive than the request's Content-Length announced. On ANY failure the temp file is removed before the error
// propagates. fsync before close, so a later rename publishes complete bytes. No `env` (unit-tested with a temp dir).
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

export type ReceiveFailure = "too_large" | "incomplete" | "timeout" | "empty";

export class ReceiveError extends Error {
  constructor(
    readonly reason: ReceiveFailure,
    options?: { cause?: unknown },
  ) {
    super(`upload ${reason}`, options);
    this.name = "ReceiveError";
  }
}

export interface ReceiveOptions {
  tempDir: string;
  maxBytes: number;
  /** From Content-Length when the client sent one: fewer bytes than this = `incomplete`, more = `too_large`. */
  expectedBytes?: number | null;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface Received {
  tempPath: string;
  size: number;
  sha256: string;
}

type Chunk = ReadableStreamReadResult<Uint8Array>;

async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number, deadline: number): Promise<Chunk> {
  const wait = Math.max(0, Math.min(idleMs, deadline - Date.now()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReceiveError("timeout")), wait);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function receiveToTemp(body: ReadableStream<Uint8Array> | null, opts: ReceiveOptions): Promise<Received> {
  if (!body) throw new ReceiveError("empty");
  if (opts.expectedBytes != null && opts.expectedBytes > opts.maxBytes) throw new ReceiveError("too_large");
  await mkdir(opts.tempDir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(opts.tempDir, `${randomUUID()}.part`);
  const handle = await open(tempPath, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  const deadline = Date.now() + opts.totalTimeoutMs;
  let size = 0;
  let closed = false;
  try {
    for (;;) {
      const { done, value } = await readWithTimeout(reader, opts.idleTimeoutMs, deadline);
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
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
    await reader.cancel().catch(() => undefined);
    if (!closed) await handle.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    // A body that broke off (client gone, connection reset) is just an incomplete upload; a disk error rides along
    // as the cause for the caller's log.
    throw err instanceof ReceiveError ? err : new ReceiveError("incomplete", { cause: err });
  }
}
