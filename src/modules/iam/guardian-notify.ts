// iam/guardian-notify — the guardian's bell (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»): in-app only, ONE
// notification per guardian and event, in the SAME transaction as the change that caused it.
//   • «غیبت»: a roll call saved with the child marked absent — once per child per roll call (attendance session),
//     however often it is saved again (`takeAttendance`, academic/attendance); withdrawn when a correction says the
//     child was not absent after all (`withdrawGuardianAbsences`, D4b);
//   • «کارنامهٴ ماه …»: the child's card for a month is COMPLETE — every active objective of the month, across every
//     درس, has a level (owner 2026-10-19; it fired on the first level before) — once per child per month and school
//     year, never taken back when a level is later changed or cleared (`saveObjectiveRatings`, academic/report-card);
//   • «پاسخ مدرسه به پیام شما دربارهٴ …»: an addressee answered the guardian's «پیام ولی» (owner 2026-10-19,
//     ./guardian-messages) — once per message, from workspace `changeStatus` (`notifyGuardianOfMessageAnswer`);
//   • «مرخصی تأیید شد / رد شد» and «خروج مجاز» (owner 2026-10-20, academic/leave): a manager decided a guardian's leave
//     request / let the child leave school early — once per request / exit and guardian, the child's name only
//     (`notifyGuardiansOfLeaveDecision`, `notifyGuardiansOfEarlyExit`); and a child covered by an approved leave or an
//     exit is never reported absent (`takeAttendance` leaves them out of `notifyGuardiansOfAbsence`);
//   • an overdue تکلیف is NOT a notification: phase 1 has no scheduler and no queue, so nothing could write it on time —
//     the guardian's Home shows the child's overdue count when read instead (./guardian-views `listMyChildren`).
// The title is the kind of event and the child's name, nothing else (`guardianNotificationTitle`); no body. The
// recipients are the child's LIVE guardians (link live, person active), never the actor (a teacher who is also the
// parent does not hear of their own roll call), through the workspace notify policy. Their person rows are taken FOR
// SHARE before the link is read for the last time (ascending; the answer's through workspace `lockItemPeople`) — the
// mode an unlink's FOR NO KEY UPDATE conflicts with, so a bell and an unlink of its guardian never interleave (security
// review 2026-10-19, D4); the insert's foreign-key check then waits for nothing new.
// Each row records its child (`payload.studentProfileId`), so a guardian's bell only ever holds rows about their LIVE
// children: ending a link (and so closing, or reopening, a guardian login) prunes the rest (`pruneGuardianNotifications`,
// security review 2026-10-19 D2 — a reopened account would otherwise show the next school a former child's name).
// A leaf module — notif + schema only — so academic and workspace can call it without an import cycle.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import type { AssignmentLike } from "@/lib/work-item-words";
import { notification } from "@/modules/notif/schema";
import { notifyMany, type NotificationTypeCode } from "@/modules/notif/service";
import { notifiable } from "@/modules/workspace/notify-policy";
import { guardianMessage } from "@/modules/workspace/schema";
import { childHref, guardianNotificationTitle } from "./guardian-policy";
import { guardianLink, person, studentProfile } from "./schema";

/** The guardian bell's types (scripts/catalog.ts, module `guardian`). */
export const GUARDIAN_NOTIFICATION_TYPES: readonly NotificationTypeCode[] = [
  "guardian.child_absent",
  "guardian.report_card",
  "guardian.message_answered",
  "guardian.leave_decided",
  "guardian.early_exit",
];

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

/**
 * The live guardians of each student (none → left out), but the actor. Their person rows are taken FOR SHARE,
 * ascending, and the links read AGAIN under those locks (security review 2026-10-19, D4): an unlink takes the guardian's
 * row FOR NO KEY UPDATE (./guardian «Concurrency»), which the KEY SHARE taken here before never waited for — a bell
 * written while a link was ending committed after the unlink's prune and kept a former child's name. Now an unlink in
 * flight is waited for and its ended link is seen by the second read (READ COMMITTED: a new statement sees what it
 * committed); an unlink that comes later waits for this transaction and its prune sees the bell. A guardian linked
 * between the two reads is left out (not locked): this event happened before their link.
 */
