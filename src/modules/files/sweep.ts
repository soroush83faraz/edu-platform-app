// files/sweep — bytes on disk that no live row names any more («یتیم»): left by a crash between an upload's rename and
// its commit, or between a commit and the deletion of an archived file's bytes (docs/decisions.md 2026-10-19 — the
// security review's D6). Bounded and conservative:
//   • ONE organization per run (the tenant the caller's transaction is bound to), only `<root>/<org>/<this year>` and
//     `<last year>`, at most `maxFiles` regular files named by a file id (anything else — a symlink, a stray name — is
//     never touched), from a random point of the listing so that successive runs cover a large directory;
//   • it asks the database which of those ids have a LIVE row (pending / attached): `app.live_file_ids` (migration
//     0025, SECURITY DEFINER, the current organization only; it raises when none is bound). A failed lookup deletes
//     nothing;
//   • a file is deleted only when no live row names it AND it was last written more than 24 h ago (`orphanVerdict`:
//     an upload's bytes are renamed into place before its row commits; an archived row's bytes are garbage — the app
//     deletes them itself right after the commit);
//   • a run in which most of what it saw looks orphaned (a wrong FILES_DIR, a restored database) deletes nothing and
//     says so (`braked`) — `force` overrides that for an operator who has checked;
//   • `dryRun` reports and deletes nothing.
// Callers: the upload route, at most once an hour per organization and process, after the response
// (src/app/api/files/route.ts → workspace/file-gates `sweepOrphansGate`), and `scripts/sweep-files.ts`
// (docs/ops/runbook.md). Logs carry counts and keys only.
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { logger } from "@/lib/logger";
import { STORAGE_KEY_RE, storagePathIn } from "./paths";

export const SWEEP_LIMITS = {
  /** Bytes younger than this are never orphans. */
  minAgeMs: 24 * 60 * 60 * 1000,
  /** Files looked at per run and organization. */
  maxFiles: 500,
  /** The database is asked about at most this many ids per call (= app.live_file_ids's cap). */
  lookupChunk: 1000,
  /** A run that saw at least `brakeMinFiles` files, more than `brakeShare` of them orphans, deletes nothing. */
  brakeMinFiles: 10,
  brakeShare: 0.5,
  /** The upload route sweeps one organization at most this often (per process). */
  everyMs: 60 * 60 * 1000,
} as const;

/** Pure: delete the bytes of one file id? Only when no live row names them and they are older than `minAgeMs`. */
export function orphanVerdict(file: { mtimeMs: number }, live: boolean, now: number, minAgeMs: number = SWEEP_LIMITS.minAgeMs): "keep" | "delete" {
  if (live) return "keep";
  const age = now - file.mtimeMs;
  return Number.isFinite(age) && age >= minAgeMs ? "delete" : "keep";
}

/** Pure: does a run look wrong — most of what it saw would go? Then it deletes nothing. */
export function sweepBraked(examined: number, orphans: number): boolean {
  return examined >= SWEEP_LIMITS.brakeMinFiles && orphans > examined * SWEEP_LIMITS.brakeShare;
}

export interface SweepCandidate {
  fileId: string;
  key: string;
  path: string;
  mtimeMs: number;
}

/** Up to `limit` regular files named by a file id in the organization's year directories, from a random start. */
export async function listCandidates(root: string, orgId: string, years: readonly number[], limit: number, random: () => number = Math.random): Promise<SweepCandidate[]> {
  const out: SweepCandidate[] = [];
  const org = orgId.toLowerCase();
  for (const year of years) {
    if (out.length >= limit) break;
    let names: string[];
    try {
      names = (await readdir(path.join(root, org, String(year)), { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
    } catch {
      continue; // no such year (yet)
    }
    const start = names.length > 0 ? Math.floor(random() * names.length) : 0;
    for (let n = 0; n < names.length && out.length < limit; n++) {
      const name = names[(start + n) % names.length];
      const key = `${org}/${year}/${name}`;
      if (!STORAGE_KEY_RE.test(key)) continue;
      const full = storagePathIn(root, key);
      const st = await lstat(full).catch(() => null);
      if (!st || !st.isFile()) continue;
      out.push({ fileId: name, key, path: full, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

export interface SweepReport {
  organizationId: string;
  /** Files looked at. */
  examined: number;
  /** Of those, with no live row and older than 24 h. */
  orphans: number;
  deleted: number;
  /** Most of what it saw looked orphaned: nothing was deleted. */
  braked: boolean;
  dryRun: boolean;
  /** The database could not be asked: nothing was deleted. */
  lookupFailed: boolean;
}

export interface SweepOptions {
  root: string;
  orgId: string;
  /** Which of these ids have a live row — `liveFileIds` inside the organization's own transaction. */
  liveIds: (ids: string[]) => Promise<Set<string>>;
  now?: number;
  maxFiles?: number;
  dryRun?: boolean;
  /** Delete even when the run looks wrong (`braked`) — an operator's call after a dry run. */
  force?: boolean;
}

export async function sweepOrphans(opts: SweepOptions): Promise<SweepReport> {
  const now = opts.now ?? Date.now();
  const year = new Date(now).getUTCFullYear();
  const report: SweepReport = { organizationId: opts.orgId, examined: 0, orphans: 0, deleted: 0, braked: false, dryRun: !!opts.dryRun, lookupFailed: false };
  const candidates = await listCandidates(opts.root, opts.orgId, [year, year - 1], opts.maxFiles ?? SWEEP_LIMITS.maxFiles);
  report.examined = candidates.length;
  const old = candidates.filter((c) => orphanVerdict(c, false, now) === "delete");
  if (old.length === 0) return report;
  let live: Set<string>;
  try {
    live = await opts.liveIds(old.map((c) => c.fileId));
  } catch (err) {
    logger.error({ err, organizationId: opts.orgId }, "files: orphan sweep — live-row lookup failed, nothing deleted");
    return { ...report, lookupFailed: true };
  }
  const orphans = old.filter((c) => orphanVerdict(c, live.has(c.fileId), now) === "delete");
  report.orphans = orphans.length;
  report.braked = sweepBraked(candidates.length, orphans.length);
  if (orphans.length === 0 || report.dryRun || (report.braked && !opts.force)) {
    if (report.braked) logger.warn({ organizationId: opts.orgId, examined: report.examined, orphans: report.orphans }, "files: orphan sweep braked — most files look orphaned, nothing deleted");
    return report;
  }
  for (const o of orphans) {
    try {
      await rm(o.path, { force: true });
      report.deleted++;
    } catch (err) {
      logger.warn({ err, storageKey: o.key }, "files: orphan not removed");
    }
  }
  logger.info({ organizationId: opts.orgId, examined: report.examined, deleted: report.deleted, keys: orphans.map((o) => o.key) }, "files: orphan sweep");
  return report;
}

/** Which of `ids` have a live (pending / attached) row in the transaction's organization — app.live_file_ids, 1000 at a time. */
export async function liveFileIds(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += SWEEP_LIMITS.lookupChunk) {
    const part = ids.slice(i, i + SWEEP_LIMITS.lookupChunk);
    if (!part.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) throw new Error("liveFileIds: ids must be UUIDs");
    const res = await tx.execute<{ id: string }>(sql`select id from app.live_file_ids(${`{${part.join(",")}}`}::uuid[]) as id`);
    for (const r of res.rows) out.add(r.id);
  }
  return out;
}
