// workspace/file-gates — the two passes of an upload through the ONE gate every entry point uses (defineAction:
// session → must_change_password → Zod `.strict()` → permission → withTenant), for POST /api/files
// (src/app/api/files/route.ts). Deliberately NOT a "use server" module: the second pass receives server-made facts —
// the planned row id / storage key and the received temp file — through a closure, so no client can ever call these
// with facts of its own. The permission follows the purpose: `workspace.work_item.submit` for a student's پاسخ,
// `workspace.work_item.attach` for the giver's files; the item rule is decided inside (./file-access).
import { defineAction, type Result } from "@/lib/actions";
import type { Permission } from "@/modules/iam/permissions";
import { type ReceivedUpload, type UploadPlan, type UploadTicket, type UploadedFile, UploadMeta, authorizeUpload, recordUpload } from "./file-access";

function permissionFor(raw: Record<string, unknown>): Permission {
  return raw.purpose === "submission" ? "workspace.work_item.submit" : "workspace.work_item.attach";
}

/** Pass 1, before a byte is read: may this caller upload this, now? Returns the plan of the row-to-be. */
export function authorizeUploadGate(raw: Record<string, unknown>, announcedBytes: number | null): Promise<Result<UploadTicket>> {
  return defineAction({ schema: UploadMeta, permission: permissionFor(raw), scope: "any" }, (tx, input, ctx) => authorizeUpload(tx, ctx, input, announcedBytes))(raw);
}

/** Pass 2, the bytes received and sniffed: decide again, record the row, publish the bytes (./file-access `recordUpload`). */
export function recordUploadGate(raw: Record<string, unknown>, plan: UploadPlan, received: ReceivedUpload): Promise<Result<{ file: UploadedFile; expiredKeys: string[] }>> {
  return defineAction({ schema: UploadMeta, permission: permissionFor(raw), scope: "any" }, (tx, input, ctx) => recordUpload(tx, ctx, input, plan, received))(raw);
}
