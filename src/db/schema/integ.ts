import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common";
import { fileObject } from "./files";
import { person } from "./iam";
import { orgFk, school } from "./tenancy";

export const integ = pgSchema("integ");

/** One Excel import run: draft → validated → committed | failed. */
export const importBatch = integ.table(
  "import_batch",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id"),
    kind: text("kind").notNull(),
    fileId: uuid("file_id"),
    fileSha256: text("file_sha256"),
    status: text("status").notNull().default("draft"),
    rowCount: integer("row_count").notNull().default(0),
    okCount: integer("ok_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    createdByPersonId: uuid("created_by_person_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("import_batch_org_id_uq").on(t.organizationId, t.id),
    index("import_batch_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    check("import_batch_kind_chk", sql`${t.kind} IN ('students', 'staff', 'classes', 'full')`),
    check("import_batch_status_chk", sql`${t.status} IN ('draft', 'validated', 'committed', 'failed')`),
    foreignKey({
      name: "import_batch_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "import_batch_file_fk",
      columns: [t.organizationId, t.fileId],
      foreignColumns: [fileObject.organizationId, fileObject.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "import_batch_created_by_fk",
      columns: [t.organizationId, t.createdByPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/** One spreadsheet row of a batch with its raw cells, normalized values, validation result and created ids. */
export const importRow = integ.table(
  "import_row",
  {
    id: id(),
    organizationId: orgFk(),
    batchId: uuid("batch_id").notNull(),
    sheet: text("sheet").notNull(),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    normalized: jsonb("normalized").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("pending"),
    errors: jsonb("errors").$type<unknown[]>().notNull().default([]),
    entityIds: jsonb("entity_ids").$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    unique("import_row_batch_sheet_row_uq").on(t.batchId, t.sheet, t.rowNumber),
    index("import_row_org_batch_status_idx").on(t.organizationId, t.batchId, t.status),
    check("import_row_status_chk", sql`${t.status} IN ('pending', 'ok', 'warning', 'error', 'committed')`),
    foreignKey({
      name: "import_row_batch_fk",
      columns: [t.organizationId, t.batchId],
      foreignColumns: [importBatch.organizationId, importBatch.id],
    }).onDelete("restrict"),
  ],
);

/** Maps an external reference (Excel student number, legacy id) to a row of ours, per source. */
export const externalIdentityMap = integ.table(
  "external_identity_map",
  {
    id: id(),
    organizationId: orgFk(),
    entityTable: text("entity_table").notNull(),
    entityId: uuid("entity_id").notNull(),
    source: text("source").notNull(),
    externalRef: text("external_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("external_identity_map_ref_uq").on(t.organizationId, t.source, t.entityTable, t.externalRef),
    index("external_identity_map_org_entity_idx").on(t.organizationId, t.entityTable, t.entityId),
    check("external_identity_map_source_chk", sql`${t.source} IN ('excel', 'legacy_system')`),
  ],
);
