// workspace/file-access — who may PUT bytes on the server for a تکلیف, and who may GET them back (owner 2026-10-19,
// «پیوست تکلیف و تحویل پاسخ»; docs/decisions.md). Called through defineAction / defineQuery by the two route handlers
// (`src/app/api/files/route.ts`, `src/app/files/[id]/route.ts`) and by the item page's read model.
//
// Upload — decided BEFORE a byte is written (`authorizeUpload`) and again, with the real size and kind, in the write that
// records it (`recordUpload`, the bytes still in a temp file until its last statement renames them into place):
//   • `work_item` — the giver's files: `workspace.work_item.attach` (+ `.create` for a تکلیف not created yet); for an
//     existing تکلیف the caller must see it and MANAGE it (`managesItem`), and it must be an open `task`;
//   • `submission` — a student's پاسخ: `assertMaySubmit` (./submissions) — an assignee of an open `task` they did not
//     give, holding `workspace.work_item.submit`;
//   • never from a «ورود آزمایشی» session (the pilot's open demo login must not become an anonymous file host);
//   • the daily quota per person (rolling 24 h, every upload counted), serialised per person by an advisory lock;
//   • a recorded upload is `pending`, bound to its uploader, purpose and target — only the write it was made for can
//     attach it (./work-item-files `takePendingUploads`); left unattached for 24 h it expires (`expireStaleUploads`).
// Download — `findDownload`, on EVERY request: the file must be live and attached; the caller must see its تکلیف
// (`canViewWorkItem` — assignees, the giver, the broad readers it allows); a پاسخ's file only its student or the
// item's managers (and 0024's RESTRICTIVE policy hides the row from anyone else). Every refusal is NOT_FOUND.
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { forbidden, notFound, rateLimited, validation } from "@/lib/errors";
import { canAtAnyScope } from "@/modules/iam/can";
import { DEMO_SESSION_LABEL } from "@/modules/iam/demo-login/repo";
import { userSession } from "@/modules/iam/schema";
import { fileObject } from "@/modules/files/schema";
import { KIND_INFO, kindOfMime, type FileKind } from "@/modules/files/kinds";
import { FILE_LIMITS, FILE_MESSAGES, UPLOAD_PURPOSES, fileSizeProblem, withinDailyQuota, type UploadPurpose } from "@/modules/files/limits";
import { nameForKind, sanitizeFileName } from "@/modules/files/names";
import { STORAGE_KEY_RE, storageKeyFor } from "@/modules/files/paths";
import { publishTemp } from "@/modules/files/storage";
import { managesItem } from "./manage-policy";
import { findMyAssigneeRow, type WorkItemCore } from "./repo";
import { workItemAttachment, workItemSubmission } from "./schema";
import { canViewWorkItem, type WorkItemDetail, type WorkspaceCtx } from "./service";
import { assertMaySubmit, readMySubmission, readSubmissionsOverview, type SubmissionView, type SubmissionsOverview } from "./submissions";
import { type FileView, itemIsOpen, itemTakesFiles, listItemFiles } from "./work-item-files";

/** The ctx of a request (src/lib/ctx `Ctx` satisfies it): the session id tells a demo session apart. */
export type FileAccessCtx = WorkspaceCtx & { sessionId?: string };

const uuid = z.uuid("گزینهٴ انتخاب‌شده نامعتبر است.");

/**
 * What the upload request says about itself — the query (`purpose`, `workItemId`) and the `X-File-Name` header
 * (percent-decoded). Nothing else of the client's is read; the size comes from the bytes, the type from the sniffer.
 */
export const UploadMeta = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    workItemId: uuid.optional(),
    name: z.string().min(1, FILE_MESSAGES.badName).max(1024, FILE_MESSAGES.badName),
  })
  .strict()
  .refine((m) => m.purpose !== "submission" || m.workItemId !== undefined, { message: FILE_MESSAGES.attachNotHere, path: ["workItemId"] });
export type UploadMeta = z.output<typeof UploadMeta>;

