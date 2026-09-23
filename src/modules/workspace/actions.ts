"use server";
// workspace Server Actions. Every one goes through defineAction (session → must-change → strict Zod → permission
// → tenant transaction). Personal-inbox permissions are held "at any scope"; the class-level `assign_class` check
// happens INSIDE createWorkItem against the concrete offering. Also exports the two lookups the «کار جدید»
// form calls from the client (roster of an offering, person search) — read-only, same gate.
import { defineAction, defineQuery } from "@/lib/actions";
import { forbidden, validation } from "@/lib/errors";
import { canBroadly } from "@/modules/iam/can";
import { parseJalaliToInstant } from "@/lib/format";
import { AddCommentInput, ChangeStatusInput, CreateWorkItemInput, ExtendDueInput, OfferingIdInput, SearchPersonsInput, SetPinnedInput, WorkItemIdInput } from "./dto";
import { listOfferingRoster, searchPersons } from "./repo";
import { addComment, archiveInbox, changeStatus, createWorkItem, extendDueAt, markInboxRead, setPinned } from "./service";

/** The pickers' strings («۱۴۰۵/۰۷/۰۵», `HH:mm` or empty = end of day) → the UTC instant; field errors point at the right control. */
function parseDue(dueDate: string | undefined, dueTime: string | undefined): Date | null {
  if (dueDate && dueDate.trim() !== "") {
    const dueAt = parseJalaliToInstant(dueDate, dueTime);
    if (!dueAt) {
      // The date alone parses → the time is what is wrong; point at the right field (m3).
      const dateOk = parseJalaliToInstant(dueDate, null) !== null;
      throw validation({ fieldErrors: dateOk ? { dueTime: ["ساعت را به شکل ۲۳:۵۹ وارد کنید."] } : { dueDate: ["تاریخ را به شکل ۱۴۰۵/۰۷/۰۵ وارد کنید."] } });
    }
    return dueAt;
  }
  if (dueTime && dueTime.trim() !== "") throw validation({ fieldErrors: { dueDate: ["برای ساعت، تاریخ هم لازم است."] } });
  return null;
}

export const createWorkItemAction = defineAction({ schema: CreateWorkItemInput, permission: "workspace.work_item.create", scope: "any" }, async (tx, input, ctx) => {
  const dueAt = parseDue(input.dueDate, input.dueTime);
  return createWorkItem(tx, ctx, {
    typeCode: input.typeCode,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    dueAt,
    recipients: input.recipients,
    idempotencyKey: input.idempotencyKey ?? null,
  });
});

export const addCommentAction = defineAction({ schema: AddCommentInput, permission: "workspace.work_item.comment", scope: "any" }, async (tx, input, ctx) =>
  addComment(tx, ctx, { workItemId: input.workItemId, body: input.body, visibility: input.visibility }),
);

export const changeStatusAction = defineAction({ schema: ChangeStatusInput, permission: "workspace.work_item.update", scope: "any" }, async (tx, input, ctx) =>
  changeStatus(tx, ctx, { workItemId: input.workItemId, toStatusCode: input.toStatusCode, note: input.note ?? null }),
);

export const extendDueAtAction = defineAction({ schema: ExtendDueInput, permission: "workspace.work_item.update", scope: "any" }, async (tx, input, ctx) => {
  const dueAt = parseDue(input.dueDate, input.dueTime);
  if (!dueAt) throw validation({ fieldErrors: { dueDate: ["تاریخ جدید را انتخاب کنید."] } });
  return extendDueAt(tx, ctx, { workItemId: input.workItemId, dueAt });
});

export const markInboxReadAction = defineAction({ schema: WorkItemIdInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  markInboxRead(tx, ctx, { workItemId: input.workItemId }),
);

// INTENTIONALLY UNWIRED (owner, round 5): the «بیشتر» overflow menu on `/inbox/[id]` was removed, so nothing in
// the UI calls سنجاق or بایگانی any more. Action, service, DTO and the `inbox_entry.is_pinned` / `state='archived'`
// columns are all kept intact so the affordance can come back by re-adding a caller — see docs/workspace.md.
export const setPinnedAction = defineAction({ schema: SetPinnedInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  setPinned(tx, ctx, { workItemId: input.workItemId, pinned: input.pinned }),
);

/** INTENTIONALLY UNWIRED — see the note on `setPinnedAction` above. */
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
