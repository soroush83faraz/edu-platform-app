// Zod v4 `.strict()` input schemas of the notif actions/queries.
import { z } from "zod";

export const NotificationIdInput = z.object({ id: z.uuid() }).strict();
export const ListNotificationsInput = z.object({ cursor: z.string().max(200).optional() }).strict();
export const EmptyInput = z.object({}).strict();