export const FileIdInput = z.object({ fileId: uuid }).strict();

/** Server-made facts of an upload in flight (never client input): the planned row id and key, the received bytes. */
export interface UploadPlan {
  fileId: string;
  storageKey: string;
}

export interface UploadTicket extends UploadPlan {
  purpose: UploadPurpose;
  workItemId: string | null;
  /** The sanitised display name (its extension is fixed to the sniffed kind on record). */
  name: string;
}

export interface ReceivedUpload {
  tempPath: string;
  sizeBytes: number;
  sha256: string;
  kind: FileKind;
}

export interface UploadedFile {
  id: string;
  name: string;
  sizeBytes: number;
  kind: FileKind;
}

/** Was this request's session minted by «ورود آزمایشی» (`iam.user_session.device_label`)? A global table, no RLS. */
export async function isDemoSession(tx: Tx, ctx: { sessionId?: string }): Promise<boolean> {
  if (!ctx.sessionId) return false;
  const [row] = await tx.select({ label: userSession.deviceLabel }).from(userSession).where(eq(userSession.id, ctx.sessionId)).limit(1);
  return row?.label === DEMO_SESSION_LABEL;
}

/** Bytes and files the person uploaded in the last 24 h (every upload counts, whatever became of it). */
async function usedToday(tx: Tx, personId: string): Promise<{ bytes: number; files: number }> {
  const [row] = await tx
    .select({ bytes: sql<number>`coalesce(sum(${fileObject.sizeBytes}), 0)::bigint`, files: sql<number>`count(*)::int` })
    .from(fileObject)
    .where(and(eq(fileObject.uploadedByPersonId, personId), gt(fileObject.createdAt, sql`now() - interval '24 hours'`)));
  return { bytes: Number(row?.bytes ?? 0), files: Number(row?.files ?? 0) };
}

/** The giver's side: may the caller add files to this تکلیف (or, with no id, to one they are creating)? */
async function assertMayAttach(tx: Tx, ctx: FileAccessCtx, workItemId: string | undefined): Promise<WorkItemCore | null> {
  if (workItemId === undefined) {
    if (!canAtAnyScope(ctx.assignments, "workspace.work_item.attach") || !canAtAnyScope(ctx.assignments, "workspace.work_item.create")) throw forbidden();
    return null;
  }
  const item = await canViewWorkItem(tx, ctx, workItemId);
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.attach")) throw forbidden();
  const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
  if (!managesItem(ctx, item, mine !== null)) throw forbidden();
  if (!itemTakesFiles(item)) throw validation(undefined, FILE_MESSAGES.attachNotHere);
  if (!itemIsOpen(item)) throw validation(undefined, "این تکلیف بسته شده است؛ برای تغییر فایل‌ها اول آن را بازیابی کنید.");
  return item;
}

/**
 * Everything decidable before the body is read: the session kind, the purpose's rule on the target, the name, the
 * daily quota (with the announced size when the client sent one). Returns the plan of the row-to-be.
 */
export async function authorizeUpload(tx: Tx, ctx: FileAccessCtx, meta: UploadMeta, announcedBytes?: number | null): Promise<UploadTicket> {
  if (await isDemoSession(tx, ctx)) throw forbidden("در ورود آزمایشی بارگذاری فایل ممکن نیست.");
  if (meta.purpose === "submission") await assertMaySubmit(tx, ctx, meta.workItemId!, { lock: false });
  else await assertMayAttach(tx, ctx, meta.workItemId);
  const name = sanitizeFileName(meta.name);
  if (!name) throw validation({ fieldErrors: { name: [FILE_MESSAGES.badName] } }, FILE_MESSAGES.badName);
  if (announcedBytes != null) {
    const problem = fileSizeProblem(announcedBytes);
    if (problem) throw validation(undefined, problem);
  }
  if (!withinDailyQuota(meta.purpose, await usedToday(tx, ctx.personId), announcedBytes ?? 1)) throw rateLimited(FILE_MESSAGES.quota);
  const fileId = uuidv7();
  return { purpose: meta.purpose, workItemId: meta.workItemId ?? null, name, fileId, storageKey: storageKeyFor(ctx.orgId, fileId, new Date()) };
}

