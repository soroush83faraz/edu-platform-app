// Commit of a validated workbook — ONE transaction (the caller's `withTenant` as the admin): classes (upsert by
// year+branch+name) → subjects to create → offerings (subject × current term) → staff (skip existing by phone) →
// teaching (assignTeacher when not active) → students (existing: names + enrollment; new: createStudent with
// account). Writes integ.import_batch / import_row, integ.external_identity_map for created entities, one
// audit row per created/updated entity (`import.insert` / `import.update`). A second commit of the same file
// creates nothing. Plaintext initial passwords are returned to the caller only (CSV for the operator).
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { conflict, notFound } from "@/lib/errors";
import { assignTeacher, enrollStudent, moveEnrollment } from "@/modules/academic/service";
import { classEnrollment, teacherAssignment } from "@/modules/academic/schema";
import { createStaff, createStudent, updatePerson, type IamCtx } from "@/modules/iam/service";
import { findClassGroupByName, findOffering } from "@/modules/tenancy/repo";
import { createClassGroup, createClassOffering, createSubject, updateClassGroup } from "@/modules/tenancy/service";
import { externalIdentityMap, importBatch, importRow } from "../schema";
import type { SheetKey } from "./template";
import { normKey, type ImportReference, type ValidationResult } from "./validate";

export type ImportCtx = IamCtx;

export interface CommitCounts {
  inserted: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
}

export interface CredentialLine {
  className: string;
  name: string;
  loginIdentifier: string;
  initialPassword: string;
}

export interface CommitResult {
  batchId: string;
  counts: CommitCounts;
  credentials: CredentialLine[];
  totalInserted: number;
}

export interface BatchInput {
  /** Reuse a batch created by an earlier dry-run (must be `validated`, same file hash). */
  batchId?: string;
  fileSha256: string;
  kind: "students" | "staff" | "classes" | "full";
}

export function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function inc(rec: Record<string, number>, key: string, by = 1): void {
  rec[key] = (rec[key] ?? 0) + by;
}

/** Writes (or refreshes) the import_batch + import_row rows of a validation. Used by dry-run and commit alike. */
export async function recordBatch(tx: Tx, ctx: ImportCtx, ref: ImportReference, validation: ValidationResult, input: BatchInput, status: "validated" | "failed"): Promise<string> {
  const rowCount = validation.rows.length;
  const okCount = validation.rows.filter((r) => r.status !== "error").length;
  const errorCount = validation.rows.filter((r) => r.status === "error").length;
  const summary: Record<string, unknown> = { sheets: validation.summary, fileErrors: validation.fileErrors, templateVersion: "v1" };
  let batchId = input.batchId;
  if (batchId) {
    const [b] = await tx.select({ id: importBatch.id, status: importBatch.status, fileSha256: importBatch.fileSha256 }).from(importBatch).where(eq(importBatch.id, batchId)).limit(1);
    if (!b) throw notFound("این batch پیدا نشد.");
    if (b.status !== "validated") throw conflict(`این batch قبلاً ${b.status === "committed" ? "اعمال" : "باطل"} شده است.`);
    if (b.fileSha256 && b.fileSha256 !== input.fileSha256) throw conflict("فایل با فایل dry-run یکی نیست (sha256 فرق دارد).");
    await tx.update(importBatch).set({ status, rowCount, okCount, errorCount, summary }).where(eq(importBatch.id, batchId));
    await tx.delete(importRow).where(eq(importRow.batchId, batchId));
  } else {
    const [b] = await tx
      .insert(importBatch)
      .values({ organizationId: ctx.orgId, schoolId: ref.school.id, kind: input.kind, fileSha256: input.fileSha256, status, rowCount, okCount, errorCount, summary, createdByPersonId: ctx.personId })
      .returning({ id: importBatch.id });
    batchId = b.id;
  }
  const values = validation.rows.map((r) => ({
    organizationId: ctx.orgId,
    batchId: batchId!,
    sheet: r.sheet,
    rowNumber: r.rowNumber,
    raw: r.raw as Record<string, unknown>,
    normalized: r.normalized,
    status: r.status,
    errors: r.issues as unknown[],
  }));
  for (let i = 0; i < values.length; i += 500) await tx.insert(importRow).values(values.slice(i, i + 500));
  await audit(ctx, "import.validated", { schema: "integ", table: "import_batch", id: batchId! }, null, { rowCount, okCount, errorCount, status }, tx);
  return batchId!;
}

