// Drizzle tables of the `workspace` PostgreSQL schema. Definitions live in src/db/schema/workspace.ts
// (drizzle-kit reads them from there); module code imports from here.
export {
  inboxEntry,
  workItem,
  workItemAssignee,
  workItemAttachment,
  workItemComment,
  workItemStatus,
  workItemTransition,
  workItemType,
  workItemWatcher,
} from "@/db/schema/workspace";
