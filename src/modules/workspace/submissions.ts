// workspace/submissions — «تحویل پاسخ» (owner 2026-10-19; docs/decisions.md «پیوست تکلیف و تحویل پاسخ»; migration 0024).
//
//   • WHO: a student (`workspace.work_item.submit` — the student role only) to a تکلیف given to THEM (an assignee row;
//     not one they gave themselves) that takes files (`itemTakesFiles`: a `task`, not confidential). Anyone else gets
//     NOT_FOUND for a تکلیف they cannot see (`canViewWorkItem`) and FORBIDDEN for one they can.
//   • WHEN: while the تکلیف is open — its own «انجام شد» does not close it for them; the GIVER's «اتمام» / «حذف» (or an
//     archive) does, and a «بازیابی» opens it again. Under the item's row lock (the same lock a close takes), so a
//     پاسخ never lands on a تکلیف closed meanwhile; person rows first (the student, the giver), then the item —
//     iam/removal «Concurrency».
//   • WHAT: ONE row per student and تکلیف, created by the first «ثبت پاسخ» and edited in place: text ≤ 4000 (optional)
//     and files — the student's own pending uploads made for THIS تکلیف (./work-item-files) — at most 5 and 25 MiB in
//     all; never empty. A file taken out is archived and its bytes deleted after the commit (the action).
//   • WHO READS: the student their own; the item's managers (`managesItem`: the giver, a broad admin who is not an
//     assignee) every پاسخ with its files and who has not answered. Never another student, a guardian, a counselor —
//     and 0024's RESTRICTIVE policies say the same in the database. A removed student's پاسخ stays for the giver.
//   • BELL: the giver hears ONCE per student and تکلیف («<نام> پاسخ تکلیف «…» را ثبت کرد», `work_item.submitted`, no
//     text) — the owner's explicit exception to «nothing a student does notifies anyone» (./notify-policy).
//   • AUDIT: `workspace.work_item_submission.saved` with ids, lengths, sizes and types — never the text or a file name.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { forbidden, notFound, validation } from "@/lib/errors";
import { canAtAnyScope } from "@/modules/iam/can";
import { person, studentProfile } from "@/modules/iam/schema";
import { FILE_MESSAGES, submissionSetProblem } from "@/modules/files/limits";
import { notifyMany } from "@/modules/notif/service";
import { managesItem } from "./manage-policy";
import { type AssigneeRow, type WorkItemCore, findMyAssigneeRow, findPersonName } from "./repo";
import { workItemSubmission } from "./schema";
import { canViewWorkItem, lockWorkItem, type WorkspaceCtx } from "./service";
import {
  type FileFact,
  type FileView,
  archiveAttachments,
  attachUploads,
  fileFact,
  itemIsOpen,
  itemTakesFiles,
  listSubmissionFiles,
  lockLiveAttachments,
  takePendingUploads,
} from "./work-item-files";

export interface SaveSubmissionInput {
  workItemId: string;
  /** The پاسخ text; empty / null = none (files only). */
  body: string | null;
  /** File ids of the student's pending uploads for this تکلیف. */
  addFileIds: readonly string[];
  /** File ids of this پاسخ's files to take out. */
  removeFileIds: readonly string[];
}

export interface SaveSubmissionResult {
  submissionId: string;
  /** The first «ثبت پاسخ» of this student on this تکلیف. */
  first: boolean;
  /** Something was written (an unchanged save writes nothing). */
  changed: boolean;
  fileCount: number;
  /** Storage keys of the files taken out — deleted from disk once the transaction has committed (never sent to the client). */
  unlinkKeys: string[];
}

/** The giver's bell of a first پاسخ: name and title only, never the text. */
export function submittedTitle(studentName: string, itemTitle: string): string {
  return `${studentName} پاسخ تکلیف «${itemTitle}» را ثبت کرد`;
}

/**
 * The person rows a پاسخ references (the student — the row's FK, the giver — the bell's recipient), FOR KEY SHARE in
 * ascending order BEFORE the item's lock: a removal holds its person FOR UPDATE and then locks that person's items, so
 * taking them after the item would invert the order (service `lockItemPeople`).
 */
async function lockPeople(tx: Tx, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  await tx.select({ id: person.id }).from(person).where(inArray(person.id, unique)).orderBy(asc(person.id)).for("key share");
}

