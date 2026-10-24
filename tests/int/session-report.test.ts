// «دفتر کلاسی — گزارش جلسه» (migration 0027): saving the end-of-session report and saving it again (ONE row, updated),
// the scope rule mirrored from the roll call (the teacher of the زنگ's درس and the school's admins write; a teacher of
// another class, an admin of another school and another tenant are NOT_FOUND), the date rule (never the future), the
// تکلیف link (of THIS درس, the caller's own — or any for an admin), the privacy of «یادداشت دبیر» (a student's read has
// no such field), the soft clear, the audit rows (ids and lengths, never the text) and the DELETE policy of app_rw.
// Every write happens inside a withTenant transaction that ends with Rollback, so other files' fixture counts stay intact.
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import { auditLog, sessionReport, workItem } from "@/db/schema";
import { addDaysIso, tehranToday, weekdayOfIso } from "@/lib/attendance";
import { AppError } from "@/lib/errors";
import { DEFAULT_PERIODS } from "@/lib/timetable";
import type { AttendanceCtx } from "@/modules/academic/attendance";
import { assignTeacher, enrollStudent, setTimetableSlot } from "@/modules/academic/service";
import { clearSessionReport, getSessionReportCell, listOfferingSessionReports, saveSessionReport } from "@/modules/academic/session-report";
import { hasPrivateNote } from "@/lib/session-report";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { setSchoolPeriods } from "@/modules/tenancy/service";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const VICE_PERMS = ["iam.admin.access", "academic.timetable.read", "academic.timetable.write", "academic.attendance.read", "academic.attendance.write", "academic.session_report.write"];
const TEACHER_PERMS = ["workspace.work_item.read", "academic.timetable.read", "academic.attendance.read", "academic.attendance.write", "academic.session_report.write"];
const STUDENT_PERMS = ["workspace.work_item.read", "academic.timetable.read", "academic.attendance.read"];

const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: VICE_PERMS });
const teacherOf = (offeringId: string): Assignment => ({ roleCode: "teacher", roleId: "r-teacher", scopeType: "class_offering", scopeId: offeringId, permissions: TEACHER_PERMS });
const studentRole = (profileId: string): Assignment => ({ roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: profileId, permissions: STUDENT_PERMS });

const ctxOf = (orgId: string, personId: string, assignments: Assignment[]): AttendanceCtx => ({ orgId, personId, userId: null, requestId: "int-test", assignments });
const admin = ctxOf(f.ORG_A, f.PERSON_A2, [orgAdmin]);
const vice = ctxOf(f.ORG_A, f.PERSON_A2, [viceOf(f.SCHOOL_A)]);
const OUTSIDER = "0199a000-00f9-7000-8000-0000000000cc";
const viceElsewhere = ctxOf(f.ORG_A, OUTSIDER, [viceOf(f.SCHOOL_B)]);
/** The teacher of the fixture offering (PERSON_A2 is STAFF_A2's person). */
const teacher = ctxOf(f.ORG_A, f.PERSON_A2, [teacherOf(f.OFFERING_A1)]);
/** A teacher whose only درس is some OTHER offering: nothing of class A1. */
const teacherOfElse = ctxOf(f.ORG_A, OUTSIDER, [teacherOf("0199a000-000c-7000-8000-0000000000ee")]);
const student = ctxOf(f.ORG_A, f.PERSON_A1, [studentRole(f.STUDENT_A1)]);
const otherOrg = ctxOf(f.ORG_B, f.PERSON_B1, [{ roleCode: "org_admin", roleId: "r-b", scopeType: "organization", scopeId: f.ORG_B, permissions: ALL }]);

const isCode = (code: string) => (err: unknown) => AppError.is(err) && err.code === code;
const isValidation = (message: string) => (err: unknown) => AppError.is(err) && err.code === "VALIDATION" && err.message === message;

const NOW = new Date("2026-09-22T08:35:00Z"); // سه‌شنبه ۱۴۰۵/۰۶/۳۱, 12:05 Tehran
const TODAY = tehranToday(NOW);
const YESTERDAY = addDaysIso(TODAY, -1);
const TOMORROW = addDaysIso(TODAY, 1);
const PERIOD = 2;

const TOPIC = "ضرب کسرهای متفاوت‌مخرج";
const NOTE = "علی‌اکبر امروز خسته بود و حوصلهٔ تمرین نداشت";
const PLAN = "بخش تقسیم کسرها را بخوانند";

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