async function liveGuardiansOf(tx: Tx, ctx: GuardianNotifyCtx, studentProfileIds: readonly string[]): Promise<ChildGuardians[]> {
  const ids = [...new Set(studentProfileIds)];
  if (ids.length === 0) return [];
  const read = () =>
    tx.execute<{ student_profile_id: string; first_name: string; last_name: string; guardian_person_id: string }>(sql`
      select sp.id as student_profile_id, child.first_name, child.last_name, gl.guardian_person_id
      from iam.guardian_link gl
      join iam.student_profile sp on sp.id = gl.student_profile_id
      join iam.person child on child.id = sp.person_id
      join iam.person gp on gp.id = gl.guardian_person_id
      where gl.status = 'active' and gp.status = 'active'
        and gl.student_profile_id = any(${sql.param(ids, undefined)}::uuid[])
        and gl.guardian_person_id <> ${ctx.personId}::uuid
      order by sp.id, gl.guardian_person_id`);
  const recipients = [...new Set((await read()).rows.map((r) => r.guardian_person_id))].sort();
  if (recipients.length === 0) return [];
  await tx.select({ id: person.id }).from(person).where(inArray(person.id, recipients)).orderBy(asc(person.id)).for("share");
  const locked = new Set(recipients);
  const live = (await read()).rows.filter((r) => locked.has(r.guardian_person_id));
  const byChild = new Map<string, ChildGuardians>();
  for (const r of live) {
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

/**
 * «کارنامهٴ ماه <ماه>: <نام>» to the live guardians of every student given — the caller passes the students whose card
 * for that month is complete (academic/report-card `completeCardsOf`). Once per child, month, year and guardian.
 */
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
 * An addressee's «ثبت پاسخ» CLOSED a guardian's «پیام ولی» (workspace `changeStatus`, owner 2026-10-19): the guardian
 * who wrote it hears «پاسخ مدرسه به پیام شما دربارهٴ <نام>» — never the answer, never who gave it (they read the answer
 * in «پیام به مدرسه») — while their link to that child is still live (link, child and guardian active: a former child's
 * name never reaches a bell, D2) and never for the actor's own act. Once per message (the first answer closes it, and
 * a `parent_message` has no manager to reopen it). The guardian's person row was taken FOR SHARE before the item
 * (workspace `lockItemPeople`, security review 2026-10-19 D4) — the mode an unlink's FOR NO KEY UPDATE on that row
 * conflicts with: an unlink in flight committed before the link is read below (so it reads the link ended and writes
 * nothing), or it waits for this transaction and its prune then deletes the row written here. The insert's
 * foreign-key check waits for nothing new. The message row is readable here because the actor is one of the item's
 * addressees (0022's RESTRICTIVE policy).
 */
export async function notifyGuardianOfMessageAnswer(tx: Tx, ctx: GuardianNotifyCtx, answer: { workItemId: string; closed: boolean }): Promise<number> {
  if (!answer.closed) return 0;
  const [m] = await tx
    .select({ id: guardianMessage.id, guardianPersonId: guardianMessage.guardianPersonId, studentProfileId: guardianMessage.studentProfileId })
    .from(guardianMessage)
    .where(eq(guardianMessage.workItemId, answer.workItemId))
    .limit(1);
  if (!m || m.guardianPersonId === ctx.personId) return 0;
  const live = await tx.execute<{ first_name: string; last_name: string }>(sql`
    select child.first_name, child.last_name
    from iam.guardian_link gl
    join iam.student_profile sp on sp.id = gl.student_profile_id and sp.status = 'active'
    join iam.person child on child.id = sp.person_id and child.status = 'active'
    join iam.person gp on gp.id = gl.guardian_person_id and gp.status = 'active'
    where gl.guardian_person_id = ${m.guardianPersonId}::uuid and gl.student_profile_id = ${m.studentProfileId}::uuid and gl.status = 'active'
    limit 1`);
  const child = live.rows[0];
  if (!child) return 0;
  const recipients = notifiable(ctx.assignments, [m.guardianPersonId]);
  if (recipients.length === 0) return 0;
  return notifyMany(tx, ctx, recipients, {
    typeCode: "guardian.message_answered",
    title: guardianNotificationTitle("message_answered", `${child.first_name} ${child.last_name}`),
    body: null,
    payload: { studentProfileId: m.studentProfileId },
    sourceKind: "guardian_message",
    sourceId: m.id,
    deepLink: childHref("messages", m.studentProfileId),
    dedupeKey: (personId) => `guardian:message:${m.id}:answered:${personId}`,
  });
}

/**
 * «مرخصی تأیید شد / رد شد: <نام>» (owner, 2026-10-20) to the live guardians of the child when a manager decides a
 * leave request (academic/leave `decideLeave`): the kind of decision and the child's name — never the dates, the
 * reason or the manager's note; the guardian opens «درخواست‌های مرخصی» for those. Once per request and guardian.
 */
export async function notifyGuardiansOfLeaveDecision(
  tx: Tx,
  ctx: GuardianNotifyCtx,
  input: { leaveRequestId: string; studentProfileId: string; approved: boolean },
): Promise<number> {
  let written = 0;
  for (const c of await liveGuardiansOf(tx, ctx, [input.studentProfileId])) {
    const recipients = notifiable(ctx.assignments, c.guardianPersonIds);
    if (recipients.length === 0) continue;
    written += await notifyMany(tx, ctx, recipients, {
      typeCode: "guardian.leave_decided",
      title: guardianNotificationTitle(input.approved ? "leave_approved" : "leave_rejected", c.childName),
      body: null,
      payload: { studentProfileId: c.studentProfileId },
      sourceKind: "leave_request",
      sourceId: input.leaveRequestId,
      deepLink: childHref("leave", c.studentProfileId),
      dedupeKey: (personId) => `guardian:leave:${input.leaveRequestId}:${personId}`,
    });
  }
  return written;
}

/**
 * «خروج مجاز: <نام>» (owner, 2026-10-20) to the live guardians of a child a manager just let leave school early
 * (academic/leave `recordEarlyExit`) — the child's name only, not the time, the reason or who picks them up (the
 * child's «حضور و غیاب» shows the time). Once per exit and guardian.
 */
export async function notifyGuardiansOfEarlyExit(tx: Tx, ctx: GuardianNotifyCtx, input: { earlyExitId: string; studentProfileId: string }): Promise<number> {
  let written = 0;
  for (const c of await liveGuardiansOf(tx, ctx, [input.studentProfileId])) {
    const recipients = notifiable(ctx.assignments, c.guardianPersonIds);
    if (recipients.length === 0) continue;
    written += await notifyMany(tx, ctx, recipients, {
      typeCode: "guardian.early_exit",
      title: guardianNotificationTitle("early_exit", c.childName),
      body: null,
      payload: { studentProfileId: c.studentProfileId },
      sourceKind: "early_exit",
      sourceId: input.earlyExitId,
      deepLink: childHref("attendance", c.studentProfileId),
      dedupeKey: (personId) => `guardian:exit:${input.earlyExitId}:${personId}`,
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
 * Also deleted, whichever child: any WORK-ITEM notification (`source_kind` 'work_item' — a comment's above all) about a
 * «پیام ولی» the person wrote. Its creator is no participant, so no such row is theirs to receive — none is written any
 * more (`addComment` refuses the type, security review 2026-10-19 D3), and one written before would name the child and
 * quote a comment to whoever holds the login next. A colleague's own work-item rows are never touched.
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
        or(
          and(
            inArray(notification.typeCode, [...GUARDIAN_NOTIFICATION_TYPES]),
            sql`not exists (
              select 1 from iam.guardian_link pgl
              where pgl.guardian_person_id = ${notification.recipientPersonId} and pgl.status = 'active'
                and pgl.student_profile_id::text = ${notification.payload} ->> 'studentProfileId')`,
          ),
          and(
            eq(notification.sourceKind, "work_item"),
            sql`exists (
              select 1 from workspace.work_item pwi
              join workspace.work_item_type pt on pt.id = pwi.type_id and pt.code = 'parent_message'
              where pwi.id = ${notification.sourceId} and pwi.created_by_person_id = ${notification.recipientPersonId})`,
          ),
        ),
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
