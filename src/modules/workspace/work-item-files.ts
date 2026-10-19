// workspace/work-item-files — the files ON a تکلیف (owner 2026-10-19, «پیوست تکلیف و تحویل پاسخ»; docs/decisions.md;
// migration 0024): the giver's «فایل‌های تکلیف» (`work_item_attachment.submission_id` NULL) and the files of a student's
// «پاسخ» (./submissions). Two steps, never one: the bytes are uploaded first, each to its own `pending` file row bound to
// its uploader, purpose and target (`src/app/api/files/route.ts`, ./file-access); the WRITE that uses them —
// `createWorkItem`, `updateWorkItem`, `saveSubmission` — then takes exactly those rows, locked, and attaches them in its
// own transaction (`takePendingUploads` → `attachUploads`), or archives what it removes (`archiveAttachments`: the row
// and the file archived, the bytes deleted from disk AFTER the commit by the action, src/modules/workspace/actions.ts).
//
// No import of ./service (it imports this file). Audit rows carry ids, sizes and types only — never a file name.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { forbidden, invalidReference, validation } from "@/lib/errors";
import { canAtAnyScope, type CanContext } from "@/modules/iam/can";
import { fileObject } from "@/modules/files/schema";
import { kindOfMime, type FileKind } from "@/modules/files/kinds";
import { FILE_MESSAGES, itemSetProblem, type UploadPurpose } from "@/modules/files/limits";
import { workItemAttachment } from "./schema";

export type FilesCtx = AuditCtx & CanContext & { personId: string };

/** A file as a row shows it (the download link is `/files/<id>`). */
export interface FileView {
  id: string;
  name: string;
  sizeBytes: number;
  kind: FileKind;
  addedAt: Date;
}

/** What an audit row records of a file: never its name or content. */
export interface FileFact {
  id: string;
  sizeBytes: number;
  mime: string;
}

/** Which items take files at all: a `task` (a تکلیف / تسک given to someone) that is not confidential. */
export function itemTakesFiles(item: { typeCode: string; isConfidential: boolean }): boolean {
  return item.typeCode === "task" && !item.isConfidential;
}

/** Open = not archived and still to do / in progress (closed «انجام‌شده» and removed «حذف‌شده» take no change). */
export function itemIsOpen(item: { statusCategory: string; archivedAt: Date | null }): boolean {
  return item.archivedAt === null && (item.statusCategory === "todo" || item.statusCategory === "doing");
}

const FILE_ROW = {
  id: fileObject.id,
  name: fileObject.originalName,
  sizeBytes: fileObject.sizeBytes,
  mime: fileObject.mime,
  addedAt: workItemAttachment.createdAt,
  submissionId: workItemAttachment.submissionId,
};

function toView(r: { id: string; name: string | null; sizeBytes: number; mime: string; addedAt: Date }): FileView | null {
  const kind = kindOfMime(r.mime);
  return kind ? { id: r.id, name: r.name ?? "فایل", sizeBytes: r.sizeBytes, kind, addedAt: r.addedAt } : null;
}

const liveOn = (workItemId: string) =>
  and(eq(workItemAttachment.workItemId, workItemId), isNull(workItemAttachment.archivedAt), eq(fileObject.status, "attached"));

const joinFile = and(eq(fileObject.organizationId, workItemAttachment.organizationId), eq(fileObject.id, workItemAttachment.fileId));

/** The live giver's files of an item, in order. */
export async function listItemFiles(tx: Tx, workItemId: string): Promise<FileView[]> {
  const rows = await tx
    .select(FILE_ROW)
    .from(workItemAttachment)
    .innerJoin(fileObject, joinFile)
    .where(and(liveOn(workItemId), isNull(workItemAttachment.submissionId)))
    .orderBy(asc(workItemAttachment.sequence), asc(workItemAttachment.createdAt));
  return rows.flatMap((r) => toView(r) ?? []);
}

/**
 * The live files of the پاسخ‌ها of an item, per submission. Read under 0024's RESTRICTIVE policy: a پاسخ's rows come
 * back only where the پاسخ itself is readable (its student, the item's managers) — the caller's own rule holds anyway.
 */
export async function listSubmissionFiles(tx: Tx, workItemId: string): Promise<Map<string, FileView[]>> {
  const rows = await tx
    .select(FILE_ROW)
    .from(workItemAttachment)
    .innerJoin(fileObject, joinFile)
    .where(and(liveOn(workItemId), sql`${workItemAttachment.submissionId} is not null`))
    .orderBy(asc(workItemAttachment.sequence), asc(workItemAttachment.createdAt));
  const out = new Map<string, FileView[]>();
  for (const r of rows) {
    const v = toView(r);
    if (!v || !r.submissionId) continue;
    out.set(r.submissionId, [...(out.get(r.submissionId) ?? []), v]);
  }
  return out;
}

export interface LiveAttachment {
  attachmentId: string;
  fileId: string;
  sequence: number;
  sizeBytes: number;
  mime: string;
  storageKey: string;
}

/** The live attachments of the giver's set (`submissionId` null) or of one پاسخ, locked — the caller holds the item. */
export async function lockLiveAttachments(tx: Tx, workItemId: string, submissionId: string | null): Promise<LiveAttachment[]> {
  return tx
    .select({
      attachmentId: workItemAttachment.id,
      fileId: workItemAttachment.fileId,
      sequence: workItemAttachment.sequence,
      sizeBytes: fileObject.sizeBytes,
      mime: fileObject.mime,
      storageKey: fileObject.storageKey,
    })
    .from(workItemAttachment)
    .innerJoin(fileObject, joinFile)
    .where(and(liveOn(workItemId), submissionId ? eq(workItemAttachment.submissionId, submissionId) : isNull(workItemAttachment.submissionId)))
    .orderBy(asc(workItemAttachment.id))
    .for("update");
}