/** The minimum a session needs: زنگ‌بندی, an enrolled student, the teacher of the درس, the درس at زنگ ۲ on both days. */
async function setUpClass(tx: Tx): Promise<void> {
  await setSchoolPeriods(tx, admin, f.SCHOOL_A, DEFAULT_PERIODS.map((p) => ({ ...p })));
  await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
  await assignTeacher(tx, admin, { staffProfileId: f.STAFF_A2, classOfferingId: f.OFFERING_A1 });
  for (const iso of [TODAY, YESTERDAY]) {
    await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: weekdayOfIso(iso)!, periodNo: PERIOD, classOfferingId: f.OFFERING_A1 });
  }
}

async function newWorkItem(tx: Tx, createdBy: string, opts: { offering?: string | null; confidential?: boolean } = {}): Promise<string> {
  const [row] = await tx
    .insert(workItem)
    .values({
      organizationId: f.ORG_A,
      typeId: f.WIT_TEMPLATE,
      statusId: f.WIS_OPEN,
      title: "تمرین کسرها",
      createdByPersonId: createdBy,
      classOfferingId: opts.offering === undefined ? f.OFFERING_A1 : opts.offering,
      isConfidential: opts.confidential ?? false,
    })
    .returning({ id: workItem.id });
  return row.id;
}

const cell = { classGroupId: f.CLASS_GROUP_A1, date: TODAY, periodNo: PERIOD };
const full = { ...cell, topic: TOPIC, pageRef: "فصل ۳", privateNote: NOTE, nextPlan: PLAN };