/** Decides who may answer: NOT_FOUND / FORBIDDEN / VALIDATION, or the item (locked when `lock`). */
export async function assertMaySubmit(tx: Tx, ctx: WorkspaceCtx, workItemId: string, opts: { lock: boolean }): Promise<WorkItemCore> {
  const seen = await canViewWorkItem(tx, ctx, workItemId);
  if (!canAtAnyScope(ctx.assignments, "workspace.work_item.submit")) throw forbidden();
  if (!itemTakesFiles(seen)) throw notFound();
  let item = seen;
  if (opts.lock) {
    await lockPeople(tx, [ctx.personId, seen.createdByPersonId]);
    item = await lockWorkItem(tx, workItemId);
  }
  // Read after the lock: a removal that withdrew this student (iam/removal) has committed, or waits for us.
  const mine = await findMyAssigneeRow(tx, ctx.personId, item.id);
  if (!mine || item.createdByPersonId === ctx.personId) throw forbidden();
  if (!itemIsOpen(item)) throw validation(undefined, FILE_MESSAGES.submissionClosed);
  return item;
}

export async function saveSubmission(tx: Tx, ctx: WorkspaceCtx, input: SaveSubmissionInput): Promise<SaveSubmissionResult> {
  const item = await assertMaySubmit(tx, ctx, input.workItemId, { lock: true });
  const body = input.body?.trim() ? input.body.trim() : null;
  if (body !== null && body.length > 4000) throw validation({ fieldErrors: { body: ["متن پاسخ حداکثر ۴۰۰۰ نویسه است."] } });

  const [existing] = await tx
    .select({ id: workItemSubmission.id, body: workItemSubmission.body })
    .from(workItemSubmission)
    .where(and(eq(workItemSubmission.workItemId, item.id), eq(workItemSubmission.studentPersonId, ctx.personId)))
    .limit(1)
    .for("update");
  const live = existing ? await lockLiveAttachments(tx, item.id, existing.id) : [];
  const removeIds = new Set(input.removeFileIds);
  const toRemove = live.filter((a) => removeIds.has(a.fileId));
  if (toRemove.length !== removeIds.size) throw validation({ fieldErrors: { files: [FILE_MESSAGES.expired] } }, FILE_MESSAGES.expired);
  const uploads = await takePendingUploads(tx, ctx, input.addFileIds, "submission", item.id);
  const kept = live.filter((a) => !removeIds.has(a.fileId));
  const sizes = [...kept.map((a) => a.sizeBytes), ...uploads.map((u) => u.sizeBytes)];
  const problem = submissionSetProblem(sizes);
  if (problem) throw validation({ fieldErrors: { files: [problem] } }, problem);
  if (body === null && sizes.length === 0) throw validation({ fieldErrors: { body: [FILE_MESSAGES.emptySubmission] } }, FILE_MESSAGES.emptySubmission);

  const bodyChanged = !existing || existing.body !== body;
  if (existing && !bodyChanged && toRemove.length === 0 && uploads.length === 0) {
    return { submissionId: existing.id, first: false, changed: false, fileCount: sizes.length, unlinkKeys: [] };
  }

  let submissionId: string;
  if (existing) {
    submissionId = existing.id;
    // Always touch the row (updated_at is the پاسخ's «ویرایش» time, files included).
    await tx.update(workItemSubmission).set({ body }).where(eq(workItemSubmission.id, existing.id));
  } else {
    const [row] = await tx
      .insert(workItemSubmission)
      .values({ organizationId: ctx.orgId, workItemId: item.id, studentPersonId: ctx.personId, body })
      .returning({ id: workItemSubmission.id });
    submissionId = row.id;
  }
  const unlinkKeys = await archiveAttachments(tx, toRemove);
  await attachUploads(tx, ctx, item.id, submissionId, uploads, live.reduce((m, a) => Math.max(m, a.sequence), -1) + 1);

  if (!existing) {
    // The owner's exception (2026-10-19): the giver hears of the FIRST پاسخ of each student — deduped, title only.
    const name = (await findPersonName(tx, ctx.personId)) ?? "";
    await notifyMany(tx, ctx, [item.createdByPersonId], {
      typeCode: "work_item.submitted",
      title: submittedTitle(name, item.title),
      body: null,
      sourceKind: "work_item",
      sourceId: item.id,
      deepLink: `/inbox/${item.id}`,
      dedupeKey: () => `wi:${item.id}:submitted:${ctx.personId}`,
    });
  }

  const added: FileFact[] = uploads.map(fileFact);
  await audit(
    ctx,
    "workspace.work_item_submission.saved",
    { schema: "workspace", table: "work_item_submission", id: submissionId },
    existing ? { bodyLength: existing.body?.length ?? 0, fileCount: live.length } : null,
    { workItemId: item.id, first: !existing, bodyLength: body?.length ?? 0, fileCount: sizes.length, totalBytes: sizes.reduce((a, b) => a + b, 0), added, removed: toRemove.map((r) => r.fileId) },
    tx,
  );
  return { submissionId, first: !existing, changed: true, fileCount: sizes.length, unlinkKeys };
}

