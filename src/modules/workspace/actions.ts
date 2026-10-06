"use server";
// workspace Server Actions. Every one goes through defineAction (session → must-change → strict Zod → permission
// → tenant transaction). Personal-inbox permissions are held "at any scope"; the class-level `assign_class` check
// happens INSIDE createWorkItem against the concrete offering. Also exports the two lookups the «کار جدید»
// form calls from the client (roster of an offering, person search) — read-only, same gate.
import { defineAction, defineQuery } from "@/lib/actions";
import { validation } from "@/lib/errors";
import { parseJalaliToInstant } from "@/lib/format";
import { ChangeStatusInput, CreateWorkItemInput, OfferingIdInput, SearchPersonsInput, SetPinnedInput, UpdateWorkItemInput, WorkItemIdInput } from "./dto";
import { listOfferingRoster, searchPersons } from "./repo";
import { archiveInbox, changeStatus, createWorkItem, markInboxRead, personReach, setPinned, updateWorkItem } from "./service";

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

// No `addCommentAction` (owner, round 7: «no comments and no conversation for now»): with no Server Action there is
// no way to add a comment from any client. `addComment`, `AddCommentInput` and the `work_item_comment` table stay
// for the communication channel that will replace them — re-exporting the action is all it takes to bring it back.

export const changeStatusAction = defineAction({ schema: ChangeStatusInput, permission: "workspace.work_item.update", scope: "any" }, async (tx, input, ctx) =>
  changeStatus(tx, ctx, { workItemId: input.workItemId, toStatusCode: input.toStatusCode, note: input.note ?? null }),
);

/** «ویرایش»: omitted fields are kept; `dueDate` present (even "") means the deadline was edited — "" clears it. */
export const updateWorkItemAction = defineAction({ schema: UpdateWorkItemInput, permission: "workspace.work_item.update", scope: "any" }, async (tx, input, ctx) =>
  updateWorkItem(tx, ctx, {
    workItemId: input.workItemId,
    title: input.title,
    description: input.description === undefined ? undefined : input.description || null,
    priority: input.priority,
    dueAt: input.dueDate === undefined && input.dueTime === undefined ? undefined : parseDue(input.dueDate, input.dueTime),
  }),
);

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

/**
 * Persian name search for the «اشخاص» picker: broad creators only (a teacher holds person.read only inside her
 * offerings and sends to her classes), and only the people inside the caller's reach (`personReach`: their own
 * schools' people for a principal / vice principal, everyone for the organization admin) — the very reach
 * `createWorkItem` enforces on submit.
 */
export const searchPersonsQuery = defineQuery({ schema: SearchPersonsInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) =>
  searchPersons(tx, input.q, await personReach(tx, ctx)),
);
