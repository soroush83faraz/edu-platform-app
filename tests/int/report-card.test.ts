// «کارنامهٴ توصیفی» (migration 0017; src/modules/academic/report-card.ts): saving a sheet (upsert — a second save of
// the same levels writes nothing, a changed level updates the row, `null` clears it, every change audited), the
// scope rule (any teacher of an open offering of the class READS the whole class, but WRITES only the درس‌ها they
// teach there and those the class has no offering of — management writes every درس; a teacher of ANOTHER class and
// the principal of ANOTHER school are NOT_FOUND; a student reads only their own card), validation (an objective of
// another درس, a student outside the roster), the per-month overview and the tenant boundary (RLS).
//
// The fixture organisation has no objectives, and app_rw may not write them (seed-managed), so beforeAll inserts
// three as app_owner for پایهٔ اول / مهر and afterAll removes them; every other write happens inside a withTenant
// transaction that ends with Rollback.
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import { auditLog, objectiveRating } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { REPORT_CARD_MESSAGES, classReportCards, classReportOverview, getRatingSheet, listRatableClasses, myReportCard, saveObjectiveRatings, type ReportCtx } from "@/modules/academic/report-card";
import { assignTeacher, enrollStudent } from "@/modules/academic/service";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { createStaff } from "@/modules/iam/service";
import { createClassOffering, createSubject } from "@/modules/tenancy/service";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const RATE = ["academic.objective_rating.read", "academic.objective_rating.write"];
const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const principalOf = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: ["iam.admin.access", ...RATE] });
const teacherOf = (offeringId: string): Assignment => ({ roleCode: "teacher", roleId: "r-teacher", scopeType: "class_offering", scopeId: offeringId, permissions: ["workspace.work_item.read", ...RATE] });
const studentRole = (profileId: string): Assignment => ({ roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: ["academic.objective_rating.read"] });

const ctxOf = (orgId: string, personId: string, assignments: Assignment[]): ReportCtx => ({ orgId, personId, userId: null, requestId: "int-test", assignments });
const admin = ctxOf(f.ORG_A, f.PERSON_A2, [orgAdmin]);
const principal = ctxOf(f.ORG_A, f.PERSON_A2, [principalOf(f.SCHOOL_A)]);
const principalElsewhere = ctxOf(f.ORG_A, f.PERSON_A2, [principalOf(f.SCHOOL_B)]);
const teacher = ctxOf(f.ORG_A, f.PERSON_A2, [teacherOf(f.OFFERING_A1)]);
const student = ctxOf(f.ORG_A, f.PERSON_A1, [studentRole(f.STUDENT_A1)]);
const otherOrg = ctxOf(f.ORG_B, f.PERSON_B1, [{ roleCode: "org_admin", roleId: "r-b", scopeType: "organization", scopeId: f.ORG_B, permissions: ALL }]);

const isCode = (code: string, message?: string) => (err: unknown) => AppError.is(err) && err.code === code && (message === undefined || err.message === message);
const NOW = new Date("2026-10-13T08:00:00Z"); // ۲۱ مهر ۱۴۰۵
const MONTH = 7;

const OBJ_MATH_1 = "0199a000-00aa-7000-8000-0000000000a1";
const OBJ_MATH_2 = "0199a000-00aa-7000-8000-0000000000a2";
const OBJ_QURAN_1 = "0199a000-00aa-7000-8000-0000000000a3";

async function owner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await owner(async (c) => {
    const rows: Array<[string, string, number, string, string | null]> = [
      [OBJ_MATH_1, "ریاضی", 1, "عددهای یک تا پنج را می‌شناسد", "knowledge"],
      [OBJ_MATH_2, "ریاضی", 2, "تا عدد پنج شمارش می‌کند", "application"],
      [OBJ_QURAN_1, "قرآن", 1, "سوره‌ی توحید را می‌خواند", null],
    ];
    for (const [id, subject, order, text, domain] of rows) {
      await c.query(
        "insert into academic.learning_objective (id, organization_id, grade_level_id, month, subject_name, subject_id, domain, text, sort_order) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [id, f.ORG_A, f.GRADE_A, MONTH, subject, subject === "ریاضی" ? f.SUBJECT_A : null, domain, text, order],
      );
    }
  });
});

