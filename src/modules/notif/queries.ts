// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { ListNotificationsInput } from "./dto";
import { listNotifications, listUnreadOfType } from "./repo";

/** Up to five unread «نظر تازه» notifications — the teacher dashboard panel. */
export const unreadCommentNotificationsQuery = defineQuery({ permission: "notif.notification.read", scope: "any" }, async (tx, _input, ctx) => listUnreadOfType(tx, ctx.personId, "work_item.comment", 5));

export const listNotificationsQuery = defineQuery(
  { schema: ListNotificationsInput, permission: "notif.notification.read", scope: "any" },
  async (tx, input, ctx) => listNotifications(tx, ctx.personId, { cursor: input.cursor ?? null }),
);
