// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
// Personal-inbox permissions are checked "at any scope" (see defineAction `scope: "any"`); the row filters and
// `canViewWorkItem` are the boundary.
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { createVoice, workItemVoice } from "@/lib/work-item-words";
import { canAtAnyScope, canBroadly } from "@/modules/iam/can";
import { getPermissionScope } from "@/modules/iam/service";
import { unreadNotificationCount } from "@/modules/notif";
import { ListInboxInput, ListWorkItemsInput, WorkItemIdInput } from "./dto";
import { type InboxSummary, inboxCounts, inboxTabCounts, isStaff, listInbox, listOfferingsInScope, listTaughtOfferings, openCountsByOffering } from "./repo";
import { getWorkItemDetail } from "./service";

export const listInboxQuery = defineQuery({ schema: ListInboxInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) => {
  const staff = await isStaff(tx, ctx.personId);
  const page = await listInbox(tx, ctx.personId, {
    tab: input.tab,
    bucket: input.bucket,
    createdByMe: input.createdByMe,
    unreadOnly: input.unreadOnly,
    offeringId: input.offeringId ?? null,
    cursor: input.cursor ?? null,
    limit: input.limit,
    viewerIsStaff: staff,
  });
  return {
    ...page,
    tabCounts: await inboxTabCounts(tx, ctx.personId, { createdByMe: input.createdByMe, unreadOnly: input.unreadOnly, offeringId: input.offeringId ?? null }),
    isStaff: staff,
    canCreate: canAtAnyScope(ctx.assignments, "workspace.work_item.create"),
    // «تکلیف» for a teacher, «تسک» for an admin who does not teach — the page's whole vocabulary hangs off this.
    voice: workItemVoice(ctx.assignments),
    // The word for what this person may OPEN, which is the same one except for a student: their own کار is
    // a «تسک» even though the تکالیف in the very same list keep their name (src/lib/work-item-words).
    createVoice: createVoice(ctx.assignments),
  };
});

/** Open rows per page of the unified list; the finished tail follows the last page (see `ListWorkItemsInput`). */
const OPEN_PAGE = 50;
const DONE_TAIL = 20;
const DONE_ALL = 100;

/**
 * The unified list of «پنل من» and the subject page (owner, mock class-page-v3): the caller's OWN inbox rows —
 * exactly `listInbox`'s rows and visibility, read twice: the open ones by deadline, then the finished ones latest
 * first. A deadline-bucket filter (Home's «عقب‌افتاده» / «امروز» links) is about open work, so it drops the tail.
 */
export const listWorkItemsQuery = defineQuery({ schema: ListWorkItemsInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) => {
  const staff = await isStaff(tx, ctx.personId);
  const common = { createdByMe: input.createdByMe, unreadOnly: input.unreadOnly, offeringId: input.offeringId ?? null, viewerIsStaff: staff };
  const open = await listInbox(tx, ctx.personId, { ...common, tab: "todo", bucket: input.bucket, cursor: input.cursor ?? null, limit: OPEN_PAGE });
  const done =
    open.nextCursor || input.bucket
      ? []
      : (await listInbox(tx, ctx.personId, { ...common, tab: "done", order: "recent", limit: input.allDone ? DONE_ALL : DONE_TAIL })).rows;
  return {
    open: open.rows,
    nextCursor: open.nextCursor,
    done,
    counts: await inboxTabCounts(tx, ctx.personId, common),
    isStaff: staff,
    canCreate: canAtAnyScope(ctx.assignments, "workspace.work_item.create"),
    voice: workItemVoice(ctx.assignments),
    createVoice: createVoice(ctx.assignments),
  };
});

/** My open items per درس — the class switcher's «N تکلیف در انتظار» (`openCountsByOffering`). */
export const openItemsByOfferingQuery = defineQuery({ permission: "workspace.work_item.read", scope: "any" }, async (tx, _input, ctx) =>
  openCountsByOffering(tx, ctx.personId),
);

export const workItemDetailQuery = defineQuery({ schema: WorkItemIdInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  getWorkItemDetail(tx, ctx, input.workItemId),
);

/** `{ overdue, dueToday, unread, unreadNotifications }` — the badge, the Home strip and GET /api/inbox/summary. */
export const inboxSummaryQuery = defineQuery({ permission: "workspace.work_item.read", scope: "any" }, async (tx, _input, ctx): Promise<InboxSummary> => {
  const counts = await inboxCounts(tx, ctx.personId);
  const unreadNotifications = await unreadNotificationCount(tx, ctx.personId);
  return { ...counts, unreadNotifications };
});

/**
 * What the «کار جدید» form needs: my offerings — for a broad admin every offering of THEIR schools (the whole
 * organization for the organization admin) plus what they teach, exactly what `can(assign_class, …)` accepts on
 * submit — and whether I may pick persons (whom: `searchPersonsQuery`, inside the same reach the submit enforces).
 */
export const newWorkItemOptionsQuery = defineQuery({ permission: "workspace.work_item.create", scope: "any" }, async (tx, _input, ctx) => {
  const broadAssign = canBroadly(ctx.assignments, "workspace.work_item.assign_class");
  const offerings = broadAssign
    ? await listOfferingsInScope(tx, await getPermissionScope(tx, ctx, "workspace.work_item.assign_class"), ctx.personId)
    : await listTaughtOfferings(tx, ctx.personId);
  return {
    offerings,
    canPickPersons: canBroadly(ctx.assignments, "workspace.work_item.create"),
    canAssignClass: broadAssign || offerings.length > 0,
    // The form is the one surface that is ALWAYS about a کار being opened, so it speaks the create voice:
    // a student with neither a class nor persons to pick writes a «تسک» for «خودم».
    voice: createVoice(ctx.assignments),
  };
});

export const EmptySchema = z.object({}).strict();

const HomeListInput = z.object({ createdByMe: z.boolean().default(false), limit: z.number().int().min(1).max(10).default(5) }).strict();

/** Home lists: the next open items by due date — mine to do, or (`createdByMe`) the ones I gave with their progress. */
export const homeOpenItemsQuery = defineQuery({ schema: HomeListInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) => {
  const staff = await isStaff(tx, ctx.personId);
  const page = await listInbox(tx, ctx.personId, { tab: "all", openOnly: true, createdByMe: input.createdByMe, limit: input.limit, viewerIsStaff: staff });
  return page.rows;
});