afterAll(async () => {
  await owner(async (c) => {
    await c.query("delete from academic.objective_rating where learning_objective_id = any($1::uuid[])", [[OBJ_MATH_1, OBJ_MATH_2, OBJ_QURAN_1]]);
    await c.query("delete from academic.learning_objective where id = any($1::uuid[])", [[OBJ_MATH_1, OBJ_MATH_2, OBJ_QURAN_1]]);
  });
});

async function rolledBack(fn: (tx: Tx) => Promise<void>, tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 }): Promise<void> {
  try {
    await withTenant(tenant, async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  throw new Error("expected the transaction to roll back");
}

/** The student in class A1 and the teacher on its one offering. */
async function setUpClass(tx: Tx): Promise<void> {
  await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
  await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
}

const sheet = { classGroupId: f.CLASS_GROUP_A1, month: MONTH, subjectName: "ریاضی" };
const both = (a: "very_good" | "good" | "acceptable" | "needs_effort" | null, b: typeof a) => ({
  ...sheet,
  entries: [
    { studentProfileId: f.STUDENT_A1, learningObjectiveId: OBJ_MATH_1, rating: a },
    { studentProfileId: f.STUDENT_A1, learningObjectiveId: OBJ_MATH_2, rating: b },
  ],
});

describe("saveObjectiveRatings", () => {
  it("the class's teacher saves a sheet; the same save again writes nothing; a change updates, null clears — all audited", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const first = await saveObjectiveRatings(tx, teacher, both("very_good", "good"));
      expect(first).toEqual({ set: 2, cleared: 0, unchanged: 0, complete: 1, students: 1 });
      const again = await saveObjectiveRatings(tx, teacher, both("very_good", "good"));
      expect(again).toMatchObject({ set: 0, cleared: 0, unchanged: 2 });
      const rows = await tx.select({ id: objectiveRating.id, rating: objectiveRating.rating, ratedBy: objectiveRating.ratedByPersonId, year: objectiveRating.academicYearId }).from(objectiveRating).where(eq(objectiveRating.studentProfileId, f.STUDENT_A1));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.ratedBy === f.PERSON_A2 && r.year === f.YEAR_A)).toBe(true);

      const changed = await saveObjectiveRatings(tx, principal, both("acceptable", null));
      expect(changed).toEqual({ set: 1, cleared: 1, unchanged: 0, complete: 0, students: 1 });
      const after = await tx.select({ id: objectiveRating.id, objective: objectiveRating.learningObjectiveId, rating: objectiveRating.rating }).from(objectiveRating).where(eq(objectiveRating.studentProfileId, f.STUDENT_A1));
      expect(after).toEqual([{ id: rows.find((r) => r.rating === "very_good")!.id, objective: OBJ_MATH_1, rating: "acceptable" }]);

      const audits = await tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "academic.objective_rating.saved"), eq(auditLog.entityTable, "objective_rating")));
      expect(audits).toHaveLength(2); // the no-op save wrote none
      expect(audits.map((a) => a.after)).toContainEqual(expect.objectContaining({ classGroupId: f.CLASS_GROUP_A1, month: MONTH, subjectName: "ریاضی", set: 1, cleared: 1 }));
    });
  });

  it("refuses an objective of another درس and a student outside the roster", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await expect(saveObjectiveRatings(tx, teacher, { ...sheet, entries: [{ studentProfileId: f.STUDENT_A1, learningObjectiveId: OBJ_QURAN_1, rating: "good" }] })).rejects.toSatisfy(isCode("VALIDATION"));
      await expect(saveObjectiveRatings(tx, teacher, { ...sheet, subjectName: "هنر", entries: [{ studentProfileId: f.STUDENT_A1, learningObjectiveId: OBJ_MATH_1, rating: "good" }] })).rejects.toSatisfy(isCode("VALIDATION"));
    });
    await rolledBack(async (tx) => {
      // Not enrolled: the student is in no roster yet.
      await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
      await expect(saveObjectiveRatings(tx, teacher, both("good", "good"))).rejects.toSatisfy(isCode("VALIDATION"));
    });
  });

  it("a teacher of another class, the principal of another school and another tenant get NOT_FOUND — nothing written", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await expect(saveObjectiveRatings(tx, teacher, { ...both("good", "good"), classGroupId: f.CLASS_GROUP_A2 })).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(saveObjectiveRatings(tx, principalElsewhere, both("good", "good"))).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(saveObjectiveRatings(tx, student, both("good", "good"))).rejects.toSatisfy(isCode("NOT_FOUND"));
      expect(await tx.select({ id: objectiveRating.id }).from(objectiveRating)).toEqual([]);
    });
    await rolledBack(
      async (tx) => {
        await expect(saveObjectiveRatings(tx, otherOrg, both("good", "good"))).rejects.toSatisfy(isCode("NOT_FOUND"));
      },
      { orgId: f.ORG_B, personId: f.PERSON_B1 },
    );
  });
});

