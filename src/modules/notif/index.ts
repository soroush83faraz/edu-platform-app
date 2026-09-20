// Public surface of the notif module. Re-export only what other modules may use.
export { notifyMany, type NotifyPayload, type NotificationTypeCode } from "./service";
export { unreadCount as unreadNotificationCount } from "./repo";
