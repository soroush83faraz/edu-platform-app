// workspace/manage-policy — WHO manages a کار: closes it for everyone («اتمام»), brings it back («بازیابی»),
// removes it («حذف») and moves its due date («تمدید»). Pure: a function of the actor's hats, the item's creator and
// whether the actor is one of its assignees — so `changeStatus`, `extendDueAt` and the detail read model
// (`viewer.isManager`, which `WorkItemActions` draws its button set from) cannot disagree, and it is unit-tested
// without a database (tests/unit/manage-policy.test.ts).
//
//   • The CREATOR — the giver — manages the item, also when they are one of its assignees (a personal item, or
//     «اشخاص» with themselves picked).
//   • An ASSIGNEE who did not create the item never does, whatever their hats (owner, round 7): a principal whom the
//     organization admin gave a «تسک» holds a broad `workspace.work_item.update`, yet their «انجام شد» marks only
//     THEIR row done, notifies nobody, and they may not close, restore, extend or remove the item for the others.
//   • Everyone else keeps the admin override: a BROAD `update` holder (مدیر سازمان / مدیر مدرسه / معاون) who is not an
//     assignee may manage any item they can see — e.g. remove spam. Like the broad READ it is organization-wide in
//     phase 1 (docs/decisions.md «Visibility … per-school partitioning is a later block»).
import { type Assignment, canBroadly } from "@/modules/iam/can";

export interface ManageActor {
  personId: string;
  assignments: readonly Assignment[];
}

export function managesItem(actor: ManageActor, item: { createdByPersonId: string }, actorIsAssignee: boolean): boolean {
  if (item.createdByPersonId === actor.personId) return true;
  return !actorIsAssignee && canBroadly(actor.assignments, "workspace.work_item.update");
}