describe("who writes which درس (owner, 2026-10-14)", () => {
  const quranSheet = { classGroupId: f.CLASS_GROUP_A1, month: MONTH, subjectName: "قرآن" };
  const quran = (rating: "very_good" | "good" | "acceptable" | "needs_effort" | null) => ({
    ...quranSheet,
    entries: [{ studentProfileId: f.STUDENT_A1, learningObjectiveId: OBJ_QURAN_1, rating }],
  });
  const notYours = isCode("FORBIDDEN", REPORT_CARD_MESSAGES.notYourSubject);

  it("a teacher writes the درس they teach in the class and a درس no offering carries — never another teacher's درس; management writes every درس", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx); // the ریاضی teacher of class A1 (OFFERING_A1)
      // The class has no قرآن offering yet (like «شایستگی‌های عمومی»): any of its teachers writes it.
      expect((await getRatingSheet(tx, teacher, quranSheet)).canWrite).toBe(true);
      expect(await saveObjectiveRatings(tx, teacher, quran("good"))).toMatchObject({ set: 1 });

      // Now قرآن gets its own offering — a درس row named by an alias («آموزش قرآن»), the objectives link none — and
      // its own teacher (the reviewer's case: the ورزش teacher of the class).
      const qs = await createSubject(tx, admin, { name: "آموزش قرآن", code: "QRN" });
      const qo = await createClassOffering(tx, admin, { classGroupId: f.CLASS_GROUP_A1, subjectId: qs.subjectId, termId: f.TERM_A });
      const qt = await createStaff(tx, admin, { firstName: "زینب", lastName: "قرآنی", phone: "09127400300", createAccount: false, schoolId: f.SCHOOL_A });
      await assignTeacher(tx, admin, { staffProfileId: qt.staffProfileId, classOfferingId: qo.classOfferingId });
      const quranTeacher = ctxOf(f.ORG_A, qt.personId, [teacherOf(qo.classOfferingId)]);

      // The ریاضی teacher still READS قرآن, but writes it no more.
      const readOnly = await getRatingSheet(tx, teacher, quranSheet);
      expect(readOnly).toMatchObject({ canWrite: false, writesOtherSubjects: true });
      expect(readOnly.rows[0].ratings).toEqual({ [OBJ_QURAN_1]: "good" });
      await expect(saveObjectiveRatings(tx, teacher, quran("very_good"))).rejects.toSatisfy(notYours);
      // The قرآن teacher writes قرآن, reads ریاضی, and never overwrites it.
      expect(await saveObjectiveRatings(tx, quranTeacher, quran("very_good"))).toMatchObject({ set: 1 });
      expect(await getRatingSheet(tx, quranTeacher, sheet)).toMatchObject({ canWrite: false, writesOtherSubjects: true });
      await expect(saveObjectiveRatings(tx, quranTeacher, both("needs_effort", "needs_effort"))).rejects.toSatisfy(notYours);
      // The class page marks each درس.
      const subjectsOf = async (who: ReportCtx) => (await classReportOverview(tx, who, { classGroupId: f.CLASS_GROUP_A1, month: MONTH }, NOW)).subjects.map((x) => [x.name, x.canWrite]);
      expect(await subjectsOf(teacher)).toEqual([
        ["قرآن", false],
        ["ریاضی", true],
      ]);
      expect(await subjectsOf(quranTeacher)).toEqual([
        ["قرآن", true],
        ["ریاضی", false],
      ]);
      // Management (principal, organization admin) writes every درس.
      for (const mgr of [principal, admin]) {
        expect(await subjectsOf(mgr)).toEqual([
          ["قرآن", true],
          ["ریاضی", true],
        ]);
      }
      expect(await saveObjectiveRatings(tx, principal, quran("acceptable"))).toMatchObject({ set: 1 });
      expect(await saveObjectiveRatings(tx, principal, both("good", "good"))).toMatchObject({ set: 2 });
      // The refused saves wrote nothing: every level is the last allowed writer's.
      const rows = await tx.select({ objective: objectiveRating.learningObjectiveId, rating: objectiveRating.rating }).from(objectiveRating).where(eq(objectiveRating.studentProfileId, f.STUDENT_A1));
      expect(Object.fromEntries(rows.map((r) => [r.objective, r.rating]))).toEqual({ [OBJ_QURAN_1]: "acceptable", [OBJ_MATH_1]: "good", [OBJ_MATH_2]: "good" });
      const audits = await tx.select({ by: auditLog.actorPersonId }).from(auditLog).where(eq(auditLog.action, "academic.objective_rating.saved"));
      expect(audits).toHaveLength(4);
    });
  });
});