describe("saveSessionReport", () => {
  it("the teacher of the زنگ's درس writes it; writing again UPDATES the same row (one report per session)", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const first = await saveSessionReport(tx, teacher, full, NOW);
      expect(first.created).toBe(true);
      const again = await saveSessionReport(tx, teacher, { ...full, topic: "تقسیم کسرها", privateNote: null }, NOW);
      expect(again.created).toBe(false);
      expect(again.reportId).toBe(first.reportId);

      const rows = await tx
        .select({ id: sessionReport.id, offering: sessionReport.classOfferingId, topic: sessionReport.topic, note: sessionReport.privateNote, author: sessionReport.authorPersonId, status: sessionReport.status })
        .from(sessionReport)
        .where(eq(sessionReport.classGroupId, f.CLASS_GROUP_A1));
      expect(rows).toHaveLength(1);
      // The درس came from the weekly timetable and the author from the session, not from the client.
      expect(rows[0]).toMatchObject({ offering: f.OFFERING_A1, topic: "تقسیم کسرها", note: null, author: f.PERSON_A2, status: "active" });
    });
  });

  it("the database refuses a second row for the same session and درس (unique per class × date × زنگ × درس, migration 0031)", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveSessionReport(tx, teacher, full, NOW);
      await expect(
        tx.transaction((sp) =>
          sp.insert(sessionReport).values({
            organizationId: f.ORG_A,
            classGroupId: f.CLASS_GROUP_A1,
            classOfferingId: f.OFFERING_A1,
            date: TODAY,
            periodNo: PERIOD,
            topic: "تکراری",
            authorPersonId: f.PERSON_A2,
          }),
        ),
      ).rejects.toSatisfy((err: unknown) => pgCode(err) === "23505");
    });
  });

  it("a school admin (principal / vice / org admin) may write the report of any زنگ in their school", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const r = await saveSessionReport(tx, vice, { ...cell, topic: TOPIC }, NOW);
      expect(r.created).toBe(true);
      const byAdmin = await saveSessionReport(tx, admin, { ...cell, topic: "به‌دست مدیر سازمان" }, NOW);
      expect(byAdmin.reportId).toBe(r.reportId);
    });
  });

  it("scope: a teacher of another class, an admin of another school and another tenant are NOT_FOUND", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await expect(saveSessionReport(tx, teacherOfElse, { ...cell, topic: TOPIC }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(saveSessionReport(tx, viceElsewhere, { ...cell, topic: TOPIC }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      // CLASS_GROUP_A2 has no timetable cell of this teacher's درس.
      await expect(saveSessionReport(tx, teacher, { classGroupId: f.CLASS_GROUP_A2, date: TODAY, periodNo: PERIOD, topic: TOPIC }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      // A زنگ where the timetable has no درس of theirs: no offering scope → NOT_FOUND, like the roll call.
      await expect(saveSessionReport(tx, teacher, { ...cell, periodNo: 4, topic: TOPIC }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      expect(await tx.select({ id: sessionReport.id }).from(sessionReport)).toHaveLength(0);
    });
    await rolledBack(
      async (tx) => {
        await expect(saveSessionReport(tx, otherOrg, { ...cell, topic: TOPIC }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      },
      { orgId: f.ORG_B, personId: f.PERSON_B1 },
    );
  });

  it("a student cannot write (the permission is not theirs) — and the scope check agrees even if it were", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await expect(saveSessionReport(tx, student, { ...cell, topic: TOPIC }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });

  it("validation: a future date, an unknown زنگ, a زنگ with no درس (admin), an empty topic and over-long texts", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await expect(saveSessionReport(tx, admin, { ...cell, date: TOMORROW, topic: TOPIC }, NOW)).rejects.toSatisfy(isValidation("برای روز آینده نمی‌توان گزارش جلسه ثبت کرد."));
      await expect(saveSessionReport(tx, admin, { ...cell, date: "2026-02-31", topic: TOPIC }, NOW)).rejects.toSatisfy(isValidation("تاریخ نامعتبر است."));
      await expect(saveSessionReport(tx, admin, { ...cell, periodNo: 9, topic: TOPIC }, NOW)).rejects.toSatisfy(isValidation("این زنگ در برنامهٴ کلاسی مدرسه وجود ندارد."));
      await expect(saveSessionReport(tx, admin, { ...cell, periodNo: 4, topic: TOPIC }, NOW)).rejects.toSatisfy(isValidation("برای این زنگ درسی در برنامهٴ کلاسی نیست؛ گزارش جلسه برای زنگِ بدون درس ثبت نمی‌شود."));
      await expect(saveSessionReport(tx, admin, { ...cell, topic: "   " }, NOW)).rejects.toSatisfy(isValidation("موضوع تدریس‌شده را بنویسید."));
      await expect(saveSessionReport(tx, admin, { ...cell, topic: "ا".repeat(201) }, NOW)).rejects.toSatisfy(isValidation("موضوع تدریس‌شده حداکثر ۲۰۰ نویسه است."));
      await expect(saveSessionReport(tx, admin, { ...cell, topic: TOPIC, privateNote: "ا".repeat(1001) }, NOW)).rejects.toSatisfy(isValidation("یادداشت دبیر حداکثر ۱۰۰۰ نویسه است."));
      await expect(saveSessionReport(tx, admin, { ...cell, topic: TOPIC, nextPlan: "ا".repeat(301) }, NOW)).rejects.toSatisfy(isValidation("برنامهٴ جلسهٴ بعد حداکثر ۳۰۰ نویسه است."));
      // A درس the client names is never used (F1): class A2 has no درس at that زنگ in the timetable, whatever is named.
      await expect(saveSessionReport(tx, admin, { classGroupId: f.CLASS_GROUP_A2, date: TODAY, periodNo: PERIOD, classOfferingId: f.OFFERING_A1, topic: TOPIC }, NOW)).rejects.toSatisfy(
        isValidation("برای این زنگ درسی در برنامهٴ کلاسی نیست؛ گزارش جلسه برای زنگِ بدون درس ثبت نمی‌شود."),
      );
      expect(await tx.select({ id: sessionReport.id }).from(sessionReport).where(eq(sessionReport.classGroupId, f.CLASS_GROUP_A2))).toEqual([]);
    });
  });

  it("«تکلیف این جلسه»: the teacher links their own تکلیف of this درس; another's, a confidential one and one of no درس are refused; an admin may link any", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const mine = await newWorkItem(tx, f.PERSON_A2);
      const someoneElses = await newWorkItem(tx, f.PERSON_A1);
      const confidential = await newWorkItem(tx, f.PERSON_A2, { confidential: true });
      const noOffering = await newWorkItem(tx, f.PERSON_A2, { offering: null });

      const ok = await saveSessionReport(tx, teacher, { ...cell, topic: TOPIC, workItemId: mine }, NOW);
      const [row] = await tx.select({ w: sessionReport.workItemId }).from(sessionReport).where(eq(sessionReport.id, ok.reportId));
      expect(row.w).toBe(mine);

      for (const bad of [someoneElses, confidential, noOffering, "0199a000-0011-7000-8000-0000000000ff"]) {
        await expect(saveSessionReport(tx, teacher, { ...cell, topic: TOPIC, workItemId: bad }, NOW)).rejects.toSatisfy(isValidation("تکلیف انتخاب‌شده برای این درس نیست."));
      }
      // The school's admin (broad `workspace.work_item.update`) may link a colleague's — never a confidential one.
      await expect(saveSessionReport(tx, admin, { ...cell, topic: TOPIC, workItemId: someoneElses }, NOW)).resolves.toMatchObject({ created: false });
      await expect(saveSessionReport(tx, admin, { ...cell, topic: TOPIC, workItemId: confidential }, NOW)).rejects.toSatisfy(isValidation("تکلیف انتخاب‌شده برای این درس نیست."));
    });
  });
});

