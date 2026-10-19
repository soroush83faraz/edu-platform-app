import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common";
import { person } from "./iam";
import { orgFk } from "./tenancy";

export const files = pgSchema("files");

/**
 * Metadata of a stored blob; the bytes live under FILES_DIR at `storage_key` = `<organization id>/<yyyy>/<id>` —
 * server-made, CHECKed to exactly that shape and to THIS row's organization and id, so no row can point at another
 * tenant's bytes or outside the root (src/modules/files/paths.ts). «پیوست تکلیف و تحویل پاسخ» (migration 0024; owner
 * 2026-10-19; docs/decisions.md): `mime` is the type SNIFFED from the bytes (src/modules/files/sniff.ts), never the
 * client's; `original_name` the sanitised display name (src/modules/files/names.ts). Lifecycle: `pending` (uploaded,
 * not yet attached — only its uploader can attach it, and a pending file is never served) → `attached` (linked by a
 * `workspace.work_item_attachment`) → `archived` (removed from its تکلیف / پاسخ, or a pending upload left for 24 h;
 * its bytes are deleted from disk). Never deleted (app_rw has no DELETE — `app.apply_grants()`, 0024).
 * `purpose` + `target_work_item_id` bind a pending upload to what it was uploaded FOR (a giver's files of a new
 * تکلیف: no target; of an existing one, or a student's پاسخ: that تکلیف) — the attach step accepts nothing else. The
 * composite FK `file_object_target_work_item_fk` → `workspace.work_item` exists in SQL only (0024), like
 * `class_group_homeroom_staff_fk`: declaring it here would close an import cycle between the schema files.
 */
export const fileObject = files.table(
  "file_object",
  {
    id: id(),
    organizationId: orgFk(),
    storageKey: text("storage_key").notNull().unique("file_object_storage_key_uq"),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    originalName: text("original_name"),
    uploadedByPersonId: uuid("uploaded_by_person_id").notNull(),
    visibilityHint: text("visibility_hint").notNull().default("private"),
    scanStatus: text("scan_status").notNull().default("skipped"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** pending · attached · archived (see above). DEFAULT pending: a row nobody attaches is never served and expires. */
    status: text("status").notNull().default("pending"),
    /** `work_item` (a giver's «فایل‌های تکلیف») or `submission` (a student's «پاسخ»); null for files of other uses. */
    purpose: text("purpose"),
    /** The تکلیف the upload was made for; null for the files of a تکلیف not created yet. FK in SQL only (0024). */
    targetWorkItemId: uuid("target_work_item_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("file_object_org_id_uq").on(t.organizationId, t.id),
    index("file_object_uploader_created_idx").on(t.organizationId, t.uploadedByPersonId, t.createdAt),
    index("file_object_pending_idx").on(t.organizationId, t.createdAt).where(sql`${t.status} = 'pending'`),
    check("file_object_size_chk", sql`${t.sizeBytes} >= 0`),
    check("file_object_size_positive_chk", sql`${t.sizeBytes} > 0`),
    check("file_object_visibility_chk", sql`${t.visibilityHint} IN ('private', 'org', 'public')`),
    check("file_object_scan_status_chk", sql`${t.scanStatus} IN ('skipped', 'pending', 'clean', 'infected')`),
    check("file_object_status_chk", sql`${t.status} IN ('pending', 'attached', 'archived')`),
    check("file_object_archived_chk", sql`(${t.status} = 'archived') = (${t.archivedAt} IS NOT NULL)`),
    check("file_object_purpose_chk", sql`${t.purpose} IS NULL OR ${t.purpose} IN ('work_item', 'submission')`),
    check("file_object_submission_target_chk", sql`${t.purpose} IS DISTINCT FROM 'submission' OR ${t.targetWorkItemId} IS NOT NULL`),
    check(
      "file_object_storage_key_chk",
      sql`${t.storageKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND split_part(${t.storageKey}, '/', 1) = ${t.organizationId}::text AND split_part(${t.storageKey}, '/', 3) = ${t.id}::text`,
    ),
    check("file_object_sha256_chk", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("file_object_name_chk", sql`${t.originalName} IS NULL OR char_length(${t.originalName}) BETWEEN 1 AND 200`),
    foreignKey({
      name: "file_object_uploaded_by_fk",
      columns: [t.organizationId, t.uploadedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);