describe("reading report cards", () => {
  it("the sheet, the month overview and the printable cards show the saved levels", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveObjectiveRatings(tx, teacher, both("very_good", "needs_effort"));
      const s = await getRatingSheet(tx, teacher, sheet);
      expect(s.objectives.map((o) => o.id)).toEqual([OBJ_MATH_1, OBJ_MATH_2]);
      expect(s.rows).toEqual([expect.objectContaining({ studentProfileId: f.STUDENT_A1, ratings: { [OBJ_MATH_1]: "very_good", [OBJ_MATH_2]: "needs_effort" } })]);
      expect(s).toMatchObject({ complete: 1, canWrite: true, subjectId: f.SUBJECT_A });

      const o = await classReportOverview(tx, principal, { classGroupId: f.CLASS_GROUP_A1 }, NOW);
      expect(o.month).toBe(MONTH);
      expect(o.months).toEqual([MONTH]);
      expect(o.subjects.map((x) => [x.name, x.objectives, x.complete])).toEqual([
        ["قرآن", 1, 0],
        ["ریاضی", 2, 1],
      ]);
      expect(o.students[0]).toMatchObject({ counts: { very_good: 1, good: 0, acceptable: 0, needs_effort: 1 }, missing: 1 });

      const cards = await classReportCards(tx, admin, { classGroupId: f.CLASS_GROUP_A1, month: MONTH }, NOW);
      expect(cards.cards).toHaveLength(1);
      expect(cards.cards[0].subjects.find((x) => x.name === "ریاضی")!.objectives.map((x) => x.rating)).toEqual(["very_good", "needs_effort"]);

      const classes = await listRatableClasses(tx, teacher);
      expect(classes.map((c) => [c.id, c.canWrite])).toEqual([[f.CLASS_GROUP_A1, true]]);
      expect(await listRatableClasses(tx, student)).toEqual([]);
    });
  });

  it("a student reads only their own card; staff of another class or school do not see the class", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveObjectiveRatings(tx, teacher, both("good", "acceptable"));
      const mine = await myReportCard(tx, student, {}, NOW);
      expect(mine?.studentProfileId).toBe(f.STUDENT_A1);
      expect(mine?.counts).toEqual({ very_good: 0, good: 1, acceptable: 1, needs_effort: 0 });
      // Someone else's student role does not open this card, and the admin is not a student at all.
      expect(await myReportCard(tx, ctxOf(f.ORG_A, f.PERSON_A1, [studentRole("0199a000-000d-7000-8000-0000000000ff")]), {}, NOW)).toBeNull();
      expect(await myReportCard(tx, admin, {}, NOW)).toBeNull();
      await expect(getRatingSheet(tx, student, sheet)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(classReportOverview(tx, principalElsewhere, { classGroupId: f.CLASS_GROUP_A1 }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(classReportCards(tx, teacher, { classGroupId: f.CLASS_GROUP_A2, month: MONTH }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });
});

describe("RLS", () => {
  it("another tenant sees neither the objectives nor the ratings, and cannot write a rating into ORG_A", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_B]);
        const seen = await c.query<{ n: number }>("select count(*)::int as n from academic.learning_objective");
        expect(seen.rows[0].n).toBe(0);
        const err = await c
          .query("insert into academic.objective_rating (id, organization_id, academic_year_id, student_profile_id, learning_objective_id, rating, rated_by_person_id) values (app.uuid_generate_v7(), $1, $2, $3, $4, 'good', $5)", [
            f.ORG_A,
            f.YEAR_A,
            f.STUDENT_A1,
            OBJ_MATH_1,
            f.PERSON_A2,
          ])
          .catch((e: unknown) => e);
        expect(pgCode(err)).toBe(PG.INSUFFICIENT_PRIVILEGE);
      });
    });
  });
});
