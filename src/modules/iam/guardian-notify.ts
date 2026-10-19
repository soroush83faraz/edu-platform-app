// iam/guardian-notify — the guardian's bell (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»): in-app only, ONE
// notification per guardian and event, in the SAME transaction as the change that caused it.
//   • «غیبت»: a roll call saved with the child marked absent — once per child per roll call (attendance session),
//     however often it is saved again (`takeAttendance`, academic/attendance); withdrawn when a correction says the
//     child was not absent after all (`withdrawGuardianAbsences`, D4b);
//   • «کارنامهٴ ماه …»: the first level written for the child in a month of the report card — once per child per month
//     and school year, whichever درس comes first (`saveObjectiveRatings`, academic/report-card);
//   • an overdue تکلیف is NOT a notification: phase 1 has no scheduler and no queue, so nothing could write it on time —
//     the guardian's Home shows the child's overdue count when read instead (./guardian-views `listMyChildren`).
// The title is the kind of event and the child's name, nothing else (`guardianNotificationTitle`); no body. The
// recipients are the child's LIVE guardians (link live, person active), never the actor (a teacher who is also the
// parent does not hear of their own roll call), through the workspace notify policy. Their person rows are taken FOR
// KEY SHARE in ascending order before the insert (its foreign-key check would take exactly that lock anyway).
// Each row records its child (`payload.studentProfileId`), so a guardian's bell only ever holds rows about their LIVE
// children: ending a link (and so closing, or reopening, a guardian login) prunes the rest (`pruneGuardianNotifications`,
// security review 2026-10-19 D2 — a reopened account would otherwise show the next school a former child's name).
// A leaf module — notif + schema only — so academic can call it without an import cycle.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import type { AssignmentLike } from "@/lib/work-item-words";
import { notification } from "@/modules/notif/schema";
import { notifyMany, type NotificationTypeCode } from "@/modules/notif/service";
import { notifiable } from "@/modules/workspace/notify-policy";
import { childHref, guardianNotificationTitle } from "./guardian-policy";
import { guardianLink, person, studentProfile } from "./schema";

/** The guardian bell's types (scripts/catalog.ts, module `guardian`). */
export const GUARDIAN_NOTIFICATION_TYPES: readonly NotificationTypeCode[] = ["guardian.child_absent", "guardian.report_card"];

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

/** The «غیبت» row's per-recipient key: one row per roll call, child and guardian (`notifyMany` inserts it once). */
function absenceDedupeKey(attendanceSessionId: string, studentProfileId: string, personId: string): string {
  return `guardian:absent:${attendanceSessionId}:${studentProfileId}:${personId}`;
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
      payload: { studentProfileId: c.studentProfileId },
      sourceKind: "attendance_session",
      sourceId: input.attendanceSessionId,
      deepLink: childHref("attendance", c.studentProfileId),
      dedupeKey: (personId) => absenceDedupeKey(input.attendanceSessionId, c.studentProfileId, personId),
    });
  }
  return written;
}

/**
 * The roll call was corrected (security review 2026-10-19, D4b): these students are no longer ABSENT in it — marked
 * present / late / excused, or taken off the list — so the «غیبت» their guardians were told of is withdrawn: the rows
 * are DELETED (the exact per-recipient key of `notifyGuardiansOfAbsence`, through the recipient + key unique index), for
 * every guardian the child has had (a link may have ended since). Deleting frees the key, so marking the child absent
 * again in the same roll call tells the guardians again. Same transaction as the attendance change; rows deleted.
 */
export async function withdrawGuardianAbsences(tx: Tx, input: { attendanceSessionId: string; studentProfileIds: readonly string[] }): Promise<number> {
  const ids = [...new Set(input.studentProfileIds)];
  if (ids.length === 0) return 0;
  const pairs = await tx
    .selectDistinct({ studentProfileId: guardianLink.studentProfileId, guardianPersonId: guardianLink.guardianPersonId })
    .from(guardianLink)
    .where(inArray(guardianLink.studentProfileId, ids));
  if (pairs.length === 0) return 0;
  const rows = await tx
    .delete(notification)
    .where(
      and(
        eq(notification.typeCode, "guardian.child_absent"),
        inArray(notification.recipientPersonId, [...new Set(pairs.map((p) => p.guardianPersonId))]),
        inArray(
          notification.dedupeKey,
          pairs.map((p) => absenceDedupeKey(input.attendanceSessionId, p.studentProfileId, p.guardianPersonId)),
        ),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
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
      payload: { studentProfileId: c.studentProfileId },
      sourceKind: "report_card",
      sourceId: c.studentProfileId,
      deepLink: childHref("report-card", c.studentProfileId, { month: input.month }),
      dedupeKey: (personId) => `guardian:report:${input.academicYearId}:${input.month}:${c.studentProfileId}:${personId}`,
    });
  }
  return written;
}

/**
 * Deletes the guardian notifications (`GUARDIAN_NOTIFICATION_TYPES` only — a colleague's work-item bell is untouched)
 * of these persons that are NOT about one of their live children: a link that ended takes its child's «غیبت» and
 * «کارنامه» rows with it, so neither a guardian left with other children, nor — above all — whoever reopens a closed
 * guardian login later (possibly another school's manager, who receives its new password) ever reads a former child's
 * name in that bell. A row without a recorded child (none are written so any more) counts as stale. Deleted, not
 * expired: the rows are derived signals, and a dedupe key left behind would mute the event if the link comes back.
 * Called inside the transaction that ended the links / reopened the account (its audit row carries the count).
 */
export async function pruneGuardianNotifications(tx: Tx, guardianPersonIds: readonly string[]): Promise<number> {
  const ids = [...new Set(guardianPersonIds)];
  if (ids.length === 0) return 0;
  const rows = await tx
    .delete(notification)
    .where(
      and(
        inArray(notification.recipientPersonId, ids),
        inArray(notification.typeCode, [...GUARDIAN_NOTIFICATION_TYPES]),
        sql`not exists (
          select 1 from iam.guardian_link pgl
          where pgl.guardian_person_id = ${notification.recipientPersonId} and pgl.status = 'active'
            and pgl.student_profile_id::text = ${notification.payload} ->> 'studentProfileId')`,
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
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