// ---------------------------------------------------------------------------------------------------------------
// read models
// ---------------------------------------------------------------------------------------------------------------

export interface SubmissionView {
  id: string;
  studentPersonId: string;
  studentName: string;
  /** The student was removed (`person.status = 'archived'`) — their پاسخ stays as history. */
  studentRemoved: boolean;
  body: string | null;
  submittedAt: Date;
  updatedAt: Date;
  files: FileView[];
}

export interface SubmissionsOverview {
  /** The تکلیف's current assignees (a removed student is no longer one). */
  assigneeCount: number;
  /** Current assignees with a پاسخ — the «۱۲ از ۲۴ تحویل داده‌اند». */
  submittedCount: number;
  /** Every پاسخ, latest first — a removed student's included. */
  submissions: SubmissionView[];
  /** Current assignees without a پاسخ. */
  missing: Array<{ personId: string; name: string }>;
}

async function readSubmissions(tx: Tx, workItemId: string, onlyStudent?: string): Promise<SubmissionView[]> {
  const rows = await tx
    .select({
      id: workItemSubmission.id,
      studentPersonId: workItemSubmission.studentPersonId,
      f: person.firstName,
      l: person.lastName,
      status: person.status,
      body: workItemSubmission.body,
      submittedAt: workItemSubmission.submittedAt,
      updatedAt: workItemSubmission.updatedAt,
    })
    .from(workItemSubmission)
    .innerJoin(person, eq(person.id, workItemSubmission.studentPersonId))
    .where(and(eq(workItemSubmission.workItemId, workItemId), onlyStudent ? eq(workItemSubmission.studentPersonId, onlyStudent) : undefined))
    .orderBy(asc(person.lastName), asc(person.firstName));
  if (rows.length === 0) return [];
  const files = await listSubmissionFiles(tx, workItemId);
  return rows.map((r) => ({
    id: r.id,
    studentPersonId: r.studentPersonId,
    studentName: `${r.f} ${r.l}`,
    studentRemoved: r.status === "archived",
    body: r.body,
    submittedAt: r.submittedAt,
    updatedAt: r.updatedAt,
    files: files.get(r.id) ?? [],
  }));
}

/** The caller's own پاسخ to an item (null when none). The caller decided they are its student. */
export async function readMySubmission(tx: Tx, ctx: { personId: string }, workItemId: string): Promise<SubmissionView | null> {
  const [mine] = await readSubmissions(tx, workItemId, ctx.personId);
  return mine ?? null;
}

/** The persons among `ids` who are students (a student profile) — the only assignees who can answer. */
async function studentsAmong(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.select({ personId: studentProfile.personId }).from(studentProfile).where(inArray(studentProfile.personId, [...ids]));
  return new Set(rows.map((r) => r.personId));
}

/**
 * Every پاسخ of an item and which of its STUDENT assignees have not answered — for its managers only (the caller
 * decided `managesItem`). Null when the item went to no student and nobody answered (a تسک among staff).
 */
export async function readSubmissionsOverview(tx: Tx, workItemId: string, assignees: readonly AssigneeRow[]): Promise<SubmissionsOverview | null> {
  const submissions = await readSubmissions(tx, workItemId);
  const students = await studentsAmong(tx, assignees.map((a) => a.personId));
  const expected = assignees.filter((a) => students.has(a.personId));
  if (expected.length === 0 && submissions.length === 0) return null;
  const answered = new Set(submissions.map((s) => s.studentPersonId));
  return {
    assigneeCount: expected.length,
    submittedCount: expected.filter((a) => answered.has(a.personId)).length,
    submissions,
    missing: expected.filter((a) => !answered.has(a.personId)).map((a) => ({ personId: a.personId, name: a.name })),
  };
}

/** May this viewer read every پاسخ of the item? Its managers (`managesItem`) — the giver, a broad admin not assigned. */
export function readsAllSubmissions(ctx: WorkspaceCtx, item: Pick<WorkItemCore, "createdByPersonId" | "typeCode">, viewerIsAssignee: boolean): boolean {
  return managesItem(ctx, item, viewerIsAssignee);
}
