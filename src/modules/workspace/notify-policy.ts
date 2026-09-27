// workspace/notify-policy — WHO a کار change may notify (owner, round 7). Pure: a function of the actor's hats
// (`ctx.assignments`) and the candidate recipients the service already computed, so it is unit-tested without a
// database (`tests/unit/notify-policy.test.ts`) and every `notifyMany` call site in `service.ts` goes through it.
//
//   • Nothing a STUDENT does notifies anyone — marking done, changing a status, commenting: the teacher reads the
//     class's progress (n/m) on the item instead of one bell per student. The same rule keeps the actor's click
//     from flipping anyone's inbox row back to «خوانده‌نشده» (that dot is a notification too).
//   • Opening a PERSONAL item («خودم» — a student's «تسک», anyone's «یادداشت شخصی») notifies no one: its only
//     assignee is its author.
//   • Kept: a دبیر (or a broad admin) giving class homework notifies the class; an admin / principal handing a
//     «تسک» to named people notifies them (an assignment to someone else — docs/decisions-pending/work-items.md);
//     «تمدید» and the creator's own status changes («اتمام» / «بازیابی» / «حذف») tell the assignees, as before.
import { type AssignmentLike, isStudentOnly } from "@/lib/work-item-words";
import type { Recipients } from "./dto";

/** False for an actor whose only hat is `student`: their actions are silent for everyone else. */
export function actorMayNotify(assignments: readonly AssignmentLike[]): boolean {
  return !isStudentOnly(assignments);
}

/** The candidates narrowed by the actor rule; the service then passes the result to `notifyMany` and the unread flip. */
export function notifiable(assignments: readonly AssignmentLike[], candidates: readonly string[]): string[] {
  return actorMayNotify(assignments) ? [...candidates] : [];
}

/**
 * Who hears about a NEW item: nobody for a personal one («خودم») or a student's, otherwise every recipient but
 * the author (`others`, already without the author).
 */
export function creationNotifiable(assignments: readonly AssignmentLike[], kind: Recipients["kind"], others: readonly string[]): string[] {
  if (kind === "self") return [];
  return notifiable(assignments, others);
}