describe("audit", () => {
  it("every write leaves a row with ids and LENGTHS — never the topic, the page, the plan or the private note", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const saved = await saveSessionReport(tx, teacher, full, NOW);
      await saveSessionReport(tx, teacher, { ...full, topic: "تقسیم کسرها" }, NOW);
      await clearSessionReport(tx, teacher, cell, NOW);

      const trail = await tx
        .select({ action: auditLog.action, actor: auditLog.actorPersonId, before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, saved.reportId), eq(auditLog.entityTable, "session_report")))
        .orderBy(auditLog.id);
      expect(trail.map((t) => t.action)).toEqual(["academic.session_report.created", "academic.session_report.updated", "academic.session_report.cleared"]);
      expect(trail.every((t) => t.actor === f.PERSON_A2)).toBe(true);
      expect(trail[0].after).toMatchObject({
        classGroupId: f.CLASS_GROUP_A1,
        classOfferingId: f.OFFERING_A1,
        date: TODAY,
        periodNo: PERIOD,
        topicLength: TOPIC.length,
        pageRefLength: "فصل ۳".length,
        privateNoteLength: NOTE.length,
        nextPlanLength: PLAN.length,
      });
      const everything = JSON.stringify(trail);
      for (const secret of [TOPIC, "تقسیم کسرها", "فصل ۳", NOTE, PLAN, "خسته"]) expect(everything).not.toContain(secret);
    });
  });
});