async function mapExternal(tx: Tx, ctx: ImportCtx, entityTable: string, entityId: string, externalRef: string): Promise<void> {
  await tx
    .insert(externalIdentityMap)
    .values({ organizationId: ctx.orgId, entityTable, entityId, source: "excel", externalRef })
    .onConflictDoNothing();
}

async function markRows(tx: Tx, batchId: string, sheet: SheetKey, rowNumber: number, entityIds: Record<string, string>): Promise<void> {
  await tx.update(importRow).set({ status: "committed", entityIds }).where(and(eq(importRow.batchId, batchId), eq(importRow.sheet, sheet), eq(importRow.rowNumber, rowNumber)));
}

/** The real thing. `validation.ok` must be true (the CLI refuses otherwise). */
export async function commitImport(tx: Tx, ctx: ImportCtx, ref: ImportReference, validation: ValidationResult, input: BatchInput): Promise<CommitResult> {
  if (!validation.ok) throw conflict("فایل خطا دارد؛ اول dry-run را بدون خطا کنید.");
  const batchId = await recordBatch(tx, ctx, ref, validation, input, "validated");
  const counts: CommitCounts = { inserted: {}, updated: {}, skipped: {} };
  const credentials: CredentialLine[] = [];
  const entity = (table: string, id: string) => ({ schema: table.split(".")[0], table: table.split(".")[1], id });
  const logInsert = (table: string, id: string, after: unknown) => audit(ctx, "import.insert", entity(table, id), null, { batchId, ...(after as object) }, tx);
  const logUpdate = (table: string, id: string, before: unknown, after: unknown) => audit(ctx, "import.update", entity(table, id), before, { batchId, ...(after as object) }, tx);

  // ---- classes ----
  const classIdByKey = new Map<string, string>(); // `${branchId}|${normKey(name)}` → id
  const classKey = (branchId: string, name: string) => `${branchId}|${normKey(name)}`;
  for (const c of ref.classes) classIdByKey.set(classKey(c.branchId, c.name), c.id);
  for (const c of validation.plan.classes) {
    if (c.existing) {
      if (c.existing.gradeLevelId !== c.gradeLevelId) {
        await updateClassGroup(tx, ctx, c.existing.id, { gradeLevelId: c.gradeLevelId });
        await logUpdate("tenancy.class_group", c.existing.id, { gradeLevelId: c.existing.gradeLevelId }, { gradeLevelId: c.gradeLevelId });
        inc(counts.updated, "classes");
      } else inc(counts.skipped, "classes");
      classIdByKey.set(classKey(c.branchId, c.name), c.existing.id);
      await markRows(tx, batchId, "classes", c.rowNumber, { classGroupId: c.existing.id });
      continue;
    }
    // The validator matched by normalized key; an exact-name row may still exist (same spelling) — never duplicate it.
    const already = classIdByKey.has(classKey(c.branchId, c.name)) ? { id: classIdByKey.get(classKey(c.branchId, c.name))! } : await findClassGroupByName(tx, ref.academicYear.id, c.branchId, c.name);
    const id = already ? already.id : (await createClassGroup(tx, ctx, { branchId: c.branchId, academicYearId: ref.academicYear.id, gradeLevelId: c.gradeLevelId, name: c.name })).classGroupId;
    if (!already) {
      await mapExternal(tx, ctx, "tenancy.class_group", id, `${ref.school.code}:${c.name}`);
      await logInsert("tenancy.class_group", id, { name: c.name, gradeLevelId: c.gradeLevelId });
      inc(counts.inserted, "classes");
    } else inc(counts.skipped, "classes");
    classIdByKey.set(classKey(c.branchId, c.name), id);
    await markRows(tx, batchId, "classes", c.rowNumber, { classGroupId: id });
  }
  const resolveClass = (branchId: string, name: string): string => {
    const id = classIdByKey.get(classKey(branchId, name));
    if (!id) throw notFound(`کلاس «${name}» پیدا نشد.`);
    return id;
  };

  // ---- subjects ----
  const subjectIdByCode = new Map<string, string>();
  for (const s of validation.plan.newSubjects) {
    const res = await createSubject(tx, ctx, { name: s.name, code: s.code });
    subjectIdByCode.set(s.code, res.subjectId);
    await logInsert("tenancy.subject", res.subjectId, { name: s.name, code: s.code });
    inc(counts.inserted, "subjects");
  }

  // ---- staff ----
  const staffProfileByPhone = new Map<string, string>();
  for (const [phone, s] of ref.staffByPhone) staffProfileByPhone.set(phone, s.staffProfileId);
  for (const s of validation.plan.staff) {
    if (s.existing) {
      inc(counts.skipped, "staff");
      await markRows(tx, batchId, "staff", s.rowNumber, { personId: s.existing.personId, staffProfileId: s.existing.staffProfileId });
      continue;
    }
    const res = await createStaff(tx, ctx, { firstName: s.firstName, lastName: s.lastName, phone: s.phone, employeeNumber: s.employeeNumber });
    staffProfileByPhone.set(s.phone, res.staffProfileId);
    await mapExternal(tx, ctx, "iam.person", res.personId, s.phone);
    await logInsert("iam.person", res.personId, { kind: "staff", staffProfileId: res.staffProfileId, hasAccount: res.userAccountId !== null });
    inc(counts.inserted, "staff");
    if (res.initialPassword) {
      inc(counts.inserted, "accounts");
      credentials.push({ className: "", name: `${s.firstName} ${s.lastName}`, loginIdentifier: res.loginIdentifier, initialPassword: res.initialPassword });
    }
    await markRows(tx, batchId, "staff", s.rowNumber, { personId: res.personId, staffProfileId: res.staffProfileId });
  }

  // ---- offerings + teaching ----
  for (const t of validation.plan.teaching) {
    const classGroupId = resolveClass(t.branchId, t.className);
    const subjectId = t.subjectId ?? (t.newSubject ? subjectIdByCode.get(t.newSubject.code) : undefined);
    if (!subjectId) throw notFound(`درس ردیف ${t.rowNumber} پیدا نشد.`);
    let offering = await findOffering(tx, classGroupId, subjectId, ref.term.id);
    if (!offering) {
      const res = await createClassOffering(tx, ctx, { classGroupId, subjectId, termId: ref.term.id });
      offering = { id: res.classOfferingId };
      await logInsert("tenancy.class_offering", res.classOfferingId, { classGroupId, subjectId, termId: ref.term.id });
      inc(counts.inserted, "offerings");
    }
    const staffProfileId = staffProfileByPhone.get(t.teacherPhone);
    if (!staffProfileId) throw notFound(`دبیر ردیف ${t.rowNumber} پیدا نشد.`);
    const [active] = await tx
      .select({ id: teacherAssignment.id })
      .from(teacherAssignment)
      .where(and(eq(teacherAssignment.classOfferingId, offering.id), eq(teacherAssignment.staffProfileId, staffProfileId), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)))
      .limit(1);
    if (active) {
      inc(counts.skipped, "teaching");
      await markRows(tx, batchId, "teaching", t.rowNumber, { classOfferingId: offering.id, teacherAssignmentId: active.id });
      continue;
    }
    const res = await assignTeacher(tx, ctx, { staffProfileId, classOfferingId: offering.id, role: "main" });
    await logInsert("academic.teacher_assignment", res.teacherAssignmentId, { classOfferingId: offering.id, staffProfileId });
    inc(counts.inserted, "teaching");
    await markRows(tx, batchId, "teaching", t.rowNumber, { classOfferingId: offering.id, teacherAssignmentId: res.teacherAssignmentId });
  }

  // ---- students ----
  for (const s of validation.plan.students) {
    const classGroupId = resolveClass(s.branchId, s.className);
    if (s.existing) {
      const renamed = s.existing.firstName !== s.firstName || s.existing.lastName !== s.lastName;
      if (renamed) {
        await updatePerson(tx, ctx, s.existing.personId, { firstName: s.firstName, lastName: s.lastName });
        await logUpdate("iam.person", s.existing.personId, { firstName: s.existing.firstName, lastName: s.existing.lastName }, { firstName: s.firstName, lastName: s.lastName });
      }
      let enrollmentChanged = false;
      if (s.existing.currentClassGroupId === null) {
        await enrollStudent(tx, ctx, { studentProfileId: s.existing.studentProfileId, classGroupId });
        enrollmentChanged = true;
      } else if (s.existing.currentClassGroupId !== classGroupId) {
        const [ce] = await tx
          .select({ id: classEnrollment.id })
          .from(classEnrollment)
          .where(and(eq(classEnrollment.studentProfileId, s.existing.studentProfileId), eq(classEnrollment.status, "active")))
          .limit(1);
        if (ce) {
          await moveEnrollment(tx, ctx, { classEnrollmentId: ce.id, newClassGroupId: classGroupId, reason: "admin" });
          enrollmentChanged = true;
        }
      }
      if (enrollmentChanged) await logUpdate("iam.person", s.existing.personId, { classGroupId: s.existing.currentClassGroupId }, { classGroupId });
      if (renamed || enrollmentChanged) inc(counts.updated, "students");
      else inc(counts.skipped, "students");
      await markRows(tx, batchId, "students", s.rowNumber, { personId: s.existing.personId, studentProfileId: s.existing.studentProfileId, classGroupId });
      continue;
    }
    const res = await createStudent(tx, ctx, {
      firstName: s.firstName,
      lastName: s.lastName,
      studentNumber: s.studentNumber,
      externalRef: s.externalRef,
      contactPhone: s.phone,
      guardianPhone: s.guardianPhone,
      schoolId: ref.school.id,
      login: { createAccount: true, identifier: s.phone },
      enrollment: { classGroupId },
    });
    await mapExternal(tx, ctx, "iam.person", res.personId, s.studentNumber);
    await logInsert("iam.person", res.personId, { kind: "student", studentProfileId: res.studentProfileId, classGroupId, hasAccount: res.userAccountId !== null });
    inc(counts.inserted, "students");
    if (res.initialPassword && res.loginIdentifier) {
      inc(counts.inserted, "accounts");
      credentials.push({ className: s.className, name: `${s.firstName} ${s.lastName}`, loginIdentifier: res.loginIdentifier, initialPassword: res.initialPassword });
    }
    await markRows(tx, batchId, "students", s.rowNumber, { personId: res.personId, studentProfileId: res.studentProfileId, classGroupId });
  }

  const totalInserted = Object.values(counts.inserted).reduce((a, b) => a + b, 0);
  await tx
    .update(importBatch)
    .set({ status: "committed", finishedAt: new Date(), summary: { sheets: validation.summary, counts, templateVersion: "v1" } })
    .where(eq(importBatch.id, batchId));
  await audit(ctx, "import.committed", { schema: "integ", table: "import_batch", id: batchId }, null, { counts }, tx);
  return { batchId, counts, credentials, totalInserted };
}