/**
 * The write that records an upload, its bytes received and sniffed: the same decision again (the تکلیف may have closed
 * meanwhile), the quota with the real size under a per-person advisory lock (two parallel uploads cannot both slip
 * under it), the `pending` row, its audit row (ids, size, type — no name), the org's stale uploads expired, and LAST the
 * rename of the temp file to its key — a failure of anything before rolls back with the file still in temp. Returns the
 * keys of the expired uploads, whose bytes the route deletes after the commit.
 */
export async function recordUpload(tx: Tx, ctx: FileAccessCtx, meta: UploadMeta, plan: UploadPlan, received: ReceivedUpload): Promise<{ file: UploadedFile; expiredKeys: string[] }> {
  const ticket = await authorizeUpload(tx, ctx, meta, received.sizeBytes);
  const sizeProblem = fileSizeProblem(received.sizeBytes);
  if (sizeProblem) throw validation(undefined, sizeProblem);
  if (!STORAGE_KEY_RE.test(plan.storageKey) || plan.storageKey.split("/")[0] !== ctx.orgId.toLowerCase() || plan.storageKey.split("/")[2] !== plan.fileId) {
    throw new Error("recordUpload: the plan does not match this organization");
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`files.upload:${ctx.personId}`}, 0))`);
  if (!withinDailyQuota(meta.purpose, await usedToday(tx, ctx.personId), received.sizeBytes)) throw rateLimited(FILE_MESSAGES.quota);

  const name = nameForKind(ticket.name, received.kind);
  const mime = KIND_INFO[received.kind].mime;
  await tx.insert(fileObject).values({
    id: plan.fileId,
    organizationId: ctx.orgId,
    storageKey: plan.storageKey,
    mime,
    sizeBytes: received.sizeBytes,
    sha256: received.sha256,
    originalName: name,
    uploadedByPersonId: ctx.personId,
    status: "pending",
    purpose: meta.purpose,
    targetWorkItemId: ticket.workItemId,
  });
  await audit(
    ctx,
    "files.file_object.uploaded",
    { schema: "files", table: "file_object", id: plan.fileId },
    null,
    { purpose: meta.purpose, workItemId: ticket.workItemId, sizeBytes: received.sizeBytes, mime },
    tx,
  );
  const expiredKeys = await expireStaleUploads(tx, ctx);
  await publishTemp(received.tempPath, plan.storageKey);
  return { file: { id: plan.fileId, name, sizeBytes: received.sizeBytes, kind: received.kind }, expiredKeys };
}

/**
 * Uploads of this organization left `pending` (never attached by the form they were made for) for longer than
 * `pendingTtlMs`: archived, at most 50 per call, rows nobody holds (SKIP LOCKED — an attach in flight wins). One
 * audit row with their ids. Returns their keys; the caller deletes the bytes after the commit. Runs on every upload,
 * so the files volume needs no cron for them.
 */
export async function expireStaleUploads(tx: Tx, ctx: FileAccessCtx, limit = 50): Promise<string[]> {
  const stale = await tx
    .select({ id: fileObject.id, storageKey: fileObject.storageKey })
    .from(fileObject)
    .where(and(eq(fileObject.status, "pending"), sql`${fileObject.createdAt} < now() - make_interval(secs => ${FILE_LIMITS.pendingTtlMs / 1000})`))
    .orderBy(asc(fileObject.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  if (stale.length === 0) return [];
  await tx
    .update(fileObject)
    .set({ status: "archived", archivedAt: sql`now()` })
    .where(inArray(fileObject.id, stale.map((s) => s.id)));
  await audit(ctx, "files.file_object.expired", { schema: "files", table: "file_object", id: null }, null, { ids: stale.map((s) => s.id) }, tx);
  return stale.map((s) => s.storageKey);
}

export interface DownloadMeta {
  storageKey: string;
  sizeBytes: number;
  kind: FileKind;
  name: string;
}

/** Every refusal — unknown, archived, pending, another tenant's, not yours to see — is the same NOT_FOUND. */
export async function findDownload(tx: Tx, ctx: FileAccessCtx, fileId: string): Promise<DownloadMeta> {
  const [row] = await tx
    .select({
      storageKey: fileObject.storageKey,
      sizeBytes: fileObject.sizeBytes,
      mime: fileObject.mime,
      name: fileObject.originalName,
      workItemId: workItemAttachment.workItemId,
      submissionId: workItemAttachment.submissionId,
    })
    .from(fileObject)
    .innerJoin(workItemAttachment, and(eq(workItemAttachment.organizationId, fileObject.organizationId), eq(workItemAttachment.fileId, fileObject.id)))
    .where(and(eq(fileObject.id, fileId), eq(fileObject.status, "attached"), sql`${workItemAttachment.archivedAt} is null`))
    .limit(1);
  if (!row) throw notFound();
  const item = await canViewWorkItem(tx, ctx, row.workItemId); // NOT_FOUND unless the تکلیف is visible to the caller
  if (row.submissionId) {
    const [sub] = await tx
      .select({ student: workItemSubmission.studentPersonId })
      .from(workItemSubmission)
      .where(eq(workItemSubmission.id, row.submissionId))
      .limit(1);
    if (!sub) throw notFound();
    if (sub.student !== ctx.personId) {
      const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
      if (!managesItem(ctx, item, mine !== null)) throw notFound();
    }
  }
  const kind = kindOfMime(row.mime);
  if (!kind) throw notFound();
  return { storageKey: row.storageKey, sizeBytes: row.sizeBytes, kind, name: row.name ?? `فایل.${KIND_INFO[kind].extensions[0]}` };
}

// ---------------------------------------------------------------------------------------------------------------
// the item page's read model
// ---------------------------------------------------------------------------------------------------------------

export interface WorkItemFilesView {
  /** The تکلیف takes files at all (an open or closed `task`, not confidential). */
  takesFiles: boolean;
  /** The giver's files — for everyone who opens the تکلیف. */
  files: FileView[];
  /** The caller may change the giver's files now (the «ویرایش» form shows the picker). */
  canAttach: boolean;
  /** Uploads are refused for this session («ورود آزمایشی»). */
  uploadsBlocked: boolean;
  /** The student's own «پاسخ شما» card — set for a student the تکلیف was given to. */
  mine: { submission: SubmissionView | null; canSubmit: boolean } | null;
  /** «پاسخ‌های دانش‌آموزان» — for the item's managers. */
  overview: SubmissionsOverview | null;
}

const NO_FILES: WorkItemFilesView = { takesFiles: false, files: [], canAttach: false, uploadsBlocked: false, mine: null, overview: null };

export async function workItemFilesView(tx: Tx, ctx: FileAccessCtx, detail: WorkItemDetail): Promise<WorkItemFilesView> {
  const { item, viewer, assignees } = detail;
  if (!itemTakesFiles(item)) return NO_FILES;
  const files = await listItemFiles(tx, item.id);
  const uploadsBlocked = await isDemoSession(tx, ctx);
  const open = itemIsOpen(item);
  const isAssignee = detail.myAssigneeState !== null;
  const canAttach = viewer.isManager && open && canAtAnyScope(ctx.assignments, "workspace.work_item.attach");
  const student = isAssignee && !viewer.isCreator && canAtAnyScope(ctx.assignments, "workspace.work_item.submit");
  const mine = student ? { submission: await readMySubmission(tx, ctx, item.id), canSubmit: open } : null;
  const overview = viewer.isManager ? await readSubmissionsOverview(tx, item.id, assignees) : null;
  return { takesFiles: true, files, canAttach, uploadsBlocked, mine, overview };
}
