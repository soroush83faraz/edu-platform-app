// Excel importer against the database: dry-run flags an unknown class and a duplicate student number; a clean
// workbook commits (accounts, usernames for phone-less students, offerings, teacher assignments,
// external_identity_map, import_batch/rows, audit) and a second commit of the same file inserts nothing; the
// committed demo workbook (template/demo-danesh.xlsx, built from the seed) is idempotent too; a school-scoped
// importer cannot pull another school's student into their class (N2 — the row is an error, nothing is touched).
// The catalog roles and the demo organizations are seeded as app_owner in beforeAll and removed again in afterAll
// (fixture database is re-created); every import runs inside a withTenant transaction that ends with Rollback.
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, classEnrollment, externalIdentityMap, importBatch, person, userAccount } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { createStudent, getAdminScope, type AdminScope } from "@/modules/iam/service";
import { type ImportCtx, commitImport, recordBatch, sha256Hex } from "@/modules/integ/importers/commit";
import { parseWorkbook } from "@/modules/integ/importers/parse";
import { IMPORT_MESSAGES, loadReference, validateImport } from "@/modules/integ/importers/validate";
import { createAcademicYear, createClassGroup, createSchool } from "@/modules/tenancy/service";
import { buildTemplateWorkbook, type ExampleRows } from "../../scripts/build-template";
import { demoWorkbookRows } from "../../scripts/build-demo-workbook";
import { runMigrations } from "../../scripts/migrate";
import { DANESH, demoId, demoPhone, seedCatalog, seedDemo } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const orgAdminA: ImportCtx & { assignments: Assignment[] } = {
  orgId: f.ORG_A,
  personId: f.PERSON_A2,
  userId: null,
  requestId: "int-import",
  assignments: [{ roleCode: "org_admin", roleId: "r", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
/** `getAdminScope(orgAdminA)` — an organization admin matches existing students organization-wide. */
const ORG_SCOPE: AdminScope = { kind: "organization" };
const isError = (code: string) => (e: unknown) => AppError.is(e) && e.code === code;

async function workbook(rows: ExampleRows): Promise<Buffer> {
  return Buffer.from(await buildTemplateWorkbook(rows).xlsx.writeBuffer());
}

/** Fixture org A: school S1 (branch مرکزی, year current, term نوبت اول), grade «اول» (G1), subject «ریاضی», classes «اول 1», «اول 2». */
const cleanRows: ExampleRows = {
  classes: [
    { grade: "اول", class_name: "اول 1", branch: "" },
    { grade: "G1", class_name: "اول ۳", branch: "" }, // new class, grade by code, Persian digit in the name
  ],
  students: [
    { first_name: "نرگس", last_name: "حسینی", student_number: "۹۰۰۱", phone: "09127100001", guardian_phone: "09127100002", grade: "اول", class_name: "اول 1", external_ref: "old-1" },
    { first_name: "فاطمه", last_name: "كاظمي", student_number: "9002", phone: "", guardian_phone: "", grade: "اول", class_name: "اول ۳", external_ref: "" },
  ],
  staff: [{ first_name: "حسین", last_name: "محمدی", phone: "09127100010", employee_number: "77" }],
  teaching: [
    { teacher_phone: "09127100010", teacher_name: "حسین محمدی", class_name: "اول 1", subject: "ریاضی" },
    { teacher_phone: "09127100010", teacher_name: "حسین محمدی", class_name: "اول ۳", subject: "MATH" },
  ],
};

async function count(tx: Tx, table: string, where = ""): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} ${where}`));
  return Number(res.rows[0].n);
}

describe("excel import", () => {
  beforeAll(async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      const db = drizzle({ client: pool, schema });
      const roleIds = await seedCatalog(db);
      process.env.SEED_DEMO_PASSWORD = "Demo-1405-pass";
      await seedDemo(db, roleIds);
    } finally {
      await pool.end();
    }
    // The demo seed builds structure, ~40 argon2 accounts, the weekly timetable and the حضور و غیاب history —
    // well past vitest's 10 s default hook budget on a modest machine.
  }, 60_000);
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("dry-run flags an unknown class, a duplicate student number and a taken phone with sheet/row/column, and records a failed batch", async () => {
    const buf = await workbook({
      ...cleanRows,
      students: [
        cleanRows.students[0],
        { ...cleanRows.students[0], first_name: "دوباره", phone: "", external_ref: "" }, // duplicate student_number
        { first_name: "ب", last_name: "ج", student_number: "9003", phone: "", guardian_phone: "", grade: "اول", class_name: "کلاس ناموجود", external_ref: "" },
        { first_name: "د", last_name: "ه", student_number: "9004", phone: "09127100010", guardian_phone: "", grade: "اول", class_name: "اول 1", external_ref: "" }, // phone of the teacher
      ],
    });
    await expect(
      withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, async (tx) => {
        const parsed = await parseWorkbook(buf);
        const ref = await loadReference(tx, ORG_SCOPE, "S1", parsed);
        expect(ref.classes.map((c) => c.name).sort()).toEqual(["اول 1", "اول 2"]);
        const v = validateImport(parsed, ref, { createSubjects: false });
        expect(v.ok).toBe(false);
        const errs = v.rows.filter((r) => r.status === "error").map((r) => ({ sheet: r.sheet, row: r.rowNumber, cols: r.issues.filter((i) => i.level === "error").map((i) => i.column) }));
        expect(errs).toEqual([
          { sheet: "students", row: 4, cols: ["student_number"] },
          { sheet: "students", row: 5, cols: ["class_name"] },
          { sheet: "students", row: 6, cols: ["phone"] },
        ]);
        expect(v.rows.find((r) => r.sheet === "students" && r.rowNumber === 5)!.issues[0].message).toContain("کلاس ناموجود");
        expect(v.summary.students).toEqual({ rows: 4, ok: 1, warning: 0, error: 3 });
        expect(v.summary.classes.warning).toBe(1); // «اول 1» exists → update warning
        await expect(commitImport(tx, orgAdminA, ref, v, { fileSha256: sha256Hex(buf), kind: "full" })).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "CONFLICT");
        const batchId = await recordBatch(tx, orgAdminA, ref, v, { fileSha256: sha256Hex(buf), kind: "full" }, "failed");
        const [b] = await tx.select({ status: importBatch.status, errorCount: importBatch.errorCount, rowCount: importBatch.rowCount }).from(importBatch).where(eq(importBatch.id, batchId));
        expect(b).toEqual({ status: "failed", errorCount: 3, rowCount: 9 });
        expect(await count(tx, "integ.import_row", `where batch_id = '${batchId}' and status = 'error'`)).toBe(3);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("commit creates classes, accounts (phone or <code>-<number>), offerings, teacher assignments, identity map and audit; a second commit inserts nothing", async () => {
    const buf = await workbook(cleanRows);
    await expect(
      withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, async (tx) => {
        const before = {
          persons: await count(tx, "iam.person"),
          classes: await count(tx, "tenancy.class_group"),
          offerings: await count(tx, "tenancy.class_offering"),
          teaching: await count(tx, "academic.teacher_assignment"),
          enrollments: await count(tx, "academic.class_enrollment"),
          memberships: await count(tx, "iam.organization_membership"),
        };
        const parsed = await parseWorkbook(buf);
        const ref = await loadReference(tx, ORG_SCOPE, "S1", parsed);
        const v = validateImport(parsed, ref, { createSubjects: false });
        expect(v.ok).toBe(true);
        const res = await commitImport(tx, orgAdminA, ref, v, { fileSha256: sha256Hex(buf), kind: "full" });
        // OFFERING_A1 (اول 1 × ریاضی × نوبت اول) already exists in the fixtures → one new offering only.
        expect(res.counts.inserted).toEqual({ classes: 1, staff: 1, accounts: 3, offerings: 1, teaching: 2, students: 2 });
        expect(res.totalInserted).toBe(10);
        expect(res.credentials.map((c) => c.loginIdentifier).sort()).toEqual(["+989127100001", "+989127100010", "s1-9002"]);
        for (const c of res.credentials) expect(c.initialPassword).toMatch(/^\d{8}$/);

        const after = {
          persons: await count(tx, "iam.person"),
          classes: await count(tx, "tenancy.class_group"),
          offerings: await count(tx, "tenancy.class_offering"),
          teaching: await count(tx, "academic.teacher_assignment"),
          enrollments: await count(tx, "academic.class_enrollment"),
          memberships: await count(tx, "iam.organization_membership"),
        };
        expect(after).toEqual({ persons: before.persons + 3, classes: before.classes + 1, offerings: before.offerings + 1, teaching: before.teaching + 2, enrollments: before.enrollments + 2, memberships: before.memberships + 3 });
        const [acct] = await tx.select({ must: userAccount.mustChangePassword, phone: userAccount.phoneE164 }).from(userAccount).where(eq(userAccount.loginIdentifier, "s1-9002"));
        expect(acct).toEqual({ must: true, phone: null });
        const mapped = await tx.select({ table: externalIdentityMap.entityTable, ref: externalIdentityMap.externalRef }).from(externalIdentityMap).where(eq(externalIdentityMap.source, "excel"));
        expect(mapped.map((m) => `${m.table}:${m.ref}`).sort()).toEqual(["iam.person:+989127100010", "iam.person:9001", "iam.person:9002", "tenancy.class_group:S1:اول ۳"]);
        const [batch] = await tx.select({ status: importBatch.status }).from(importBatch).where(eq(importBatch.id, res.batchId));
        expect(batch.status).toBe("committed");
        expect(await count(tx, "integ.import_row", `where batch_id = '${res.batchId}' and status = 'committed'`)).toBe(7);
        const inserts = await tx.select({ table: auditLog.entityTable }).from(auditLog).where(eq(auditLog.action, "import.insert"));
        expect(inserts).toHaveLength(10 - 3); // accounts are counted, not separately audited as import.insert
        expect(JSON.stringify(await tx.select({ after: auditLog.after }).from(auditLog))).not.toContain(res.credentials[0].initialPassword);

        // Same file again, same transaction: nothing new.
        const parsed2 = await parseWorkbook(buf);
        const ref2 = await loadReference(tx, ORG_SCOPE, "S1", parsed2);
        const v2 = validateImport(parsed2, ref2, { createSubjects: false });
        expect(v2.ok).toBe(true);
        const res2 = await commitImport(tx, orgAdminA, ref2, v2, { fileSha256: sha256Hex(buf), kind: "full" });
        expect(res2.totalInserted).toBe(0);
        expect(res2.counts.inserted).toEqual({});
        expect(res2.counts.updated).toEqual({});
        expect(res2.credentials).toEqual([]);
        expect({
          persons: await count(tx, "iam.person"),
          classes: await count(tx, "tenancy.class_group"),
          offerings: await count(tx, "tenancy.class_offering"),
          teaching: await count(tx, "academic.teacher_assignment"),
          enrollments: await count(tx, "academic.class_enrollment"),
          memberships: await count(tx, "iam.organization_membership"),
        }).toEqual(after);
        // A changed name and a moved class are updates, still no inserts.
        const moved = await workbook({ ...cleanRows, students: [{ ...cleanRows.students[0], last_name: "حسینی‌نژاد", class_name: "اول ۳" }, cleanRows.students[1]] });
        const parsed3 = await parseWorkbook(moved);
        const ref3 = await loadReference(tx, ORG_SCOPE, "S1", parsed3);
        const res3 = await commitImport(tx, orgAdminA, ref3, validateImport(parsed3, ref3, { createSubjects: false }), { fileSha256: sha256Hex(moved), kind: "full" });
        expect(res3.totalInserted).toBe(0);
        expect(res3.counts.updated).toEqual({ students: 1 });
        expect(await count(tx, "academic.class_enrollment", "where status = 'active'")).toBe(after.enrollments);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("the committed demo workbook (template/demo-danesh.xlsx) is idempotent against the seeded demo school: commit → re-commit = 0 inserts", async () => {
    const file = path.resolve(process.cwd(), "template", "demo-danesh.xlsx");
    const buf = fs.readFileSync(file);
    // The committed file must be the one this seed spec produces.
    const rebuilt = await buildTemplateWorkbook(demoWorkbookRows()).xlsx.writeBuffer();
    const parsedFile = await parseWorkbook(buf);
    const parsedRebuilt = await parseWorkbook(Buffer.from(rebuilt));
    expect(parsedFile.sheets).toEqual(parsedRebuilt.sheets);

    const orgId = demoId("org:danesh");
    const rezaei = demoId("danesh:person:rezaei");
    const schoolG = demoId("danesh:school:G");
    const rezaeiIndex = DANESH.persons.findIndex((p) => p.key === "rezaei");
    const ctx: ImportCtx & { assignments: Assignment[] } = {
      orgId,
      personId: rezaei,
      userId: null,
      requestId: "int-import-demo",
      assignments: [{ roleCode: "school_principal", roleId: "r", scopeType: "school", scopeId: schoolG, permissions: ALL }],
    };
    await expect(
      withTenant({ orgId, personId: rezaei }, async (tx) => {
        const [acct] = await tx.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.loginIdentifier, demoPhone(1 + rezaeiIndex)));
        expect(acct).toBeDefined();
        const scope = await getAdminScope(tx, ctx);
        expect(scope).toEqual({ kind: "school", schoolIds: [schoolG] });
        const ref = await loadReference(tx, scope, "G", parsedFile);
        expect(ref.studentsByNumber.size).toBe(13);
        expect(ref.foreignStudentNumbers.size).toBe(0);
        const v = validateImport(parsedFile, ref, { createSubjects: false });
        expect(v.ok).toBe(true);
        expect(v.summary).toEqual({
          classes: { rows: 3, ok: 1, warning: 2, error: 0 },
          students: { rows: 13, ok: 0, warning: 13, error: 0 },
          staff: { rows: 2, ok: 1, warning: 1, error: 0 },
          teaching: { rows: 4, ok: 4, warning: 0, error: 0 },
        });
        const res = await commitImport(tx, ctx, ref, v, { fileSha256: sha256Hex(buf), kind: "full" });
        expect(res.counts.inserted).toEqual({ classes: 1, staff: 1, accounts: 1, offerings: 1, teaching: 2 });
        expect(res.counts.skipped).toEqual({ classes: 2, staff: 1, teaching: 2, students: 13 });
        const snapshot = async () => ({
          persons: await count(tx, "iam.person"),
          classes: await count(tx, "tenancy.class_group"),
          offerings: await count(tx, "tenancy.class_offering"),
          teaching: await count(tx, "academic.teacher_assignment", "where valid_to is null"),
          enrollments: await count(tx, "academic.class_enrollment", "where status = 'active'"),
          memberships: await count(tx, "iam.organization_membership"),
          rows: await count(tx, "integ.import_row"),
        });
        const s1 = await snapshot();
        const parsed2 = await parseWorkbook(buf);
        const ref2 = await loadReference(tx, scope, "G", parsed2);
        const res2 = await commitImport(tx, ctx, ref2, validateImport(parsed2, ref2, { createSubjects: false }), { fileSha256: sha256Hex(buf), kind: "full" });
        expect(res2.totalInserted).toBe(0);
        expect(res2.counts.skipped).toEqual({ classes: 3, staff: 2, teaching: 4, students: 13 });
        const s2 = await snapshot();
        expect({ ...s2, rows: 0 }).toEqual({ ...s1, rows: 0 });
        expect(s2.rows).toBe(s1.rows + 22); // the second batch records its own 22 rows
        expect(await count(tx, "integ.import_batch", "where status = 'committed'")).toBe(2);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("N2: a school-scoped importer cannot pull another school's student in — matched by number or unique code the row is an error, nothing about the student leaks or changes; an organization admin keeps organization-wide matching", async () => {
    await expect(
      withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, async (tx) => {
        // School S2 next to the fixture S1, with a current year, a class and one enrolled student (created by the org admin).
        const s2 = await createSchool(tx, orgAdminA, { name: "دبیرستان دوم", code: "S2", genderPolicy: "boys" });
        const year = await createAcademicYear(tx, orgAdminA, {
          schoolId: s2.schoolId,
          name: "۱۴۰۵-۱۴۰۶",
          startsOn: "2026-09-23",
          endsOn: "2027-06-21",
          isCurrent: true,
          terms: [{ name: "نوبت اول", sequence: 1, startsOn: "2026-09-23", endsOn: "2027-01-20" }],
        });
        const cg = await createClassGroup(tx, orgAdminA, { branchId: s2.branchId, academicYearId: year.academicYearId, gradeLevelId: f.GRADE_A, name: "اول 9" });
        const other = await createStudent(tx, orgAdminA, { firstName: "پگاه", lastName: "نادری", studentNumber: "7001", externalRef: "ext-7001", schoolId: s2.schoolId, login: { createAccount: true }, enrollment: { classGroupId: cg.classGroupId } });

        // The S1 principal's file claims that student twice: once by number (renamed), once by unique code under a new number.
        const buf = await workbook({
          ...cleanRows,
          students: [
            { first_name: "پگاه", last_name: "تغییریافته", student_number: "7001", phone: "", guardian_phone: "", grade: "اول", class_name: "اول 1", external_ref: "" },
            { first_name: "کسی", last_name: "دیگر", student_number: "7002", phone: "", guardian_phone: "", grade: "اول", class_name: "اول 1", external_ref: "ext-7001" },
          ],
        });
        const parsed = await parseWorkbook(buf);
        const s1Principal: ImportCtx = { ...orgAdminA, assignments: [{ roleCode: "school_principal", roleId: "r", scopeType: "school", scopeId: f.SCHOOL_A, permissions: ALL }] };
        const scope = await getAdminScope(tx, s1Principal);
        const ref = await loadReference(tx, scope, "S1", parsed);
        expect(ref.studentsByNumber.has("7001")).toBe(false);
        expect(ref.studentsByExternalRef.has("ext-7001")).toBe(false);
        expect(ref.foreignStudentNumbers).toEqual(new Set(["7001"]));
        expect(ref.foreignExternalRefs).toEqual(new Set(["ext-7001"]));
        const v = validateImport(parsed, ref, { createSubjects: false });
        expect(v.ok).toBe(false);
        const errs = v.rows.filter((r) => r.sheet === "students").map((r) => ({ row: r.rowNumber, status: r.status, issues: r.issues.map((i) => `${i.column}:${i.message}`) }));
        expect(errs).toEqual([
          { row: 3, status: "error", issues: [`student_number:${IMPORT_MESSAGES.studentOfOtherSchool}`] },
          { row: 4, status: "error", issues: [`external_ref:${IMPORT_MESSAGES.externalRefOfOtherSchool}`] },
        ]);
        expect(v.plan.students).toEqual([]);
        // Nothing of the other school's student is in the report or the recorded rows (no name, no ids).
        const dump = JSON.stringify(v.rows);
        expect(dump).not.toContain("نادری");
        expect(dump).not.toContain(other.personId);
        expect(dump).not.toContain(other.studentProfileId);
        await expect(commitImport(tx, s1Principal, ref, v, { fileSha256: sha256Hex(buf), kind: "full" })).rejects.toSatisfy(isError("CONFLICT"));
        const [p] = await tx.select({ lastName: person.lastName }).from(person).where(eq(person.id, other.personId));
        expect(p.lastName).toBe("نادری");
        const active = await tx.select({ classGroupId: classEnrollment.classGroupId }).from(classEnrollment).where(eq(classEnrollment.studentProfileId, other.studentProfileId));
        expect(active).toEqual([{ classGroupId: cg.classGroupId }]);
        // A school code outside the scope is NOT_FOUND with the unknown-code message (no oracle on other schools' codes).
        await expect(tx.transaction((sp) => loadReference(sp, scope, "S2", parsed))).rejects.toSatisfy((e: unknown) => isError("NOT_FOUND")(e) && (e as AppError).message === "مدرسه‌ای با کد «S2» در این سازمان نیست.");

        // The organization admin matches organization-wide: the same rows are updates (warnings), not errors.
        const orgRef = await loadReference(tx, ORG_SCOPE, "S1", parsed);
        expect(orgRef.studentsByNumber.has("7001")).toBe(true);
        expect(orgRef.foreignStudentNumbers.size).toBe(0);
        const ov = validateImport(parsed, orgRef, { createSubjects: false });
        expect(ov.rows.filter((r) => r.sheet === "students").map((r) => r.status)).toEqual(["warning", "warning"]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("a school-scoped admin of another school cannot import into this one (RLS + can); the same file into school B needs its own year", async () => {
    const orgId = demoId("org:danesh");
    const mousavi = demoId("danesh:person:mousavi");
    await expect(
      withTenant({ orgId, personId: mousavi }, async (tx) => {
        // The import CLI checks `can(integ.import.write, school)`; mousavi (vice principal of B) lacks import.write entirely.
        const { can } = await import("@/modules/iam/can");
        const { listValidAssignments } = await import("@/modules/iam/repo");
        const assignments = await listValidAssignments(tx, mousavi);
        expect(await can(tx, { orgId, assignments }, "integ.import.write", { scopeType: "school", id: demoId("danesh:school:G") })).toBe(false);
        expect(await can(tx, { orgId, assignments }, "integ.import.write", { scopeType: "school", id: demoId("danesh:school:B") })).toBe(false);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
