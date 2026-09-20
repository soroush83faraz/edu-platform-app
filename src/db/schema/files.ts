import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common";
import { person } from "./iam";
import { orgFk } from "./tenancy";

export const files = pgSchema("files");

/** Metadata of a stored blob (bytes live under FILES_DIR keyed by `storage_key`). Upload UI is out of phase 1. */
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
  },
  (t) => [
    unique("file_object_org_id_uq").on(t.organizationId, t.id),
    check("file_object_size_chk", sql`${t.sizeBytes} >= 0`),
    check("file_object_visibility_chk", sql`${t.visibilityHint} IN ('private', 'org', 'public')`),
    check("file_object_scan_status_chk", sql`${t.scanStatus} IN ('skipped', 'pending', 'clean', 'infected')`),
    foreignKey({
      name: "file_object_uploaded_by_fk",
      columns: [t.organizationId, t.uploadedByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);
