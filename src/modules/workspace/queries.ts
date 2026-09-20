// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
// Personal-inbox permissions are checked "at any scope" (see defineAction `scope: "any"`); the row filters and
// `canViewWorkItem` are the boundary.
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { canAtAnyScope, canBroadly } from "@/modules/iam/can";
import { unreadNotificationCount } from "@/modules/notif";
import { ListInboxInput, WorkItemIdInput } from "./dto";
import { type InboxSummary, inboxCounts, isStaff, listAllOfferings, listInbox, listTaughtOfferings } from "./repo";
import { getWorkItemDetail } from "./service";

export const listInboxQuery = defineQuery({ schema: ListInboxInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) => {
  const staff = await isStaff(tx, ctx.personId);
  const page = await listInbox(tx, ctx.personId, {
    tab: input.tab,
    bucket: input.bucket,
    createdByMe: input.createdByMe,
    unreadOnly: input.unreadOnly,
    cursor: input.cursor ?? null,
    limit: input.limit,
    viewerIsStaff: staff,
  });
  return {
    ...page,
    isStaff: staff,
    canCreate: canAtAnyScope(ctx.assignments, "workspace.work_item.create"),
  };
});

export const workItemDetailQuery = defineQuery({ schema: WorkItemIdInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  getWorkItemDetail(tx, ctx, input.workItemId),
);

/** `{ overdue, dueToday, unread, unreadNotifications }` — the badge, the Home strip and GET /api/inbox/summary. */
export const inboxSummaryQuery = defineQuery({ permission: "workspace.work_item.read", scope: "any" }, async (tx, _input, ctx): Promise<InboxSummary> => {
  const counts = await inboxCounts(tx, ctx.personId);
  const unreadNotifications = await unreadNotificationCount(tx, ctx.personId);
  return { ...counts, unreadNotifications };
});

/** What the «کار جدید» form needs: my offerings (all of them for broad admins), whether I may pick persons. */
export const newWorkItemOptionsQuery = defineQuery({ permission: "workspace.work_item.create", scope: "any" }, async (tx, _input, ctx) => {
  const broadAssign = canBroadly(ctx.assignments, "workspace.work_item.assign_class");
  const offerings = broadAssign ? await listAllOfferings(tx) : await listTaughtOfferings(tx, ctx.personId);
  return {
    offerings,
    canPickPersons: canBroadly(ctx.assignments, "workspace.work_item.create"),
    canAssignClass: broadAssign || offerings.length > 0,
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
