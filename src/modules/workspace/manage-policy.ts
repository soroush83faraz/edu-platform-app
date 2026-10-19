// workspace/manage-policy — WHO manages a کار: closes it for everyone («اتمام»), brings it back («بازیابی»),
// removes it («حذف») and edits it — title, description, priority, deadline («ویرایش»). Pure: a function of the actor's
// hats, the item's creator and whether the actor is one of its assignees — so `changeStatus`, `updateWorkItem` and the detail read model
// (`viewer.isManager`, which `WorkItemActions` draws its button set from) cannot disagree, and it is unit-tested
// without a database (tests/unit/manage-policy.test.ts).
//
//   • The CREATOR — the giver — manages the item, also when they are one of its assignees (a personal item, or
//     «اشخاص» with themselves picked).
//   • An ASSIGNEE who did not create the item never does, whatever their hats (owner, round 7): a principal whom the
//     organization admin gave a «تسک» holds a broad `workspace.work_item.update`, yet their «انجام شد» marks only
//     THEIR row done, notifies nobody, and they may not close, restore, edit or remove the item for the others.
//   • Everyone else keeps the admin override: a BROAD `update` holder (مدیر سازمان / مدیر مدرسه / معاون) who is not an
//     assignee may manage any item they can see — e.g. remove spam. Like the broad READ it is organization-wide in
//     phase 1 (docs/decisions.md «Visibility … per-school partitioning is a later block»).
import { type Assignment, canBroadly } from "@/modules/iam/can";

export interface ManageActor {
  personId: string;
  assignments: readonly Assignment[];
}

export function managesItem(actor: ManageActor, item: { createdByPersonId: string; typeCode: string }, actorIsAssignee: boolean): boolean {
  // The creator of a type whose creator is no participant (a guardian's «پیام ولی») never manages it.
  if (item.createdByPersonId === actor.personId) return creatorParticipates(item.typeCode);
  return !actorIsAssignee && canBroadly(actor.assignments, "workspace.work_item.update");
}

/**
 * Does ONE assignee's «انجام شد» close the item for everyone? For an `admin_request` («درخواست اداری» — the
 * counselor's «ارجاع به مدیریت», addressed to every manager of the school) yes: a request to an office is answered
 * once, by whichever addressee answers it, and that answer — the transition's note — is the decision. Likewise a
 * `parent_message` («پیام ولی», 2026-10-19): the school answers a guardian once. Every other type keeps «done when
 * every assignee is done» (a class task, named people). Pure; used by `changeStatus`.
 */
export function closesOnFirstAnswer(typeCode: string): boolean {
  return typeCode === "admin_request" || typeCode === "parent_message";
}

/**
 * Is the creator of an item of this type one of its participants — the creator's watcher row and read inbox row
 * («کارهایی که دادم»), opening it (`canViewWorkItem`), managing it (`managesItem`)? Yes for every type but a
 * `parent_message` (owner 2026-10-19, «ارتباط ولی و مدرسه»): its creator is the GUARDIAN who wrote it, who never opens
 * the confidential item (its addressees, its status trail, who answered) — they read its status and the answer through
 * `workspace.guardian_message` (src/modules/iam/guardian-messages.ts), as the counseling file reads its referrals.
 */
export function creatorParticipates(typeCode: string): boolean {
  return typeCode !== "parent_message";
}

/**
 * Must an addressee's closing answer carry text? For a `parent_message` yes: the answer IS what the guardian waits
 * for (an empty «ثبت پاسخ» would tell them «پاسخ داده شد» with nothing to read). An `admin_request` keeps it optional.
 */
export function answerNeedsText(typeCode: string): boolean {
  return typeCode === "parent_message";
}

/**
 * May an item of this type take a comment (`addComment`)? Not when its creator is no participant — a `parent_message`
 * (security review 2026-10-19, D3): a comment's bell goes to the item's creator, so it would carry the comment's text
 * to the guardian (whose bell outlives an ended link), and the closing answer is the one text a guardian may read.
 * Every other type keeps its comments.
 */
export function acceptsComments(typeCode: string): boolean {
  return creatorParticipates(typeCode);
}
