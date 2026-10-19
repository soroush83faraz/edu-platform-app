// Drizzle tables of the `workspace` PostgreSQL schema. Definitions live in src/db/schema/workspace.ts
// (drizzle-kit reads them from there); module code imports from here.
export {
  guardianMessage,
  inboxEntry,
  workItem,
  workItemAssignee,
  workItemAttachment,
  workItemComment,
  workItemStatus,
  workItemSubmission,
  workItemTransition,
  workItemType,
  workItemWatcher,
} from "@/db/schema/workspace";
