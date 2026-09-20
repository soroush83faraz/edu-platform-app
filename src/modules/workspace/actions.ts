"use server";
// workspace Server Actions. Every one goes through defineAction (session → must-change → strict Zod → permission
// → tenant transaction). Personal-inbox permissions are held "at any scope"; the class-level `assign_class` check
// happens INSIDE createWorkItem against the concrete offering. Also exports the two lookups the «کار جدید»
// form calls from the client (roster of an offering, person search) — read-only, same gate.
import { defineAction, defineQuery } from "@/lib/actions";
import { forbidden, validation } from "@/lib/errors";
import { canBroadly } from "@/modules/iam/can";
import { parseJalaliToInstant } from "@/lib/format";
import { AddCommentInput, ChangeStatusInput, CreateWorkItemInput, OfferingIdInput, SearchPersonsInput, SetPinnedInput, WorkItemIdInput } from "./dto";
import { listOfferingRoster, searchPersons } from "./repo";
import { addComment, archiveInbox, changeStatus, createWorkItem, markInboxRead, setPinned } from "./service";

export const createWorkItemAction = defineAction({ schema: CreateWorkItemInput, permission: "workspace.work_item.create", scope: "any" }, async (tx, input, ctx) => {
  let dueAt: Date | null = null;
  if (input.dueDate && input.dueDate.trim() !== "") {
    dueAt = parseJalaliToInstant(input.dueDate, input.dueTime);
    if (!dueAt) throw validation({ fieldErrors: { dueDate: ["تاریخ را به شکل ۱۴۰۵/۰۷/۰۵ وارد کنید."] } });
  } else if (input.dueTime && input.dueTime.trim() !== "") {
    throw validation({ fieldErrors: { dueDate: ["برای ساعت، تاریخ هم لازم است."] } });
  }
  return createWorkItem(tx, ctx, {
    typeCode: input.typeCode,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    dueAt,
    recipients: input.recipients,
  });
});

export const addCommentAction = defineAction({ schema: AddCommentInput, permission: "workspace.work_item.comment", scope: "any" }, async (tx, input, ctx) =>
  addComment(tx, ctx, { workItemId: input.workItemId, body: input.body, visibility: input.visibility }),
);

export const changeStatusAction = defineAction({ schema: ChangeStatusInput, permission: "workspace.work_item.update", scope: "any" }, async (tx, input, ctx) =>
  changeStatus(tx, ctx, { workItemId: input.workItemId, toStatusCode: input.toStatusCode, note: input.note ?? null }),
);

export const markInboxReadAction = defineAction({ schema: WorkItemIdInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  markInboxRead(tx, ctx, { workItemId: input.workItemId }),
);

export const setPinnedAction = defineAction({ schema: SetPinnedInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  setPinned(tx, ctx, { workItemId: input.workItemId, pinned: input.pinned }),
);

export const archiveInboxAction = defineAction({ schema: WorkItemIdInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  archiveInbox(tx, ctx, { workItemId: input.workItemId }),
);

/** Students of an offering for the recipient picker — only for someone who may assign to THAT offering. */
export const offeringRosterQuery = defineQuery(
  { schema: OfferingIdInput, permission: "workspace.work_item.assign_class", scope: (i) => ({ scopeType: "class_offering", id: i.classOfferingId }) },
  async (tx, input) => listOfferingRoster(tx, input.classOfferingId),
);

/** Persian name search for the «اشخاص» picker (staff-wide creators only; the service enforces the same rule on submit). */
export const searchPersonsQuery = defineQuery({ schema: SearchPersonsInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) => {
  // A teacher holds person.read only inside her offerings; org-wide name search is for broad creators.
  if (!canBroadly(ctx.assignments, "workspace.work_item.create")) throw forbidden();
  return searchPersons(tx, input.q);
});
