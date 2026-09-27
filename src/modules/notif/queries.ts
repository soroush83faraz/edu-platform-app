// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { ListNotificationsInput } from "./dto";
import { listNotifications } from "./repo";

export const listNotificationsQuery = defineQuery(
  { schema: ListNotificationsInput, permission: "notif.notification.read", scope: "any" },
  async (tx, input, ctx) => listNotifications(tx, ctx.personId, { cursor: input.cursor ?? null }),
);
