// The Postgres job runner (migration 0026; src/modules/ops, src/lib/jobs): outbox enqueue, SKIP LOCKED claims, lease
// expiry, fencing, retries with backoff, dead-letter, the system actor's audit rows, RLS of ops.job, and the scheduler
// firing a tick once with two workers. Test kinds (`test.*`) are passed in a registry of the test's own; the real
// registry's handlers are smoke-run at the end.
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { withTenant, withoutTenant } from "@/db/client";
import { audit } from "@/lib/audit";
import { REGISTRY } from "@/lib/jobs/handlers";
import { claimWants } from "@/lib/jobs/plan";
import { type ClaimedJob, type JobHandler, type JobRegistry, claimJobs, runJob } from "@/lib/jobs/runner";
import { syncSchedules, tickSchedules } from "@/lib/jobs/scheduler";
import { runWorker } from "@/lib/jobs/worker";
import { enqueueJob, insertJob } from "@/modules/ops/enqueue";
import type { JobKindDef } from "@/modules/ops/kinds";
import { PermanentJobError } from "@/modules/ops/retry";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

const ORG_CTX = "select set_config('app.current_org_id', $1, true)";
const Ids = z.object({ n: z.number().int() }).strict();
const def = (over: Partial<JobKindDef> = {}): JobKindDef => ({ description: "test", payload: Ids, maxAttempts: 3, concurrency: 4, timeoutMs: 10_000, ...over });

const ran: Array<{ jobId: string; worker: string; n: number }> = [];
const record =
  (worker: string, waitMs = 0): JobHandler<{ n: number }> =>
  async (_tx, ctx, payload) => {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    ran.push({ jobId: ctx.jobId, worker, n: payload.n });
  };

function registry(handlers: Record<string, JobHandler<{ n: number }>>, kinds: Record<string, JobKindDef> = {}): JobRegistry {
  const k: Record<string, JobKindDef> = {};
  for (const name of Object.keys(handlers)) k[name] = kinds[name] ?? def();
  return { kinds: k, handlers };
}

async function enqueue(orgId: string, kind: string, n: number, opts: { dedupeKey?: string; maxAttempts?: number } = {}, kindDef: JobKindDef = def()) {
  return withTenant({ orgId }, (tx) => insertJob(tx, orgId, kind, kindDef, { n }, opts));
}

async function jobRow(orgId: string, id: string) {
  return withTenant({ orgId }, async (tx) => {
    const r = await tx.execute<{ status: string; attempts: number; locked_by: string | null; last_error: string | null; run_at: Date; finished_at: Date | null }>(
      sql`select status, attempts, locked_by, last_error, run_at, finished_at from ops.job where id = ${id}`,
    );
    return r.rows[0];
  });
}

const allOrgs = async (): Promise<string[]> => (await withoutTenant((tx) => tx.execute<{ id: string }>(sql`select id from tenancy.organization order by id`))).rows.map((r) => r.id);

afterEach(async () => {
  ran.length = 0;
  for (const orgId of await allOrgs()) await withTenant({ orgId }, (tx) => tx.execute(sql`delete from ops.job`));
  await withoutTenant((tx) => tx.execute(sql`delete from ops.schedule where name like 'test.%'`));
});

