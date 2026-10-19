// files/storage — the bytes on disk under FILES_DIR (docs/decisions.md 2026-10-19 «پیوست تکلیف و تحویل پاسخ»).
//
//   • root: `FILES_DIR`, read lazily from `process.env` (like src/lib/crypto.ts — so scripts and the int tests can
//     point it at their own directory); default `/data/files` in production (the Docker volume, writable by uid 1001
//     `nextjs` — Dockerfile) and `./.data/files` (gitignored) otherwise;
//   • layout: `<org>/<yyyy>/<file id>` (./paths), temp files in `<root>/.tmp` on the same volume;
//   • publishing is a rename of a complete, fsynced temp file into a fresh path (never over an existing one);
//   • deleting is best effort: a failure is logged with the key only (no names, no content) and never fails the
//     request — the row decides what exists (a download needs a live row), leftovers are swept (./README.md).
import { mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { logger } from "@/lib/logger";
import { storagePathIn, tempDirIn } from "./paths";

export function filesRoot(): string {
  const configured = process.env.FILES_DIR?.trim();
  return path.resolve(configured || (process.env.NODE_ENV === "production" ? "/data/files" : ".data/files"));
}

export function tempDir(): string {
  return tempDirIn(filesRoot());
}

/** Moves a complete temp file to its key. Refuses to replace anything already there (a key is never reused). */
export async function publishTemp(tempPath: string, key: string): Promise<void> {
  const dest = storagePathIn(filesRoot(), key);
  await mkdir(path.dirname(dest), { recursive: true, mode: 0o750 });
  const existing = await stat(dest).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)));
  if (existing) throw new Error("publishTemp: storage key already in use");
  await rename(tempPath, dest);
}

export async function discardTemp(tempPath: string): Promise<void> {
  await rm(tempPath, { force: true }).catch((err) => logger.warn({ err }, "files: temp file not removed"));
}

/** Deletes the bytes of these keys (archived rows). Best effort, one log line per failure, keys only. */
export async function removeStored(keys: readonly string[]): Promise<void> {
  const root = filesRoot();
  for (const key of keys) {
    try {
      await rm(storagePathIn(root, key), { force: true });
    } catch (err) {
      logger.warn({ err, storageKey: key }, "files: stored bytes not removed");
    }
  }
}

export interface StoredStream {
  size: number;
  stream: ReadableStream<Uint8Array>;
}

/** The stored bytes as a web stream, or null when they are missing (logged — a row without bytes is a fault). */
export async function openStored(key: string): Promise<StoredStream | null> {
  let handle;
  try {
    handle = await open(storagePathIn(filesRoot(), key), "r");
  } catch (err) {
    logger.error({ err, storageKey: key }, "files: stored bytes missing");
    return null;
  }
  try {
    const { size } = await handle.stat();
    const node = handle.createReadStream({ autoClose: true });
    return { size, stream: Readable.toWeb(node) as unknown as ReadableStream<Uint8Array> };
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
}

/** Free bytes on the files volume; `Infinity` where the platform cannot say (never blocks uploads by itself). */
export async function freeBytes(): Promise<number> {
  try {
    const root = filesRoot();
    await mkdir(root, { recursive: true });
    const s = await statfs(root);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Removes temp files older than `olderThanMs` (left by a crash mid-upload). Cheap: one readdir of `.tmp`. */
export async function sweepTemp(olderThanMs: number): Promise<number> {
  const dir = tempDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".part")) continue;
    const p = path.join(dir, name);
    const s = await stat(p).catch(() => null);
    if (s && s.isFile() && s.mtimeMs < cutoff) {
      await rm(p, { force: true }).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}

/** At most `limit` uploads in flight in this process; `tryAcquire` returns a release, or null when full. */
export function uploadSlots(limit: number): { tryAcquire: () => (() => void) | null } {
  const keyed = keyedSlots(limit);
  return { tryAcquire: () => keyed.tryAcquire("") };
}

/** At most `limit` in flight per key (one person's parallel uploads); `tryAcquire` returns a release, or null. */
export function keyedSlots(limit: number): { tryAcquire: (key: string) => (() => void) | null } {
  const inFlight = new Map<string, number>();
  return {
    tryAcquire(key) {
      const n = inFlight.get(key) ?? 0;
      if (n >= limit) return null;
      inFlight.set(key, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (inFlight.get(key) ?? 1) - 1;
        if (left <= 0) inFlight.delete(key);
        else inFlight.set(key, left);
      };
    },
  };
}

/**
 * At most `limit` upload ATTEMPTS per key in a sliding `windowMs` — refused ones included (the daily quota counts only
 * what was recorded, so without this a person could make the server receive and sniff garbage without end). In
 * memory, per process: enough for the one app instance; a restart forgets it.
 */
export function attemptWindow(limit: number, windowMs: number): { allow: (key: string, now?: number) => boolean } {
  const seen = new Map<string, number[]>();
  return {
    allow(key, now = Date.now()) {
      const recent = (seen.get(key) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return false;
      }
      recent.push(now);
      seen.set(key, recent);
      if (seen.size > 10_000) for (const [k, ts] of seen) if (ts.every((t) => t <= now - windowMs)) seen.delete(k);
      return true;
    },
  };
}

/** The size of the stored bytes of a key, or null when they are missing (HEAD of a download). */
export async function statStored(key: string): Promise<number | null> {
  try {
    const s = await stat(storagePathIn(filesRoot(), key));
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}
