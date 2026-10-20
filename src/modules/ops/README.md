# ops

Background jobs and recurring schedules — the Postgres-only job runner (owner 2026-10-20, docs/decisions.md
«صف، زمان‌بند و Feature Flag»). No Redis, no BullMQ: `ops.job` is a table, claimed with `FOR UPDATE SKIP LOCKED`.

- `kinds.ts` — the registry of job kinds (payload schema: ids and numbers only; attempts; per-process concurrency; timeout).
- `enqueue.ts` — `enqueueJob(tx, ctx, kind, payload, { runAt, dedupeKey })` inside the business transaction (outbox).
- `schedules.ts` — recurring schedules registered in code (cron, Asia/Tehran), fanned out per organization.
- `cron.ts`, `retry.ts` — pure: cron parsing / next fire, exponential backoff, the scrubbed `last_error`.
- `system-ctx.ts` — the `SystemCtx` type: the actor of a job run («سامانه»), what its audit rows carry.

The runtime — claim, run, retry, dead-letter, the scheduler tick and the worker loop — is `src/lib/jobs` (it opens its
own transactions, so it lives beside `src/lib/actions` and nothing in `src/app` / `src/modules` may import it).
Entry point: `scripts/worker.ts` (`pnpm worker`; in the image `node scripts/worker.mjs`, the `worker` compose
service). Operations: docs/ops/runbook.md «کارهای پس‌زمینه».
