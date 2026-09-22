// Zod v4 `.strict()` input schemas of the workspace actions and queries. Messages are Persian; nothing here is
// ever spread into a query — the service maps fields explicitly.
import { z } from "zod";

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
/** UI tabs. «در جریان» is folded into `todo` (owner decision): an item whose effective category is `doing` is still not done. */
export const INBOX_TABS = ["todo", "done", "all"] as const;
export const BUCKETS = ["overdue", "today", "week", "later", "none"] as const;

export type InboxTab = (typeof INBOX_TABS)[number];

const uuid = z.uuid("شناسه نامعتبر است.");

export const Recipients = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("class_offering"),
      id: uuid,
      /** Students of the class the sender un-checked in the picker. */
      excludePersonIds: z.array(uuid).max(500).default([]),
    })
    .strict(),
  z.object({ kind: z.literal("persons"), ids: z.array(uuid).min(1, "دست‌کم یک گیرنده انتخاب کنید.").max(500, "حداکثر ۵۰۰ گیرنده.") }).strict(),
  z.object({ kind: z.literal("self") }).strict(),
]);
export type Recipients = z.output<typeof Recipients>;

export const CreateWorkItemInput = z
  .object({
    typeCode: z.enum(["task", "todo"]),
    title: z.string().trim().min(1, "عنوان را وارد کنید.").max(200, "عنوان حداکثر ۲۰۰ نویسه است."),
    description: z.string().trim().max(4000, "توضیح حداکثر ۴۰۰۰ نویسه است.").optional(),
    priority: z.enum(PRIORITIES),
    /** Jalali `۱۴۰۵/۰۷/۰۵` (any digits); empty = no due date. Parsed by the action into `dueAt`. */
    dueDate: z.string().trim().max(12).optional(),
    /** `HH:mm`; empty = end of the day (23:59 Tehran). */
    dueTime: z.string().trim().max(5).optional(),
    recipients: Recipients,
    /** UUID v7 minted when the form mounts; a resubmit within 10 minutes returns the item already created. */
    idempotencyKey: uuid.optional(),
  })
  .strict();
export type CreateWorkItemInput = z.output<typeof CreateWorkItemInput>;

export const WorkItemIdInput = z.object({ workItemId: uuid }).strict();

export const AddCommentInput = z
  .object({
    workItemId: uuid,
    body: z.string().trim().min(1, "متن نظر را وارد کنید.").max(4000, "نظر حداکثر ۴۰۰۰ نویسه است."),
    visibility: z.enum(["all", "staff_only"]).default("all"),
  })
  .strict();
export type AddCommentInput = z.output<typeof AddCommentInput>;

export const ChangeStatusInput = z
  .object({
    workItemId: uuid,
    toStatusCode: z.enum(["open", "in_progress", "done", "cancelled"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type ChangeStatusInput = z.output<typeof ChangeStatusInput>;

export const SetPinnedInput = z.object({ workItemId: uuid, pinned: z.boolean() }).strict();

/** «تمدید»: the same date/time strings as the create form; the action parses them into the new `dueAt`. */
export const ExtendDueInput = z
  .object({
    workItemId: uuid,
    dueDate: z.string().trim().min(1, "تاریخ جدید را انتخاب کنید.").max(12),
    dueTime: z.string().trim().max(5).optional(),
  })
  .strict();
export type ExtendDueInput = z.output<typeof ExtendDueInput>;

export const ListInboxInput = z
  .object({
    tab: z.enum(INBOX_TABS).default("todo"),
    bucket: z.enum(BUCKETS).optional(),
    createdByMe: z.boolean().default(false),
    unreadOnly: z.boolean().default(false),
    /** Only the items of one درس — the subject page (`/subjects/[offeringId]`). */
    offeringId: uuid.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ListInboxInput = z.output<typeof ListInboxInput>;

export const OfferingIdInput = z.object({ classOfferingId: uuid }).strict();

export const SearchPersonsInput = z.object({ q: z.string().trim().min(1).max(60) }).strict();

export const EmptyInput = z.object({}).strict();
