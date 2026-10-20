// Public surface of the ops module (background jobs). Request code enqueues; only src/lib/jobs runs.
export { enqueueJob, type EnqueueOptions, type Enqueued } from "./enqueue";
export { JOB_KINDS, type JobKind, type JobPayload } from "./kinds";
export type { SystemCtx } from "./system-ctx";
