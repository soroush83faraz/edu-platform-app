// ops/kinds — the registry of background job kinds: what a payload of each kind looks like and how it runs. Pure (zod
// only), so request code can import it to enqueue (./enqueue.ts) and the worker to run (src/lib/jobs/handlers.ts maps
// every kind to its handler — a `Record<JobKind, …>`, so a kind without a handler does not compile).
//
// Rules for a kind (checked by `kindProblems`, which the worker runs at start and tests/unit/ops-kinds.test.ts runs
// on every kind):
//   • the name is `module.verb_noun` (the CHECK `job_kind_chk` of ops.job);
//   • the payload is a `.strict()` object of ids and numbers only — uuid / iso-datetime strings, numbers, booleans,
//     enums, literals and arrays of those. NEVER free text: a payload is stored in the database and shown to
//     operators, so no name, message or phone ever goes in it — the handler reads those from their rows;
//   • `timeoutMs` bounds one run (the runner aborts it and the statement_timeout of its transaction stops the
//     database); the lease is `timeoutMs` + 30 s, so a live run never loses its lease (no heartbeat needed — a job that
//     needs longer splits itself into follow-up jobs);
//   • handlers are idempotent: delivery is at least once (a worker that dies mid-run leaves the job to be re-claimed
//     when its lease expires; its transaction rolled back with the connection).
import { z } from "zod";

export interface JobKindDef<P extends z.ZodType = z.ZodType> {
  /** One line for operators (logs, runbook). */
  description: string;
  payload: P;
  /** Attempts before the job is dead-lettered (1 … 25). */
  maxAttempts: number;
  /** Runs of this kind at once in ONE worker process. */
  concurrency: number;
  /** Upper bound of one run, ms. */
  timeoutMs: number;
}

const Empty = z.object({}).strict();
/** One deadline of one work item (the deadline is part of the job: a moved deadline is a new one). */
const DeadlineOf = z.object({ workItemId: z.uuid(), dueAt: z.iso.datetime() }).strict();

export const JOB_KINDS = {
  /** Bytes under FILES_DIR no live row names, older than a day — one organization (files/sweep; security review D6). */
  "files.sweep_orphans": {
    description: "files: delete orphan upload bytes of one organization (bounded, braked)",
    payload: Empty,
    maxAttempts: 3,
    concurrency: 1,
    timeoutMs: 5 * 60_000,
  },
  /** Uploads left `pending` for more than 24 h → archived (app.expire_stale_uploads), their bytes deleted after the commit. */
  "files.expire_uploads": {
    description: "files: archive one organization's uploads left pending for 24 h and delete their bytes",
    payload: Empty,
    maxAttempts: 3,
    concurrency: 1,
    timeoutMs: 2 * 60_000,
  },
  /** The queue's own housekeeping: done jobs after 14 days, dead ones after 90. */
  "ops.prune_jobs": {
    description: "ops: delete one organization's finished jobs (done > 14 days, dead > 90 days)",
    payload: Empty,
    maxAttempts: 3,
    concurrency: 1,
    timeoutMs: 2 * 60_000,
  },
  /** «یادآوری مهلت تکالیف»: one organization's open items near or past their deadline → the two jobs below (workspace/deadline-reminders). */
  "workspace.scan_deadlines": {
    description: "workspace: enqueue the deadline reminders and overdue notices of one organization's open items",
    payload: Empty,
    maxAttempts: 3,
    concurrency: 1,
    timeoutMs: 2 * 60_000,
  },
  /** The assignees who have not finished one item hear that its deadline is near (once per deadline). */
  "workspace.remind_deadline": {
    description: "workspace: remind the unfinished assignees of one work item of its deadline",
    payload: DeadlineOf,
    maxAttempts: 5,
    concurrency: 4,
    timeoutMs: 30_000,
  },
  /** The giver of one item hears how many have not finished it once its deadline has passed (once per deadline). */
  "workspace.notify_overdue": {
    description: "workspace: tell the giver of one work item how many assignees missed its deadline",
    payload: DeadlineOf,
    maxAttempts: 5,
    concurrency: 4,
    timeoutMs: 30_000,
  },
  /** «مرکز درخواست‌ها»: one organization's open requests — the 80 % reminder, the escalation at the deadline (workspace/requests). */
  "workspace.check_request_slas": {
    description: "workspace: remind and escalate one organization's open requests by their response time",
    payload: Empty,
    maxAttempts: 3,
    concurrency: 1,
    timeoutMs: 2 * 60_000,
  },
} as const satisfies Record<string, JobKindDef>;

export type JobKind = keyof typeof JOB_KINDS;
export type JobPayload<K extends JobKind> = z.output<(typeof JOB_KINDS)[K]["payload"]>;

export const JOB_KIND_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** ops.job.payload's CHECK, in bytes of its JSON text. */
export const PAYLOAD_MAX_BYTES = 2048;

export function isJobKind(kind: string): kind is JobKind {
  return Object.prototype.hasOwnProperty.call(JOB_KINDS, kind);
}

interface ZodInternals {
  _zod: { def: { type: string; format?: string; innerType?: unknown; element?: unknown; shape?: Record<string, unknown>; catchall?: unknown } };
}

/** May a payload field of this schema type carry only ids, numbers and flags? */
function safeField(schema: unknown): boolean {
  const def = (schema as ZodInternals)._zod?.def;
  if (!def) return false;
  switch (def.type) {
    case "number":
    case "int":
    case "boolean":
    case "enum":
    case "literal":
      return true;
    case "string":
      return def.format === "uuid" || def.format === "datetime" || def.format === "date";
    case "optional":
    case "nullable":
    case "default":
      return safeField(def.innerType);
    case "array":
      return safeField(def.element);
    default:
      return false;
  }
}

/** What is wrong with a kind definition (empty = fine). */
export function kindProblems(name: string, def: JobKindDef): string[] {
  const problems: string[] = [];
  if (!JOB_KIND_RE.test(name) || name.length > 80) problems.push(`${name}: the name must be module.verb_noun`);
  const p = (def.payload as unknown as ZodInternals)._zod?.def;
  if (p?.type !== "object") problems.push(`${name}: the payload must be a z.object`);
  else {
    const catchall = (p.catchall as ZodInternals | undefined)?._zod.def.type;
    if (catchall !== "never") problems.push(`${name}: the payload object must be .strict()`);
    for (const [field, schema] of Object.entries(p.shape ?? {})) {
      if (!safeField(schema)) problems.push(`${name}: payload field "${field}" must be an id, a number, a flag or an enum — never text`);
    }
  }
  if (!(Number.isInteger(def.maxAttempts) && def.maxAttempts >= 1 && def.maxAttempts <= 25)) problems.push(`${name}: maxAttempts must be 1 … 25`);
  if (!(Number.isInteger(def.concurrency) && def.concurrency >= 1 && def.concurrency <= 16)) problems.push(`${name}: concurrency must be 1 … 16`);
  if (!(Number.isInteger(def.timeoutMs) && def.timeoutMs >= 1_000 && def.timeoutMs <= 30 * 60_000)) problems.push(`${name}: timeoutMs must be 1 s … 30 min`);
  return problems;
}

/** Lease of a run: its timeout plus a margin for the commit (seconds, as app.claim_jobs takes it). */
export function leaseSecondsFor(def: Pick<JobKindDef, "timeoutMs">): number {
  return Math.ceil(def.timeoutMs / 1000) + 30;
}
