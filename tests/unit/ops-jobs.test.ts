// The pure parts of the job runner (src/modules/ops, src/lib/jobs/plan): cron parsing and the next fire in Asia/Tehran,
// backoff, the scrubbed last_error, the kind registry's rules and the claim plan of one worker turn.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { claimWants } from "@/lib/jobs/plan";
import { cronMatches, localParts, nextFire, parseCron } from "@/modules/ops/cron";
import { JOB_KINDS, type JobKindDef, kindProblems, leaseSecondsFor } from "@/modules/ops/kinds";
import { DEFAULT_BACKOFF, backoffMs, errorSummary, scrubMessage } from "@/modules/ops/retry";
import { SCHEDULES, scheduleDedupeKey } from "@/modules/ops/schedules";

const at = (iso: string) => new Date(iso);

describe("parseCron", () => {
  it("reads numbers, ranges, steps and lists", () => {
    const s = parseCron("*/15 8-10 1,15 * 1-5");
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([8, 9, 10]);
    expect([...s.daysOfMonth]).toEqual([1, 15]);
    expect(s.months.size).toBe(12);
    expect([...s.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron("5/20 * * * *").minutes).toEqual(new Set([5, 25, 45]));
    expect(parseCron("0 0 * * 7").daysOfWeek).toEqual(new Set([0])); // 7 = Sunday
  });

  it("refuses what it does not understand", () => {
    for (const bad of ["* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "5-1 * * * *", "*/0 * * * *", "MON * * * *", "@daily"]) {
      expect(() => parseCron(bad), bad).toThrow();
    }
  });
});

describe("nextFire in Asia/Tehran", () => {
  it("03:30 Tehran is 00:00 UTC — in winter and in summer alike (no DST since 2022)", () => {
    const s = parseCron("30 3 * * *");
    expect(nextFire(s, at("2026-01-10T12:00:00Z")).toISOString()).toBe("2026-01-11T00:00:00.000Z");
    expect(nextFire(s, at("2026-06-21T12:00:00Z")).toISOString()).toBe("2026-06-22T00:00:00.000Z");
    // Around the dates Iran used to change its clocks (22 March / 22 September), nothing moves.
    expect(nextFire(s, at("2026-03-21T12:00:00Z")).toISOString()).toBe("2026-03-22T00:00:00.000Z");
    expect(nextFire(s, at("2026-03-22T12:00:00Z")).toISOString()).toBe("2026-03-23T00:00:00.000Z");
    expect(nextFire(s, at("2026-09-21T12:00:00Z")).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(nextFire(s, at("2026-09-22T12:00:00Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(localParts(at("2026-07-01T00:00:00Z"))).toMatchObject({ hour: 3, minute: 30 });
  });

  it("is strictly after its argument, at a whole minute", () => {
    const every = parseCron("* * * * *");
    expect(nextFire(every, at("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-10-20T10:01:00.000Z");
    expect(nextFire(every, at("2026-10-20T10:00:59.999Z")).toISOString()).toBe("2026-10-20T10:01:00.000Z");
    const hourly = parseCron("17 * * * *");
    // :17 Tehran = :47 UTC (the half-hour offset).
    expect(nextFire(hourly, at("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-10-20T10:47:00.000Z");
  });

  it("days: day-of-week in Tehran's calendar day; both day fields restricted = either matches", () => {
    // Saturday (6) 07:00 Tehran = Friday 03:30 UTC.
    expect(nextFire(parseCron("0 7 * * 6"), at("2026-10-20T00:00:00Z")).toISOString()).toBe("2026-10-24T03:30:00.000Z");
    const either = parseCron("0 0 1 * 1"); // the 1st of the month OR a Monday
    const n = nextFire(either, at("2026-10-20T00:00:00Z")); // Tue 20 Oct → Mon 26 Oct 00:00 Tehran
    expect(n.toISOString()).toBe("2026-10-25T20:30:00.000Z");
    expect(cronMatches(either, n)).toBe(true);
    // A leap day years away is still found.
    expect(nextFire(parseCron("0 12 29 2 *"), at("2026-03-01T00:00:00Z")).toISOString()).toBe("2028-02-29T08:30:00.000Z");
  });

  it("a zone WITH daylight saving: a skipped local hour is skipped, the rest keep their wall-clock time", () => {
    // Europe/Berlin springs forward on 2026-03-29 at 02:00 → 03:00: 02:30 does not exist that day.
    const s = parseCron("30 2 * * *");
    expect(nextFire(s, at("2026-03-28T12:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-03-30T00:30:00.000Z");
    expect(nextFire(parseCron("0 9 * * *"), at("2026-03-29T00:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });
});

describe("backoff and last_error", () => {
  it("doubles from 30 s, is capped at an hour, jitters within ±20 %", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4].map((n) => backoffMs(n, DEFAULT_BACKOFF, mid))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(20, DEFAULT_BACKOFF, mid)).toBe(3_600_000);
    expect(backoffMs(1, DEFAULT_BACKOFF, () => 0)).toBe(24_000);
    expect(backoffMs(1, DEFAULT_BACKOFF, () => 1)).toBe(36_000);
    expect(backoffMs(30, DEFAULT_BACKOFF, () => 1)).toBe(3_600_000);
    expect(backoffMs(0, DEFAULT_BACKOFF, mid)).toBe(30_000);
  });

  it("masks e-mail addresses, phone-like digit runs and quoted values; keeps the class and the SQLSTATE", () => {
    expect(scrubMessage('user "علی رضایی" ali@x.ir 09121234567 «متن»  id 42')).toBe("user … … … … id 42");
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: "23505" });
    expect(errorSummary(pg)).toBe("Error [23505]: duplicate key value violates unique constraint …");
    expect(errorSummary(new Error("x".repeat(1000))).length).toBe(300);
    expect(errorSummary("plain")).toBe("string: plain");
  });
});

describe("the kind registry", () => {
  it("every registered kind is valid: module.verb_noun, a strict payload of ids and numbers only", () => {
    for (const [name, def] of Object.entries(JOB_KINDS)) expect(kindProblems(name, def as JobKindDef), name).toEqual([]);
  });

  it("refuses text in a payload, a loose payload, a bad name and out-of-range limits", () => {
    const base: JobKindDef = { description: "x", payload: z.object({ id: z.uuid() }).strict(), maxAttempts: 3, concurrency: 1, timeoutMs: 10_000 };
    expect(kindProblems("ops.ok_kind", base)).toEqual([]);
    expect(kindProblems("ops.ok_kind", { ...base, payload: z.object({ ids: z.array(z.uuid()).max(10), n: z.number().int().optional(), at: z.iso.datetime() }).strict() })).toEqual([]);
    expect(kindProblems("ops.x", { ...base, payload: z.object({ name: z.string() }).strict() }).join()).toMatch(/never text/);
    expect(kindProblems("ops.x", { ...base, payload: z.object({ id: z.uuid() }) }).join()).toMatch(/strict/);
    expect(kindProblems("NoDot", base).join()).toMatch(/module.verb_noun/);
    expect(kindProblems("ops.x", { ...base, maxAttempts: 0, concurrency: 0, timeoutMs: 10 })).toHaveLength(3);
  });

  it("every schedule names a registered kind and a cron that fires; its dedupe key carries the tick", () => {
    for (const s of SCHEDULES) {
      expect(s.kind in JOB_KINDS, s.name).toBe(true);
      expect(() => nextFire(parseCron(s.cron), new Date(0)), s.name).not.toThrow();
    }
    expect(new Set(SCHEDULES.map((s) => s.name)).size).toBe(SCHEDULES.length);
    expect(scheduleDedupeKey("ops.prune_jobs.nightly", at("2026-10-21T00:00:00Z"))).toBe("schedule:ops.prune_jobs.nightly:2026-10-21T00:00:00.000Z");
  });

  it("the lease outlives the timeout", () => {
    expect(leaseSecondsFor({ timeoutMs: 120_000 })).toBe(150);
  });
});

describe("claimWants", () => {
  const kinds: Record<string, JobKindDef> = {
    "a.one": { description: "", payload: z.object({}).strict(), maxAttempts: 1, concurrency: 2, timeoutMs: 10_000 },
    "b.two": { description: "", payload: z.object({}).strict(), maxAttempts: 1, concurrency: 1, timeoutMs: 20_000 },
    "c.three": { description: "", payload: z.object({}).strict(), maxAttempts: 1, concurrency: 1, timeoutMs: 30_000 },
  };

  it("asks for the free slots of each kind within the process cap", () => {
    expect(claimWants(kinds, new Map(), 10)).toEqual([
      { kind: "a.one", limit: 2, leaseSeconds: 40 },
      { kind: "b.two", limit: 1, leaseSeconds: 50 },
      { kind: "c.three", limit: 1, leaseSeconds: 60 },
    ]);
    expect(claimWants(kinds, new Map([["a.one", 2], ["b.two", 1]]), 10)).toEqual([{ kind: "c.three", limit: 1, leaseSeconds: 60 }]);
    expect(claimWants(kinds, new Map([["a.one", 1]]), 1)).toEqual([]);
  });

  it("rotates the first kind so a tight process cap starves no kind", () => {
    expect(claimWants(kinds, new Map(), 1, 0).map((w) => w.kind)).toEqual(["a.one"]);
    expect(claimWants(kinds, new Map(), 1, 1).map((w) => w.kind)).toEqual(["b.two"]);
    expect(claimWants(kinds, new Map(), 1, 2).map((w) => w.kind)).toEqual(["c.three"]);
  });
});
