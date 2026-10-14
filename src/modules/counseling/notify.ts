// counseling/notify — the counselor's bell (owner, 2026-10-14). Three events reach the counselors, each as ONE
// notification per recipient in the SAME transaction as the change that caused it, opening the student's file:
//   • management answers a «ارجاع به مدیریت» (the first answer, which closes the `admin_request`) → its counselor;
//   • a teacher marks a «درخواست گزارش از دبیر» done → the counselor who asked;
//   • a teacher files a «گزارش به مشاور» → every current counselor of the student's school.
// The title names the student and the kind of event only (`counselingNotificationTitle`): never a note's, a report's
// or an answer's text, never a referral's subject; no body. Nobody is notified of their own act. The first two run
// from workspace `changeStatus` (the addressee answers in «پنل من», a workspace surface) through
// `notifyConfidentialAnswer`; the person rows they notify were locked before the work item (`lockItemPeople` takes the
// creator of a confidential item too — person rows before work items).
import type { Tx } from "@/lib/actions";
import { notifyMany } from "@/modules/notif/service";
import type { AssignmentLike } from "@/lib/work-item-words";
import { notifiable } from "@/modules/workspace/notify-policy";
import { counselingNotificationTitle, studentFileHref } from "./policy";
import { counselorsOfSchool, findReferralByWorkItem, lockActivePersons, studentNameOf } from "./repo";

export interface CounselingNotifyCtx {
  orgId: string;
  personId: string;
  assignments: readonly AssignmentLike[];
}

export interface ConfidentialAnswer {
  workItemId: string;
  /** The answer closed the item (always so for «ارجاع به مدیریت» — `closesOnFirstAnswer`). */
  closed: boolean;
  /** The answering assignee row's `responded_at` — what tells one answer from a later one after a reopening. */
  respondedAt: Date | null;
}

/**
 * An addressee's «انجام شد» / «ثبت پاسخ» on a confidential work item: when the item is a referral, its counselor hears
 * of it — management's closing answer to a «ارجاع به مدیریت», or one teacher's answer to a «درخواست گزارش از دبیر» (each
 * teacher's, since each answers for themselves). Only while the counselor is still a counselor of that school, never
 * the actor. Deduped per answer. Returns the number of rows written.
 */
export async function notifyConfidentialAnswer(tx: Tx, ctx: CounselingNotifyCtx, answer: ConfidentialAnswer): Promise<number> {
  // RLS: the addressees of the item read its referral row (`app.counseling_addressee`, migration 0018).
  const r = await findReferralByWorkItem(tx, answer.workItemId);
  if (!r) return 0;
  if (r.kind === "management" && !answer.closed) return 0;
  if (r.createdByPersonId === ctx.personId) return 0;
  if (!(await counselorsOfSchool(tx, r.schoolId, ctx.personId)).includes(r.createdByPersonId)) return 0;
  const recipients = notifiable(ctx.assignments, [r.createdByPersonId]);
  if (recipients.length === 0) return 0;
  const event = r.kind === "management" ? "referral_answered" : "report_request_done";
  const at = answer.respondedAt?.toISOString() ?? "";
  return notifyMany(tx, ctx, recipients, {
    typeCode: r.kind === "management" ? "counseling.referral_answered" : "counseling.report_request_done",
    title: counselingNotificationTitle(event, (await studentNameOf(tx, r.studentProfileId)) ?? ""),
    body: null,
    sourceKind: "counseling_referral",
    sourceId: r.id,
    deepLink: studentFileHref(r.studentProfileId),
    dedupeKey: (personId) => `counseling:${r.id}:answered:${ctx.personId}:${at}:${personId}`,
  });
}

/**
 * A teacher's new «گزارش به مشاور»: every current counselor of the school it was filed at (`counselorsOfSchool`,
 * active persons, read under FOR KEY SHARE), but the author. Deduped per report.
 */
export async function notifyTeacherReport(
  tx: Tx,
  ctx: CounselingNotifyCtx,
  report: { id: string; schoolId: string; studentProfileId: string; studentName: string },
): Promise<number> {
  const recipients = notifiable(ctx.assignments, await lockActivePersons(tx, await counselorsOfSchool(tx, report.schoolId, ctx.personId)));
  if (recipients.length === 0) return 0;
  return notifyMany(tx, ctx, recipients, {
    typeCode: "counseling.teacher_report",
    title: counselingNotificationTitle("teacher_report", report.studentName),
    body: null,
    sourceKind: "counseling_teacher_report",
    sourceId: report.id,
    deepLink: studentFileHref(report.studentProfileId),
    dedupeKey: (personId) => `counseling:report:${report.id}:${personId}`,
  });
}