describe("enqueue (outbox)", () => {
  it("a job enqueued in a transaction that rolls back does not exist; a committed one does", async () => {
    await expect(
      withTenant({ orgId: f.ORG_A }, async (tx) => {
        await insertJob(tx, f.ORG_A, "test.record", def(), { n: 1 });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    const none = await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from ops.job`));
    expect(none.rows[0].n).toBe(0);
    const made = await enqueue(f.ORG_A, "test.record", 2);
    expect(made.created).toBe(true);
    expect((await jobRow(f.ORG_A, made.id!)).status).toBe("queued");
  });

  it("the same dedupe key creates one job per organization", async () => {
    const a1 = await enqueue(f.ORG_A, "test.record", 1, { dedupeKey: "k1" });
    const a2 = await enqueue(f.ORG_A, "test.record", 2, { dedupeKey: "k1" });
    const b1 = await enqueue(f.ORG_B, "test.record", 3, { dedupeKey: "k1" });
    expect([a1.created, a2.created, b1.created]).toEqual([true, false, true]);
  });

  it("a registered kind validates its payload; ids only (a stray key is refused)", async () => {
    await expect(withTenant({ orgId: f.ORG_A }, (tx) => enqueueJob(tx, { orgId: f.ORG_A }, "ops.prune_jobs", { note: "x" } as never))).rejects.toThrow();
    await expect(withTenant({ orgId: f.ORG_A }, (tx) => enqueueJob(tx, { orgId: f.ORG_A }, "ops.prune_jobs", {}))).resolves.toMatchObject({ created: true });
  });
});

describe("RLS of ops.job", () => {
  it("a tenant sees and writes only its own jobs; no tenant sees nothing; app_rw cannot claim around the function", async () => {
    const a = await enqueue(f.ORG_A, "test.record", 1);
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        expect((await c.query("select id from ops.job")).rowCount).toBe(0);
        await c.query(ORG_CTX, [f.ORG_B]);
        expect((await c.query("select id from ops.job where id = $1", [a.id])).rowCount).toBe(0);
        expect((await c.query("update ops.job set status = 'done', finished_at = now() where id = $1", [a.id])).rowCount).toBe(0);
        await expect(
          c.query(`insert into ops.job (id, organization_id, kind) values (app.uuid_generate_v7(), $1, 'test.record')`, [f.ORG_A]),
        ).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
      });
    });
    // The claim function is the one cross-organization door: it leases A's job from a connection bound to nobody.
    const claimed = await claimJobs("w-rls", [{ kind: "test.record", limit: 5, leaseSeconds: 60 }]);
    expect(claimed.map((c) => c.id)).toEqual([a.id]);
    expect(claimed[0]).toMatchObject({ orgId: f.ORG_A, attempt: 1 });
  });

  it("app.claim_jobs is EXECUTE-able by app_rw only and returns no payload column", async () => {
    await asAppRw(async (c) => {
      const res = await c.query<{ public: boolean; rw: boolean; cols: string }>(
        `select has_function_privilege('public', 'app.claim_jobs(text, text[], integer[], integer[])', 'EXECUTE') as public,
                has_function_privilege('app_rw', 'app.claim_jobs(text, text[], integer[], integer[])', 'EXECUTE') as rw,
                (select string_agg(a, ',') from unnest((select proargnames from pg_proc where proname = 'claim_jobs')) a) as cols`,
      );
      expect(res.rows[0].public).toBe(false);
      expect(res.rows[0].rw).toBe(true);
      expect(res.rows[0].cols).not.toContain("payload");
    });
  });
});

describe("claiming", () => {
  it("two workers claiming at the same time never get the same job (FOR UPDATE SKIP LOCKED)", async () => {
    for (let n = 0; n < 12; n++) await enqueue(n % 2 ? f.ORG_A : f.ORG_B, "test.record", n);
    // Two raw connections, the first holding its claim open: the second skips the locked rows instead of waiting.
    await asAppRw(async (c1) => {
      await asAppRw(async (c2) => {
        await c1.query("BEGIN");
        const first = await c1.query<{ job_id: string }>("select job_id from app.claim_jobs('w1', '{test.record}', '{5}', '{60}')");
        const second = await c2.query<{ job_id: string }>("select job_id from app.claim_jobs('w2', '{test.record}', '{50}', '{60}')");
        await c1.query("COMMIT");
        const a = first.rows.map((r) => r.job_id);
        const b = second.rows.map((r) => r.job_id);
        expect(a).toHaveLength(5);
        expect(b).toHaveLength(7);
        expect(a.filter((id) => b.includes(id))).toEqual([]);
      });
    });
  });

  it("two worker loops running the same jobs concurrently execute each exactly once", async () => {
    for (let n = 0; n < 10; n++) await enqueue(f.ORG_A, "test.record", n);
    const reg1 = registry({ "test.record": record("w1", 20) });
    const reg2 = registry({ "test.record": record("w2", 20) });
    const loop = async (worker: string, reg: JobRegistry) => {
      for (;;) {
        const claimed = await claimJobs(worker, claimWants(reg.kinds, new Map(), 2));
        if (claimed.length === 0) return;
        await Promise.all(claimed.map((c) => runJob(c, reg, worker)));
      }
    };
    await Promise.all([loop("w1", reg1), loop("w2", reg2)]);
    expect(ran.map((r) => r.n).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(ran.map((r) => r.jobId)).size).toBe(10);
  });

  it("an expired lease is re-claimed by another worker; the old holder can no longer commit (fenced)", async () => {
    const { id } = await enqueue(f.ORG_A, "test.record", 7);
    const [mine] = await claimJobs("w-old", [{ kind: "test.record", limit: 1, leaseSeconds: 60 }]);
    expect(mine.id).toBe(id);
    // Not expired yet: nobody else gets it.
    expect(await claimJobs("w-new", [{ kind: "test.record", limit: 1, leaseSeconds: 60 }])).toEqual([]);
    await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute(sql`update ops.job set locked_until = now() - interval '1 second' where id = ${id}`));
    const [theirs] = await claimJobs("w-new", [{ kind: "test.record", limit: 1, leaseSeconds: 60 }]);
    expect(theirs).toMatchObject({ id, attempt: 2 });
    const reg = registry({ "test.record": record("any") });
    expect((await runJob(mine, reg, "w-old")).outcome).toBe("lost");
    expect(ran).toHaveLength(0);
    expect((await runJob(theirs, reg, "w-new")).outcome).toBe("done");
    expect(await jobRow(f.ORG_A, id!)).toMatchObject({ status: "done", attempts: 2, locked_by: null });
  });

  it("a running job holds its row: past its lease, another claim skips it instead of running it twice", async () => {
    const { id } = await enqueue(f.ORG_A, "test.slow", 1);
    const [c] = await claimJobs("w-slow", [{ kind: "test.slow", limit: 1, leaseSeconds: 5 }]); // 5 s = the shortest lease
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    const reg = registry({
      "test.slow": async () => {
        runs++;
        await gate;
      },
    });
    const run = runJob(c, reg, "w-slow");
    await new Promise((r) => setTimeout(r, 5_500)); // the lease has expired; the run still holds the row
    expect(await claimJobs("w-thief", [{ kind: "test.slow", limit: 1, leaseSeconds: 60 }])).toEqual([]);
    release();
    expect((await run).outcome).toBe("done");
    expect(runs).toBe(1);
    expect((await jobRow(f.ORG_A, id!)).status).toBe("done");
  });
});

describe("failures", () => {
  it("a failing job is retried with backoff, then dead-lettered after max_attempts with a scrubbed last_error", async () => {
    const kinds = { "test.fail": def({ maxAttempts: 2 }) };
    const reg: JobRegistry = {
      kinds,
      handlers: {
        "test.fail": async () => {
          throw new Error("boom for ali@example.com 09121234567");
        },
      },
    };
    const { id } = await enqueue(f.ORG_A, "test.fail", 1, {}, kinds["test.fail"]);
    const [c1] = await claimJobs("w", [{ kind: "test.fail", limit: 1, leaseSeconds: 60 }]);
    const r1 = await runJob(c1, reg, "w", { random: () => 0.5 });
    expect(r1.outcome).toBe("retry");
    const after1 = await jobRow(f.ORG_A, id!);
    expect(after1).toMatchObject({ status: "failed", attempts: 1, locked_by: null, finished_at: null });
    expect(after1.last_error).toBe("Error: boom for … …");
    expect(new Date(after1.run_at).getTime()).toBeGreaterThan(Date.now() + 20_000); // ~30 s backoff
    // Not due yet:
    expect(await claimJobs("w", [{ kind: "test.fail", limit: 1, leaseSeconds: 60 }])).toEqual([]);
    await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute(sql`update ops.job set run_at = now() where id = ${id}`));
    const [c2] = await claimJobs("w", [{ kind: "test.fail", limit: 1, leaseSeconds: 60 }]);
    expect(c2.attempt).toBe(2);
    expect((await runJob(c2, reg, "w")).outcome).toBe("dead");
    const after2 = await jobRow(f.ORG_A, id!);
    expect(after2.status).toBe("dead");
    expect(after2.finished_at).not.toBeNull();
    expect(await claimJobs("w", [{ kind: "test.fail", limit: 1, leaseSeconds: 60 }])).toEqual([]);
  });

  it("a PermanentJobError (or a payload that no longer validates) is dead on the first attempt", async () => {
    const reg = registry({
      "test.perm": async () => {
        throw new PermanentJobError("cannot ever work");
      },
    });
    const { id } = await enqueue(f.ORG_A, "test.perm", 1);
    const [c] = await claimJobs("w", [{ kind: "test.perm", limit: 1, leaseSeconds: 60 }]);
    expect((await runJob(c, reg, "w")).outcome).toBe("dead");
    expect((await jobRow(f.ORG_A, id!)).status).toBe("dead");

    const strictReg = registry({ "test.strict": record("w") }, { "test.strict": def({ payload: z.object({ m: z.number() }).strict() }) });
    const bad = await enqueue(f.ORG_A, "test.strict", 1); // inserted with the lenient test schema
    const [c2] = await claimJobs("w", [{ kind: "test.strict", limit: 1, leaseSeconds: 60 }]);
    expect((await runJob(c2, strictReg, "w")).outcome).toBe("dead");
    expect((await jobRow(f.ORG_A, bad.id!)).last_error).toContain("PermanentJobError");
  });

  it("a lease that expired on the last attempt is dead-lettered by the next claim", async () => {
    const { id } = await enqueue(f.ORG_A, "test.record", 1, { maxAttempts: 1 });
    await claimJobs("w-dies", [{ kind: "test.record", limit: 1, leaseSeconds: 60 }]);
    await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute(sql`update ops.job set locked_until = now() - interval '1 second' where id = ${id}`));
    expect(await claimJobs("w2", [{ kind: "test.record", limit: 1, leaseSeconds: 60 }])).toEqual([]);
    const row = await jobRow(f.ORG_A, id!);
    expect(row.status).toBe("dead");
    expect(row.last_error).toContain("lease expired");
  });

  it("the handler's writes commit with `done` — or roll back with the failure; audit rows name the system actor and the job", async () => {
    const kinds = { "test.audit": def({ maxAttempts: 1 }), "test.audit_fail": def({ maxAttempts: 1 }) };
    const write: JobHandler<{ n: number }> = async (tx, ctx) => {
      await audit(ctx, "test.job.ran", { schema: "ops", table: "job", id: ctx.jobId }, null, { attempt: ctx.attempt }, tx);
    };
    const reg: JobRegistry = {
      kinds,
      handlers: {
        "test.audit": write,
        "test.audit_fail": async (tx, ctx, p, s) => {
          await write(tx, ctx, p, s);
          throw new Error("after the write");
        },
      },
    };
    const ok = await enqueue(f.ORG_A, "test.audit", 1, {}, kinds["test.audit"]);
    const bad = await enqueue(f.ORG_A, "test.audit_fail", 1, {}, kinds["test.audit_fail"]);
    const claimed: ClaimedJob[] = await claimJobs("w", [
      { kind: "test.audit", limit: 1, leaseSeconds: 60 },
      { kind: "test.audit_fail", limit: 1, leaseSeconds: 60 },
    ]);
    for (const c of claimed) await runJob(c, reg, "w");
    const rows = await withTenant({ orgId: f.ORG_A }, (tx) =>
      tx.execute<{ entity_id: string; actor_person_id: string | null; actor_user_id: string | null; request_id: string; user_agent: string }>(
        sql`select entity_id, actor_person_id, actor_user_id, request_id, user_agent from audit.audit_log where action = 'test.job.ran'`,
      ),
    );
    expect(rows.rows).toEqual([{ entity_id: ok.id, actor_person_id: null, actor_user_id: null, request_id: `job:${ok.id}`, user_agent: "system:worker" }]);
    expect((await jobRow(f.ORG_A, ok.id!)).status).toBe("done");
    expect((await jobRow(f.ORG_A, bad.id!)).status).toBe("dead");
  });
});

describe("scheduler", () => {
  const SCHED = [{ name: "test.every_minute", cron: "* * * * *", kind: "test.record" }];
  const kinds = { "test.record": def({ payload: z.object({}).strict() }) };

  it("a due tick fires ONCE with two workers ticking at the same time — one job per organization, dedupe on the tick", async () => {
    await syncSchedules(SCHED, kinds);
    const tick = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 60_000);
    await withoutTenant((tx) => tx.execute(sql`update ops.schedule set next_fire_at = ${tick.toISOString()}::timestamptz where name = 'test.every_minute'`));
    const [w1, w2] = await Promise.all([tickSchedules(SCHED, kinds), tickSchedules(SCHED, kinds)]);
    const fired = [...w1, ...w2];
    const orgs = (await allOrgs()).length;
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ name: "test.every_minute", tick: tick.toISOString(), enqueued: orgs });
    // Nothing is due any more: next_fire_at moved past now.
    expect(await tickSchedules(SCHED, kinds)).toEqual([]);
    const next = await withoutTenant((tx) => tx.execute<{ next_fire_at: Date; last_fired_at: Date }>(sql`select next_fire_at, last_fired_at from ops.schedule where name = 'test.every_minute'`));
    expect(new Date(next.rows[0].next_fire_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(next.rows[0].last_fired_at).toISOString()).toBe(tick.toISOString());
    // A crash before the row moved on (simulated: the same tick due again) re-fires it — and enqueues nothing new.
    await withoutTenant((tx) => tx.execute(sql`update ops.schedule set next_fire_at = ${tick.toISOString()}::timestamptz where name = 'test.every_minute'`));
    const again = await tickSchedules(SCHED, kinds);
    expect(again[0]).toMatchObject({ tick: tick.toISOString(), enqueued: 0 });
    const jobs = await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute<{ dedupe_key: string }>(sql`select dedupe_key from ops.job where kind = 'test.record'`));
    expect(jobs.rows).toEqual([{ dedupe_key: `schedule:test.every_minute:${tick.toISOString()}` }]);
  });

  it("a changed cron restarts the schedule's clock; an unchanged one keeps it", async () => {
    await syncSchedules(SCHED, kinds);
    const read = async () =>
      (await withoutTenant((tx) => tx.execute<{ cron: string; next_fire_at: Date }>(sql`select cron, next_fire_at from ops.schedule where name = 'test.every_minute'`))).rows[0];
    const far = new Date(Date.now() + 86_400_000);
    await withoutTenant((tx) => tx.execute(sql`update ops.schedule set next_fire_at = ${far.toISOString()}::timestamptz where name = 'test.every_minute'`));
    await syncSchedules(SCHED, kinds);
    expect(new Date((await read()).next_fire_at).toISOString()).toBe(far.toISOString());
    await syncSchedules([{ ...SCHED[0], cron: "*/5 * * * *" }], kinds);
    const changed = await read();
    expect(changed.cron).toBe("*/5 * * * *");
    expect(new Date(changed.next_fire_at).getTime()).toBeLessThan(far.getTime());
  });

  it("refuses a schedule with a bad cron or an unknown kind", async () => {
    await expect(syncSchedules([{ name: "test.bad", cron: "61 * * * *", kind: "test.record" }], kinds)).rejects.toThrow(/minute/);
    await expect(syncSchedules([{ name: "test.bad", cron: "* * * * *", kind: "test.nope" }], kinds)).rejects.toThrow(/unknown job kind/);
  });
});

describe("the worker loop", () => {
  it("runs what is queued, wakes when a run finishes, and on abort waits for the run in flight before returning", async () => {
    for (let n = 0; n < 3; n++) await enqueue(f.ORG_A, "test.record", n);
    const reg = registry({ "test.record": record("loop", 150) }, { "test.record": def({ concurrency: 1 }) });
    const ac = new AbortController();
    const loop = runWorker({
      workerId: "w-loop",
      pollMs: 200,
      tickEveryMs: 60_000,
      maxConcurrency: 1,
      shutdownGraceMs: 5_000,
      aliveFile: path.join(os.tmpdir(), "edu-worker-alive-test"),
      registry: reg,
      schedules: [],
      signal: ac.signal,
    });
    for (let i = 0; i < 50 && ran.length < 3; i++) await new Promise((r) => setTimeout(r, 100));
    expect(ran.map((r) => r.n).sort()).toEqual([0, 1, 2]);
    // One more, then stop while it runs: the loop returns only after it is done.
    await enqueue(f.ORG_A, "test.record", 9);
    for (let i = 0; i < 30 && !(await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from ops.job where status = 'running'`))).rows[0].n; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    ac.abort();
    await loop;
    expect(ran.map((r) => r.n)).toContain(9);
    const left = await withTenant({ orgId: f.ORG_A }, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from ops.job where status <> 'done'`));
    expect(left.rows[0].n).toBe(0);
  });
});

describe("the real handlers", () => {
  it("ops.prune_jobs deletes old finished jobs of its organization only", async () => {
    const old = await enqueue(f.ORG_A, "test.record", 1);
    const recent = await enqueue(f.ORG_A, "test.record", 2);
    const otherOrg = await enqueue(f.ORG_B, "test.record", 3);
    for (const [orgId, id, age] of [
      [f.ORG_A, old.id, "20 days"],
      [f.ORG_A, recent.id, "1 day"],
      [f.ORG_B, otherOrg.id, "20 days"],
    ] as const) {
      await withTenant({ orgId }, (tx) => tx.execute(sql`update ops.job set status = 'done', finished_at = now() - ${age}::interval where id = ${id}`));
    }
    await withTenant({ orgId: f.ORG_A }, (tx) => enqueueJob(tx, { orgId: f.ORG_A }, "ops.prune_jobs", {}));
    const claimed = await claimJobs("w", claimWants(REGISTRY.kinds, new Map(), 4));
    expect(claimed.map((c) => c.kind)).toEqual(["ops.prune_jobs"]);
    expect((await runJob(claimed[0], REGISTRY, "w")).outcome).toBe("done");
    expect(await jobRow(f.ORG_A, old.id!)).toBeUndefined();
    expect((await jobRow(f.ORG_A, recent.id!)).status).toBe("done");
    expect((await jobRow(f.ORG_B, otherOrg.id!)).status).toBe("done");
  });

  it("files.expire_uploads and files.sweep_orphans run to done with nothing to do", async () => {
    await withTenant({ orgId: f.ORG_B }, async (tx) => {
      await enqueueJob(tx, { orgId: f.ORG_B }, "files.expire_uploads", {});
      await enqueueJob(tx, { orgId: f.ORG_B }, "files.sweep_orphans", {});
    });
    const claimed = await claimJobs("w", claimWants(REGISTRY.kinds, new Map(), 4));
    expect(claimed.map((c) => c.kind).sort()).toEqual(["files.expire_uploads", "files.sweep_orphans"]);
    for (const c of claimed) expect((await runJob(c, REGISTRY, "w")).outcome).toBe("done");
  });

  it("kind names outside module.verb_noun are refused by the table (CHECK)", async () => {
    await expect(withTenant({ orgId: f.ORG_A }, (tx) => insertJob(tx, f.ORG_A, "NoDot", def(), { n: 1 }))).rejects.toSatisfy((e: unknown) => pgCode(e) === PG.CHECK_VIOLATION);
  });
});
