// notif/service — in-app notifications only (no SMS, no Web Push in phase 1). `notifyMany` is called by other
// modules INSIDE their own transaction so the notification commits or rolls back with the business change.
import type { Tx } from "@/lib/actions";
import { chunk } from "@/lib/collections";
import { notification } from "./schema";

export type NotificationTypeCode =
  | "work_item.assigned"
  | "work_item.comment"
  | "work_item.status_changed"
  | "work_item.due_extended"
  | "work_item.due_soon"
  | "account.password_reset"
  | "system.announcement";

export interface NotifyPayload {
  typeCode: NotificationTypeCode;
  /** ≤ 200 chars; rendered as the bold line. */
  title: string;
  body?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  deepLink?: string | null;
  /**
   * Per-recipient idempotency key: the same (recipient, key) is inserted once (`ON CONFLICT DO NOTHING`).
   * Receives the recipient id so producers can build `wi:<id>:assigned:<person>`; omit for "always a new row".
   */
  dedupeKey?: (personId: string) => string;
}

export interface NotifyCtx {
  orgId: string;
}

export const INSERT_CHUNK = 500;

/** Bulk insert, chunked at 500 rows. Returns the number of rows actually inserted (deduped rows are not counted). */
export async function notifyMany(tx: Tx, ctx: NotifyCtx, personIds: readonly string[], payload: NotifyPayload): Promise<number> {
  const unique = [...new Set(personIds)];
  let inserted = 0;
  for (const part of chunk(unique, INSERT_CHUNK)) {
    const rows = await tx
      .insert(notification)
      .values(
        part.map((personId) => ({
          organizationId: ctx.orgId,
          recipientPersonId: personId,
          typeCode: payload.typeCode,
          title: payload.title.slice(0, 200),
          body: payload.body ?? null,
          sourceKind: payload.sourceKind ?? null,
          sourceId: payload.sourceId ?? null,
          deepLink: payload.deepLink ?? null,
          dedupeKey: payload.dedupeKey ? payload.dedupeKey(personId) : null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notification.id });
    inserted += rows.length;
  }
  return inserted;
}
