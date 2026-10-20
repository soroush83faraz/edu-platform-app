// The orphan sweeper (src/modules/files/sweep.ts; security review 2026-10-19, D6): bytes are deleted only when no live
// row names them AND they were last written more than 24 h ago; it never walks more than one organization's two year
// directories, never touches a stray name or anything but a regular file, deletes nothing when the lookup fails, and
// nothing when most of what it saw looks orphaned. A temp directory stands in for FILES_DIR; the database lookup is a
// function (its SQL half, app.live_file_ids, is tested in tests/int/work-item-files.test.ts).
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SWEEP_LIMITS, listCandidates, orphanVerdict, sweepBraked, sweepOrphans } from "@/modules/files/sweep";

const ORG = "0199a000-0000-7000-8000-00000000000a";
const OTHER = "0199a000-0000-7000-8000-00000000000b";
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const id = (n: number) => `0199a000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A files volume holding these files, each last written `ageMs` before NOW. */
function volume(files: Array<{ org?: string; year?: number; name: string; ageMs: number }>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "edu-sweep-"));
  roots.push(root);
  for (const f of files) {
    const dir = path.join(root, f.org ?? ORG, String(f.year ?? 2026));
    mkdirSync(dir, { recursive: true });
    const p = path.join(dir, f.name);
    writeFileSync(p, "x");
    const t = (NOW - f.ageMs) / 1000;
    utimesSync(p, t, t);
  }
  return root;
}

const exists = (root: string, name: string, year = 2026, org = ORG) => existsSync(path.join(root, org, String(year), name));
const liveAmong = (liveIds: string[]) => async (asked: string[]) => new Set(asked.filter((a) => liveIds.includes(a)));

describe("orphanVerdict / sweepBraked (pure)", () => {
  it("deletes only bytes no live row names, last written at least 24 h ago", () => {
    expect(SWEEP_LIMITS.minAgeMs).toBe(DAY);
    expect(orphanVerdict({ mtimeMs: NOW - DAY }, false, NOW)).toBe("delete");
    expect(orphanVerdict({ mtimeMs: NOW - DAY + 1 }, false, NOW)).toBe("keep");
    expect(orphanVerdict({ mtimeMs: NOW - 30 * DAY }, true, NOW)).toBe("keep");
    expect(orphanVerdict({ mtimeMs: Number.NaN }, false, NOW)).toBe("keep");
    expect(orphanVerdict({ mtimeMs: NOW + DAY }, false, NOW)).toBe("keep"); // written "in the future": never
  });

  it("brakes a run in which most of at least 10 files would go", () => {
    expect(sweepBraked(9, 9)).toBe(false);
    expect(sweepBraked(10, 5)).toBe(false);
    expect(sweepBraked(10, 6)).toBe(true);
    expect(sweepBraked(100, 50)).toBe(false);
    expect(sweepBraked(100, 51)).toBe(true);
  });
});

describe("listCandidates", () => {
  it("only regular files named by a file id, in ONE organization's given year directories, at most `limit`", async () => {
    const root = volume([
      { name: id(1), ageMs: 2 * DAY },
      { name: id(2), ageMs: 2 * DAY, year: 2025 },
      { name: id(3), ageMs: 2 * DAY, year: 2024 }, // a year it was not asked to walk
      { name: id(4), ageMs: 2 * DAY, org: OTHER }, // another organization
      { name: "notes.txt", ageMs: 2 * DAY },
      { name: id(5).toUpperCase(), ageMs: 2 * DAY }, // not the server's own (lower-case) shape
    ]);
    mkdirSync(path.join(root, ORG, "2026", id(6))); // a directory named like a file
    let linked = false;
    try {
      symlinkSync(path.join(root, ORG, "2026", id(1)), path.join(root, ORG, "2026", id(7)));
      linked = true;
    } catch {
      /* no symlink privilege on this machine: the case is skipped */
    }
    const found = await listCandidates(root, ORG, [2026, 2025], 100);
    expect(found.map((c) => c.fileId).sort()).toEqual([id(1), id(2)]);
    expect(found.find((c) => c.fileId === id(2))?.key).toBe(`${ORG}/2025/${id(2)}`);
    if (linked) expect(found.some((c) => c.fileId === id(7))).toBe(false);
    expect(await listCandidates(root, ORG, [2026, 2025], 1)).toHaveLength(1);
    expect((await listCandidates(root, OTHER, [2026], 100)).map((c) => c.fileId)).toEqual([id(4)]);
    expect(await listCandidates(root, "0199a000-0000-7000-8000-0000000000ff", [2026], 100)).toEqual([]);
  });

  it("starts at a random point of the listing, so successive capped runs over a big directory see different files", async () => {
    const root = volume(Array.from({ length: 6 }, (_, i) => ({ name: id(10 + i), ageMs: 2 * DAY })));
    const first = (await listCandidates(root, ORG, [2026], 2, () => 0)).map((c) => c.fileId);
    const middle = (await listCandidates(root, ORG, [2026], 2, () => 0.5)).map((c) => c.fileId);
    expect(first).toHaveLength(2);
    expect(middle).toHaveLength(2);
    expect(middle).not.toEqual(first);
  });
});

describe("sweepOrphans", () => {
  it("deletes the old bytes no live row names; keeps a live row's bytes and anything younger than 24 h; asks only about the old ones", async () => {
    const root = volume([
      { name: id(1), ageMs: 3 * DAY }, // an orphan
      { name: id(2), ageMs: 3 * DAY }, // its row is live
      { name: id(3), ageMs: 3 * HOUR }, // no row (yet): an upload renames its bytes into place before it commits
      { name: id(8), ageMs: 40 * DAY, year: 2025 }, // last year's orphan
    ]);
    const asked: string[] = [];
    const report = await sweepOrphans({
      root,
      orgId: ORG,
      now: NOW,
      liveIds: async (ids) => {
        asked.push(...ids);
        return new Set(ids.filter((x) => x === id(2)));
      },
    });
    expect(report).toEqual({ organizationId: ORG, examined: 4, orphans: 2, deleted: 2, braked: false, dryRun: false, lookupFailed: false });
    expect(asked.sort()).toEqual([id(1), id(2), id(8)].sort());
    expect([exists(root, id(1)), exists(root, id(2)), exists(root, id(3)), exists(root, id(8), 2025)]).toEqual([false, true, true, false]);
  });

  it("a dry run reports and deletes nothing; a failed lookup deletes nothing", async () => {
    const root = volume([{ name: id(1), ageMs: 3 * DAY }]);
    expect(await sweepOrphans({ root, orgId: ORG, now: NOW, dryRun: true, liveIds: liveAmong([]) })).toMatchObject({ orphans: 1, deleted: 0, dryRun: true });
    const failed = await sweepOrphans({
      root,
      orgId: ORG,
      now: NOW,
      liveIds: async () => {
        throw new Error("database unreachable");
      },
    });
    expect(failed).toMatchObject({ deleted: 0, lookupFailed: true });
    expect(exists(root, id(1))).toBe(true);
  });

  it("a run in which most files look orphaned (a wrong FILES_DIR, another database) deletes nothing — unless an operator forces it", async () => {
    const root = volume(Array.from({ length: 12 }, (_, i) => ({ name: id(20 + i), ageMs: 3 * DAY })));
    const braked = await sweepOrphans({ root, orgId: ORG, now: NOW, liveIds: liveAmong([id(20)]) });
    expect(braked).toMatchObject({ examined: 12, orphans: 11, deleted: 0, braked: true });
    expect(exists(root, id(21))).toBe(true);
    const forced = await sweepOrphans({ root, orgId: ORG, now: NOW, force: true, liveIds: liveAmong([id(20)]) });
    expect(forced).toMatchObject({ orphans: 11, deleted: 11, braked: true });
    expect([exists(root, id(20)), exists(root, id(21))]).toEqual([true, false]);
  });

  it("bounded work: at most `maxFiles` looked at per run", async () => {
    const root = volume(Array.from({ length: 5 }, (_, i) => ({ name: id(40 + i), ageMs: 3 * DAY })));
    const report = await sweepOrphans({ root, orgId: ORG, now: NOW, maxFiles: 2, liveIds: liveAmong([]) });
    expect(report).toMatchObject({ examined: 2, orphans: 2, deleted: 2 });
  });
});