describe("clearSessionReport", () => {
  it("withdraws the report (status archived, the row stays), hides it from the page and the card, and saving again brings it back", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const saved = await saveSessionReport(tx, teacher, full, NOW);
      await clearSessionReport(tx, teacher, cell, NOW);
      const [row] = await tx.select({ status: sessionReport.status, archivedAt: sessionReport.archivedAt }).from(sessionReport).where(eq(sessionReport.id, saved.reportId));
      expect(row.status).toBe("archived");
      expect(row.archivedAt).not.toBeNull();
      expect((await listOfferingSessionReports(tx, teacher, f.OFFERING_A1)).reports).toHaveLength(0);
      expect((await getSessionReportCell(tx, teacher, cell, NOW))?.report).toBeNull();
      await expect(clearSessionReport(tx, teacher, cell, NOW)).rejects.toSatisfy(isValidation("گزارشی برای این جلسه ثبت نشده است."));

      const back = await saveSessionReport(tx, teacher, { ...cell, topic: "دوباره" }, NOW);
      expect(back).toEqual({ reportId: saved.reportId, created: false });
      const [again] = await tx.select({ status: sessionReport.status, archivedAt: sessionReport.archivedAt }).from(sessionReport).where(eq(sessionReport.id, saved.reportId));
      expect(again).toEqual({ status: "active", archivedAt: null });
    });
  });

  it("a teacher of another class, an admin of another school and another tenant cannot clear it (NOT_FOUND)", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveSessionReport(tx, teacher, full, NOW);
      await expect(clearSessionReport(tx, teacherOfElse, cell, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(clearSessionReport(tx, viceElsewhere, cell, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
    await rolledBack(
      async (tx) => {
        await expect(clearSessionReport(tx, otherOrg, cell, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      },
      { orgId: f.ORG_B, personId: f.PERSON_B1 },
    );
  });
});

describe("reading: the subject page's «دفتر کلاسی» and the card", () => {
  it("the teacher and the school's admins get the private note; a student gets topic, page, next plan — and NO private note anywhere", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const item = await newWorkItem(tx, f.PERSON_A2);
      await saveSessionReport(tx, teacher, { ...full, workItemId: item }, NOW);

      const asTeacher = await listOfferingSessionReports(tx, teacher, f.OFFERING_A1);
      expect(asTeacher.includesPrivate).toBe(true);
      expect(asTeacher.reports).toHaveLength(1);
      const [t] = asTeacher.reports;
      expect(t.periodLabel).toBe("زنگ دوم");
      expect(hasPrivateNote(t.report) && t.report.privateNote).toBe(NOTE);
      expect(t.report.workItem).toEqual({ id: item, title: "تمرین کسرها" });
      const asAdmin = await listOfferingSessionReports(tx, admin, f.OFFERING_A1);
      expect(asAdmin.includesPrivate).toBe(true);
      expect(hasPrivateNote(asAdmin.reports[0].report)).toBe(true);

      const asStudent = await listOfferingSessionReports(tx, student, f.OFFERING_A1);
      expect(asStudent.includesPrivate).toBe(false);
      expect(asStudent.reports).toHaveLength(1);
      const s = asStudent.reports[0].report;
      expect(s).toMatchObject({ topic: TOPIC, pageRef: "فصل ۳", nextPlan: PLAN });
      expect("privateNote" in s).toBe(false);
      expect(JSON.stringify(asStudent)).not.toContain("خسته");
      // The تکلیف was not given to this student: its title does not reach them.
      expect(s.workItem).toBeNull();
    });
  });

  it("a person with no relation to the درس gets NOT_FOUND; another tenant too", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveSessionReport(tx, teacher, full, NOW);
      await expect(listOfferingSessionReports(tx, viceElsewhere, f.OFFERING_A1)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
    await rolledBack(
      async (tx) => {
        await expect(listOfferingSessionReports(tx, otherOrg, f.OFFERING_A1)).rejects.toSatisfy(isCode("NOT_FOUND"));
      },
      { orgId: f.ORG_B, personId: f.PERSON_B1 },
    );
  });

  it("newest first, and the card is null for a reader, for the future and for a class that is not theirs", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveSessionReport(tx, teacher, { classGroupId: f.CLASS_GROUP_A1, date: YESTERDAY, periodNo: PERIOD, topic: "دیروز" }, NOW);
      await saveSessionReport(tx, teacher, { ...cell, topic: "امروز" }, NOW);
      const list = await listOfferingSessionReports(tx, teacher, f.OFFERING_A1);
      expect(list.reports.map((r) => r.report.topic)).toEqual(["امروز", "دیروز"]);

      expect(await getSessionReportCell(tx, student, cell, NOW)).toBeNull();
      expect(await getSessionReportCell(tx, teacherOfElse, cell, NOW)).toBeNull();
      expect(await getSessionReportCell(tx, teacher, { ...cell, date: TOMORROW }, NOW)).toBeNull();
      const card = await getSessionReportCell(tx, teacher, cell, NOW);
      expect(card?.offeringId).toBe(f.OFFERING_A1);
      expect(card?.report?.topic).toBe("امروز");
    });
  });
});

// Security review 2026-10-20 — F1 / F2 / F7 and the `class_register` switch (F5). A second درس of class A1 (علوم) with
// its own teacher, so a cell can change hands.
const SUBJECT_X = "0199a000-0009-7000-8000-0000000000cc";
const OFFERING_X = "0199a000-000c-7000-8000-0000000000c2";
const TEACHER_X = "0199a000-0006-7000-8000-0000000000c3";
const teacherX = ctxOf(f.ORG_A, TEACHER_X, [teacherOf(OFFERING_X)]);
const yesterdayCell = { ...cell, date: YESTERDAY };

async function secondOffering(tx: Tx): Promise<void> {
  await tx.execute(sql`insert into tenancy.subject (id, organization_id, name, code) values (${SUBJECT_X}::uuid, ${f.ORG_A}::uuid, 'علوم', 'SCI-X')`);
  await tx.execute(sql`
    insert into tenancy.class_offering (id, organization_id, class_group_id, subject_id, term_id)
    values (${OFFERING_X}::uuid, ${f.ORG_A}::uuid, ${f.CLASS_GROUP_A1}::uuid, ${SUBJECT_X}::uuid, ${f.TERM_A}::uuid)`);
  await tx.execute(sql`insert into iam.person (id, organization_id, first_name, last_name) values (${TEACHER_X}::uuid, ${f.ORG_A}::uuid, 'رضا', 'کریمی')`);
}

