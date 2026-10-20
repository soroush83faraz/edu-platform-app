// files/expire — uploads of the transaction's organization left `pending` (never attached by the form they were made
// for) for longer than `pendingTtlMs` (24 h — the same interval is written in the SQL function): archived, at most
// `limit` (≤ 50) per call, rows nobody holds (SKIP LOCKED — an attach in flight wins). One audit row with their ids.
// Returns their storage keys; the caller deletes the bytes AFTER the commit (files/storage `removeStored`).
//
// Callers: every upload (workspace/file-access `recordUpload`, as the uploader) and the worker's hourly
// `files.expire_uploads` job (src/lib/jobs/handlers.ts, as «سامانه» — so a school that stops uploading still gets its
// stale uploads expired). Through `app.expire_stale_uploads` (migration 0025, SECURITY DEFINER, the current
// organization only): since 0025's RESTRICTIVE policies app_rw sees no one else's pending upload.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { type AuditCtx, audit } from "@/lib/audit";

export async function expireStaleUploads(tx: Tx, ctx: AuditCtx, limit = 50): Promise<string[]> {
  const res = await tx.execute<{ file_id: string; file_storage_key: string }>(sql`select file_id, file_storage_key from app.expire_stale_uploads(${limit}::int)`);
  const stale = res.rows.map((r) => ({ id: r.file_id, storageKey: r.file_storage_key }));
  if (stale.length === 0) return [];
  await audit(ctx, "files.file_object.expired", { schema: "files", table: "file_object", id: null }, null, { ids: stale.map((s) => s.id) }, tx);
  return stale.map((s) => s.storageKey);
}
