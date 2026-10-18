// iam/guardian-notify — the guardian's bell (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»): in-app only, ONE
// notification per guardian and event, in the SAME transaction as the change that caused it.
//   • «غیبت»: a roll call saved with the child marked absent — once per child per roll call (attendance session),
//     however often it is saved again (`takeAttendance`, academic/attendance);
//   • «کارنامهٴ ماه …»: the first level written for the child in a month of the report card — once per child per month
//     and school year, whichever درس comes first (`saveObjectiveRatings`, academic/report-card);
//   • an overdue تکلیف is NOT a notification: phase 1 has no scheduler and no queue, so nothing could write it on time —
//     the guardian's Home shows the child's overdue count when read instead (./guardian-views `listMyChildren`).
// The title is the kind of event and the child's name, nothing else (`guardianNotificationTitle`); no body. The
// recipients are the child's LIVE guardians (link live, person active), never the actor (a teacher who is also the
// parent does not hear of their own roll call), through the workspace notify policy. Their person rows are taken FOR
// KEY SHARE in ascending order before the insert (its foreign-key check would take exactly that lock anyway).
// A leaf module — notif + schema only — so academic can call it without an import cycle.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import type { AssignmentLike } from "@/lib/work-item-words";
import { notifyMany } from "@/modules/notif/service";
import { notifiable } from "@/modules/workspace/notify-policy";
import { childHref, guardianNotificationTitle } from "./guardian-policy";
import { guardianLink, person, studentProfile } from "./schema";

export interface GuardianNotifyCtx {
  orgId: string;
  personId: string;
  assignments: readonly AssignmentLike[];
}

interface ChildGuardians {
  studentProfileId: string;
  childName: string;
  guardianPersonIds: string[];
}

/** The live guardians of each student (none → left out), but the actor; their rows locked FOR KEY SHARE, ascending. */
async function liveGuardiansOf(tx: Tx, ctx: GuardianNotifyCtx, studentProfileIds: readonly string[]): Promise<ChildGuardians[]> {
  const ids = [...new Set(studentProfileIds)];
  if (ids.length === 0) return [];
  const rows = await tx.execute<{ student_profile_id: string; first_name: string; last_name: string; guardian_person_id: string }>(sql`
    select sp.id as student_profile_id, child.first_name, child.last_name, gl.guardian_person_id
    from iam.guardian_link gl
    join iam.student_profile sp on sp.id = gl.student_profile_id
    join iam.person child on child.id = sp.person_id
    join iam.person gp on gp.id = gl.guardian_person_id
    where gl.status = 'active' and gp.status = 'active'
      and gl.student_profile_id = any(${sql.param(ids, undefined)}::uuid[])
      and gl.guardian_person_id <> ${ctx.personId}::uuid
    order by sp.id, gl.guardian_person_id`);
  const recipients = [...new Set(rows.rows.map((r) => r.guardian_person_id))].sort();
  if (recipients.length > 0) await tx.select({ id: person.id }).from(person).where(inArray(person.id, recipients)).orderBy(asc(person.id)).for("key share");
  const byChild = new Map<string, ChildGuardians>();
  for (const r of rows.rows) {
    const entry = byChild.get(r.student_profile_id) ?? { studentProfileId: r.student_profile_id, childName: `${r.first_name} ${r.last_name}`, guardianPersonIds: [] };
    entry.guardianPersonIds.push(r.guardian_person_id);
    byChild.set(r.student_profile_id, entry);
  }
  return [...byChild.values()];
}

/** «غیبت: <نام>» to the live guardians of every student marked ABSENT in this roll call. Rows written (deduped excluded). */
export async function notifyGuardiansOfAbsence(tx: Tx, ctx: GuardianNotifyCtx, input: { attendanceSessionId: string; absentStudentProfileIds: readonly string[] }): Promise<number> {
  let written = 0;
  for (const c of await liveGuardiansOf(tx, ctx, input.absentStudentProfileIds)) {
    const recipients = notifiable(ctx.assignments, c.guardianPersonIds);
    if (recipients.length === 0) continue;
    written += await notifyMany(tx, ctx, recipients, {
      typeCode: "guardian.child_absent",
      title: guardianNotificationTitle("absent", c.childName),
      body: null,
      sourceKind: "attendance_session",
      sourceId: input.attendanceSessionId,
      deepLink: childHref("attendance", c.studentProfileId),
      dedupeKey: (personId) => `guardian:absent:${input.attendanceSessionId}:${c.studentProfileId}:${personId}`,
    });
  }
  return written;
}

/** «کارنامهٴ ماه <ماه>: <نام>» to the live guardians of every student who got a level in this month — once per month and year. */
export async function notifyGuardiansOfReportCard(
  tx: Tx,
  ctx: GuardianNotifyCtx,
  input: { academicYearId: string; month: number; monthName: string; studentProfileIds: readonly string[] },
): Promise<number> {
  let written = 0;
  for (const c of await liveGuardiansOf(tx, ctx, input.studentProfileIds)) {
    const recipients = notifiable(ctx.assignments, c.guardianPersonIds);
    if (recipients.length === 0) continue;
    written += await notifyMany(tx, ctx, recipients, {
      typeCode: "guardian.report_card",
      title: guardianNotificationTitle("report_card", c.childName, input.monthName),
      body: null,
      sourceKind: "report_card",
      sourceId: c.studentProfileId,
      deepLink: childHref("report-card", c.studentProfileId, { month: input.month }),
      dedupeKey: (personId) => `guardian:report:${input.academicYearId}:${input.month}:${c.studentProfileId}:${personId}`,
    });
  }
  return written;
}

/** Live guardian person ids of one student (tests and the student card's counters). */
export async function liveGuardianIdsOf(tx: Tx, studentProfileId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: guardianLink.guardianPersonId })
    .from(guardianLink)
    .innerJoin(studentProfile, eq(studentProfile.id, guardianLink.studentProfileId))
    .where(and(eq(guardianLink.studentProfileId, studentProfileId), eq(guardianLink.status, "active")))
    .orderBy(asc(guardianLink.guardianPersonId));
  return rows.map((r) => r.id);
}