const reportsOfCell = (tx: Tx, date: string) =>
  tx
    .select({ offering: sessionReport.classOfferingId, topic: sessionReport.topic, note: sessionReport.privateNote, author: sessionReport.authorPersonId })
    .from(sessionReport)
    .where(and(eq(sessionReport.classGroupId, f.CLASS_GROUP_A1), eq(sessionReport.date, date), eq(sessionReport.periodNo, PERIOD)));

describe("a report belongs to its cell AND the timetable's درس (security review 2026-10-20, F1 / F2 / F7)", () => {
  it("P1 — the timetable moves another درس into a past cell: its teacher reads an EMPTY card (never the earlier report or its private note) and writes their own beside it; the first report is untouched", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await secondOffering(tx);
      await saveSessionReport(tx, teacher, { ...yesterdayCell, topic: TOPIC, privateNote: NOTE }, NOW);
      // The timetable changes: yesterday's زنگ ۲ is now علوم.
      await setTimetableSlot(tx, admin, { classGroupId: f.CLASS_GROUP_A1, weekday: weekdayOfIso(YESTERDAY)!, periodNo: PERIOD, classOfferingId: OFFERING_X });

      // علوم's teacher opens yesterday's زنگ ۲: a card for علوم with NO report — not ریاضی's, not its note.
      const card = await getSessionReportCell(tx, teacherX, yesterdayCell, NOW);
      expect(card).toMatchObject({ offeringId: OFFERING_X, report: null, lockedWorkItem: null });
      expect(JSON.stringify(card)).not.toContain(NOTE);
      expect(JSON.stringify(card)).not.toContain(TOPIC);
      // …and writes a report of their own: no lock-out (F2), nothing of the first one is touched.
      const own = await saveSessionReport(tx, teacherX, { ...yesterdayCell, classOfferingId: OFFERING_X, topic: "چرخهٔ آب", privateNote: "یادداشت علوم" }, NOW);
      expect(own.created).toBe(true);
      const rows = await reportsOfCell(tx, YESTERDAY);
      expect(rows.sort((a, b) => a.offering.localeCompare(b.offering))).toEqual(
        [
          { offering: f.OFFERING_A1, topic: TOPIC, note: NOTE, author: f.PERSON_A2 },
          { offering: OFFERING_X, topic: "چرخهٔ آب", note: "یادداشت علوم", author: TEACHER_X },
        ].sort((a, b) => a.offering.localeCompare(b.offering)),
      );
      // The school's admin reads the cell's CURRENT درس — علوم's report, never ریاضی's note through the card.
      const adminCard = await getSessionReportCell(tx, vice, yesterdayCell, NOW);
      expect(adminCard?.report).toMatchObject({ topic: "چرخهٔ آب", privateNote: "یادداشت علوم" });
      expect(JSON.stringify(adminCard)).not.toContain(NOTE);
      // ریاضی's teacher no longer has that cell; their report stays on ریاضی's page, علوم's on علوم's.
      expect(await getSessionReportCell(tx, teacher, yesterdayCell, NOW)).toBeNull();
      const mathPage = await listOfferingSessionReports(tx, teacher, f.OFFERING_A1);
      expect(mathPage.reports.map((r) => r.report.topic)).toEqual([TOPIC]);
      const sciencePage = await listOfferingSessionReports(tx, teacherX, OFFERING_X);
      expect(sciencePage.reports.map((r) => r.report.topic)).toEqual(["چرخهٔ آب"]);
      expect(JSON.stringify(sciencePage)).not.toContain(NOTE);
      // Clearing is the cell's درس's too: علوم's teacher clears only علوم's report.
      await clearSessionReport(tx, teacherX, { ...yesterdayCell, classOfferingId: OFFERING_X }, NOW);
      expect((await reportsOfCell(tx, YESTERDAY)).map((r) => r.note).sort()).toEqual([NOTE, "یادداشت علوم"].sort());
      const statuses = await tx.select({ offering: sessionReport.classOfferingId, status: sessionReport.status }).from(sessionReport).where(eq(sessionReport.date, YESTERDAY));
      expect(Object.fromEntries(statuses.map((s) => [s.offering, s.status]))).toEqual({ [f.OFFERING_A1]: "active", [OFFERING_X]: "archived" });
    });
  });

  it("P2 — a crafted classOfferingId: a teacher naming their own درس at another درس's cell is NOT_FOUND and writes nothing; an admin naming a درس the timetable does not put there is refused; the cell's teacher is never locked out", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await secondOffering(tx);
      // TODAY's زنگ ۲ is ریاضی: علوم's teacher may not take it, by naming علوم or not.
      await expect(saveSessionReport(tx, teacherX, { ...full, classOfferingId: OFFERING_X }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      await expect(saveSessionReport(tx, teacherX, full, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      expect(await getSessionReportCell(tx, teacherX, cell, NOW)).toBeNull();
      await expect(clearSessionReport(tx, teacherX, { ...cell, classOfferingId: OFFERING_X }, NOW)).rejects.toSatisfy(isCode("NOT_FOUND"));
      // An admin of the school naming the wrong درس: refused, nothing written.
      await expect(saveSessionReport(tx, vice, { ...full, classOfferingId: OFFERING_X }, NOW)).rejects.toSatisfy(isValidation("درسِ این زنگ در برنامهٴ کلاسی عوض شده است؛ صفحه را دوباره باز کنید."));
      expect(await reportsOfCell(tx, TODAY)).toEqual([]);
      // ریاضی's teacher writes the cell (naming it or not) — and its note never reaches علوم's page.
      expect((await saveSessionReport(tx, teacher, { ...full, classOfferingId: f.OFFERING_A1 }, NOW)).created).toBe(true);
      expect(await reportsOfCell(tx, TODAY)).toEqual([{ offering: f.OFFERING_A1, topic: TOPIC, note: NOTE, author: f.PERSON_A2 }]);
      expect((await listOfferingSessionReports(tx, teacherX, OFFERING_X)).reports).toEqual([]);
    });
  });

  it("F7 — a linked تکلیف the teacher may not choose is shown read-only, not preselected; saving without touching it keeps it; another or «بدون تکلیف» replaces it", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      const mine = await newWorkItem(tx, f.PERSON_A2);
      const colleagues = await newWorkItem(tx, f.PERSON_A1);
      // The organization admin links a colleague's تکلیف (any of the درس — a broad update holder).
      const { reportId } = await saveSessionReport(tx, admin, { ...cell, topic: TOPIC, workItemId: colleagues }, NOW);
      const linkOf = async () => (await tx.select({ w: sessionReport.workItemId }).from(sessionReport).where(eq(sessionReport.id, reportId)))[0].w;

      const card = await getSessionReportCell(tx, teacher, cell, NOW);
      expect(card?.report?.workItem).toBeNull();
      expect(card?.workItems.map((w) => w.id)).toEqual([mine]);
      // The teacher may not open it: no title reaches them.
      expect(card?.lockedWorkItem).toEqual({ title: null });
      // Saving the rest, the تکلیف field left out: the link is kept (no «invalid تکلیف» refusal, no silent drop).
      await saveSessionReport(tx, teacher, { ...cell, topic: "موضوع تازه" }, NOW);
      expect(await linkOf()).toBe(colleagues);
      // An explicit choice of theirs replaces it; «بدون تکلیف» removes it; a colleague's is still refused when CHOSEN.
      await saveSessionReport(tx, teacher, { ...cell, topic: TOPIC, workItemId: mine }, NOW);
      expect(await linkOf()).toBe(mine);
      expect((await getSessionReportCell(tx, teacher, cell, NOW))?.report?.workItem).toMatchObject({ id: mine });
      await saveSessionReport(tx, teacher, { ...cell, topic: TOPIC, workItemId: null }, NOW);
      expect(await linkOf()).toBeNull();
      await expect(saveSessionReport(tx, teacher, { ...cell, topic: TOPIC, workItemId: colleagues }, NOW)).rejects.toSatisfy(isValidation("تکلیف انتخاب‌شده برای این درس نیست."));
    });
  });

  it("the school's «دفتر کلاسی» switch (class_register, default on): off → no card, no log, no write; on again → all back", async () => {
    await rolledBack(async (tx) => {
      await setUpClass(tx);
      await saveSessionReport(tx, teacher, full, NOW);
      await tx.execute(sql`insert into config.feature_flag (id, organization_id, school_id, key, enabled) values (app.uuid_generate_v7(), ${f.ORG_A}::uuid, ${f.SCHOOL_A}::uuid, 'class_register', false)`);
      // Fresh savepoints: the switches are read once per transaction.
      const fresh = <T>(fn: (sp: Tx) => Promise<T>) => tx.transaction(fn);
      expect(await fresh((sp) => getSessionReportCell(sp, teacher, cell, NOW))).toBeNull();
      expect(await fresh((sp) => listOfferingSessionReports(sp, teacher, f.OFFERING_A1))).toMatchObject({ reports: [], enabled: false });
      await expect(fresh((sp) => saveSessionReport(sp, teacher, full, NOW))).rejects.toSatisfy((e: unknown) => AppError.is(e) && e.code === "FORBIDDEN" && e.message === "دفتر کلاسی در این مدرسه خاموش است.");
      await expect(fresh((sp) => clearSessionReport(sp, teacher, cell, NOW))).rejects.toSatisfy(isCode("FORBIDDEN"));
      // Out of scope stays NOT_FOUND whatever the switch (nothing is learned about it).
      await expect(fresh((sp) => saveSessionReport(sp, teacherOfElse, full, NOW))).rejects.toSatisfy(isCode("NOT_FOUND"));
      await tx.execute(sql`update config.feature_flag set enabled = true where key = 'class_register'`);
      expect((await fresh((sp) => getSessionReportCell(sp, teacher, cell, NOW)))?.report).toMatchObject({ topic: TOPIC });
      expect((await fresh((sp) => listOfferingSessionReports(sp, teacher, f.OFFERING_A1))).enabled).toBe(true);
    });
  });
});

