"use server";
// notif Server Actions: personal read state only. `notif.notification.read` is checked at any scope — the
// recipient filter inside the repo is the boundary.
import { defineAction } from "@/lib/actions";
import { EmptyInput, NotificationIdInput } from "./dto";
import { markAllRead, markRead } from "./repo";

/** Marks one notification read; returns its deep link so the client can navigate. */
export const markNotificationReadAction = defineAction(
  { schema: NotificationIdInput, permission: "notif.notification.read", scope: "any" },
  async (tx, input, ctx) => {
    const row = await markRead(tx, ctx.personId, input.id);
    return { deepLink: row?.deepLink ?? null };
  },
);

export const markAllNotificationsReadAction = defineAction(
  { schema: EmptyInput, permission: "notif.notification.read", scope: "any" },
  async (tx, _input, ctx) => ({ marked: await markAllRead(tx, ctx.personId) }),
);