export interface PendingUpload {
  id: string;
  sizeBytes: number;
  mime: string;
  storageKey: string;
}

/**
 * The caller's OWN pending uploads made for this purpose and target (`null` = a تکلیف not created yet), locked FOR
 * UPDATE, in the order asked; INVALID_REFERENCE unless every id is one — someone else's file, an attached or expired
 * one, one uploaded for another تکلیف or for the other purpose all answer the same.
 */
export async function takePendingUploads(tx: Tx, ctx: FilesCtx, fileIds: readonly string[], purpose: UploadPurpose, target: string | null): Promise<PendingUpload[]> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: fileObject.id, sizeBytes: fileObject.sizeBytes, mime: fileObject.mime, storageKey: fileObject.storageKey })
    .from(fileObject)
    .where(
      and(
        inArray(fileObject.id, ids),
        eq(fileObject.uploadedByPersonId, ctx.personId),
        eq(fileObject.status, "pending"),
        eq(fileObject.purpose, purpose),
        target === null ? isNull(fileObject.targetWorkItemId) : eq(fileObject.targetWorkItemId, target),
      ),
    )
    .orderBy(asc(fileObject.id))
    .for("update");
  if (rows.length !== ids.length) throw invalidReference(FILE_MESSAGES.expired);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
}

/** The attachment rows (in order from `firstSequence`) and the files flipped to `attached`. */
export async function attachUploads(tx: Tx, ctx: FilesCtx, workItemId: string, submissionId: string | null, uploads: readonly PendingUpload[], firstSequence: number): Promise<void> {
  if (uploads.length === 0) return;
  await tx.insert(workItemAttachment).values(
    uploads.map((u, i) => ({ organizationId: ctx.orgId, workItemId, fileId: u.id, addedByPersonId: ctx.personId, sequence: firstSequence + i, submissionId })),
  );
  await tx
    .update(fileObject)
    .set({ status: "attached" })
    .where(inArray(fileObject.id, uploads.map((u) => u.id)));
}

/** Archives attachment rows and their files; returns the keys whose bytes the action deletes AFTER the commit. */
export async function archiveAttachments(tx: Tx, rows: readonly LiveAttachment[]): Promise<string[]> {
  if (rows.length === 0) return [];
  await tx
    .update(workItemAttachment)
    .set({ archivedAt: sql`now()` })
    .where(inArray(workItemAttachment.id, rows.map((r) => r.attachmentId)));
  await tx
    .update(fileObject)
    .set({ status: "archived", archivedAt: sql`now()` })
    .where(inArray(fileObject.id, rows.map((r) => r.fileId)));
  return rows.map((r) => r.storageKey);
}

export const fileFact = (f: { id?: string; fileId?: string; sizeBytes: number; mime: string }): FileFact => ({ id: (f.fileId ?? f.id)!, sizeBytes: f.sizeBytes, mime: f.mime });

/** File ids to attach and to remove (both by FILE id — what the client holds). */
export interface FilesChange {
  add: readonly string[];
  remove: readonly string[];
}

export interface FilesChangeResult {
  added: FileFact[];
  removed: FileFact[];
  /** Storage keys of the removed files — deleted from disk once the transaction has committed. */
  unlinkKeys: string[];
}

export function hasFilesChange(c: FilesChange | null | undefined): c is FilesChange {
  return !!c && (c.add.length > 0 || c.remove.length > 0);
}

/**
 * The giver's files of `item` change INSIDE the caller's write — `createWorkItem` (a new تکلیف: uploads made with no
 * target) and `updateWorkItem` («ویرایش»: uploads made for THIS تکلیف) — which already decided that the caller manages
 * the item and that it is open (and holds its lock on an edit). Needs `workspace.work_item.attach`; only a `task` that
 * is not confidential takes files; at most `maxItemFiles` live after the change. One audit row
 * `workspace.work_item.files_changed`: ids, sizes and types only.
 */
export async function applyItemFilesChange(
  tx: Tx,
  ctx: FilesCtx,
  item: { id: string; typeCode: string; isConfidential: boolean },
  change: FilesChange,
  opts: { isNew: boolean },
): Promise<FilesChangeResult> {
  if (!hasFilesChange(change)) return { added: [], removed: [], unlinkKeys: [] };
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.attach")) throw forbidden();
  if (!itemTakesFiles(item)) throw validation({ fieldErrors: { files: [FILE_MESSAGES.attachNotHere] } }, FILE_MESSAGES.attachNotHere);
  const live = opts.isNew ? [] : await lockLiveAttachments(tx, item.id, null);
  const removeIds = new Set(change.remove);
  const toRemove = live.filter((a) => removeIds.has(a.fileId));
  if (toRemove.length !== removeIds.size) throw invalidReference(FILE_MESSAGES.expired);
  const uploads = await takePendingUploads(tx, ctx, change.add, "work_item", opts.isNew ? null : item.id);
  const count = live.length - toRemove.length + uploads.length;
  const problem = itemSetProblem(count);
  if (problem) throw validation({ fieldErrors: { files: [problem] } }, problem);
  const unlinkKeys = await archiveAttachments(tx, toRemove);
  const next = live.reduce((m, a) => Math.max(m, a.sequence), -1) + 1;
  await attachUploads(tx, ctx, item.id, null, uploads, next);
  const added = uploads.map(fileFact);
  const removed = toRemove.map(fileFact);
  await audit(ctx, "workspace.work_item.files_changed", { schema: "workspace", table: "work_item", id: item.id }, { count: live.length }, { count, added, removed: removed.map((r) => r.id) }, tx);
  return { added, removed, unlinkKeys };
}