describe("app_rw may not DELETE a report", () => {
  it("migration 0027: the table is under FORCE RLS with tenant_isolation plus the RESTRICTIVE no-delete policy for app_rw", async () => {
    await asAppRw(async (c) => {
      const rls = await c.query<{ enabled: boolean; forced: boolean }>(
        "select c.relrowsecurity as enabled, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'academic' and c.relname = 'session_report'",
      );
      expect(rls.rows).toEqual([{ enabled: true, forced: true }]);
      const pol = await c.query<{ policyname: string; permissive: string; cmd: string; roles: string[] }>(
        "select policyname, permissive, cmd, array(select r::text from unnest(roles) r where r <> 'app_worker' order by r) as roles /* the worker's role (0032) is bound like app_rw */ from pg_policies where schemaname = 'academic' and tablename = 'session_report' order by policyname",
      );
      expect(pol.rows.map((p) => `${p.policyname}:${p.permissive}:${p.cmd}`)).toEqual(["session_report_no_delete:RESTRICTIVE:DELETE", "tenant_isolation:PERMISSIVE:ALL"]);
      // app_rw — and the worker's role (0032) when the cluster has it, bound like app_rw.
      expect(pol.rows[0].roles.filter((r) => r !== "app_worker")).toEqual(["app_rw"]);
    });
  });

  it("a raw DELETE as the runtime role is refused (0032's REVOKE; the RESTRICTIVE policy is the second net); the row is still there", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        const ins = await c.query<{ id: string }>(
          `insert into academic.session_report (id, organization_id, class_group_id, class_offering_id, date, period_no, topic, author_person_id)
           values (gen_random_uuid(), $1, $2, $3, $4::date, 2, 'موضوع', $5) returning id`,
          [f.ORG_A, f.CLASS_GROUP_A1, f.OFFERING_A1, TODAY, f.PERSON_A2],
        );
        await c.query("savepoint del");
        await expect(c.query("delete from academic.session_report where id = $1", [ins.rows[0].id])).rejects.toMatchObject({ code: PG.INSUFFICIENT_PRIVILEGE });
        await c.query("rollback to savepoint del");
        const left = await c.query("select 1 from academic.session_report where id = $1", [ins.rows[0].id]);
        expect(left.rowCount).toBe(1);
      });
    });
  });

  it("the CHECKs hold below the service: an empty topic, a 201-char topic and a 'cleared' report without a timestamp are refused", async () => {
    await asAppRw(async (c) => {
      const attempt = async (topic: string, status: string, archivedAt: string | null) => {
        await c.query("BEGIN");
        try {
          await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
          await c.query(
            `insert into academic.session_report (id, organization_id, class_group_id, class_offering_id, date, period_no, topic, status, archived_at, author_person_id)
             values (gen_random_uuid(), $1, $2, $3, $4::date, 2, $5, $6, $7::timestamptz, $8)`,
            [f.ORG_A, f.CLASS_GROUP_A1, f.OFFERING_A1, TODAY, topic, status, archivedAt, f.PERSON_A2],
          );
        } finally {
          await c.query("ROLLBACK");
        }
      };
      await expect(attempt("", "active", null)).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
      await expect(attempt("ا".repeat(201), "active", null)).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
      await expect(attempt("موضوع", "archived", null)).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
    });
  });
});
