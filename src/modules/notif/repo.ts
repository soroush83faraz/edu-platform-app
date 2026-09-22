// notif/repo — read model + personal read state of notif.notification. Every function filters by the recipient
// (`ctx.personId`): a notification is only ever visible to the person it was sent to.
import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { notification } from "./schema";

export interface NotificationRow {
  id: string;
  typeCode: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  rows: NotificationRow[];
  /** Opaque keyset cursor for the next page, or null. */
  nextCursor: string | null;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const [ms, id] = raw.split("|");
  const t = Number(ms);
  if (!Number.isFinite(t) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt: new Date(t), id };
}

/** Newest first; keyset on (created_at desc, id desc). Expired rows are hidden. */
export async function listNotifications(tx: Tx, personId: string, opts: { cursor?: string | null; limit?: number } = {}): Promise<NotificationPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const after = decodeCursor(opts.cursor);
  const where = and(
    eq(notification.recipientPersonId, personId),
    or(isNull(notification.expiresAt), sql`${notification.expiresAt} > now()`),
    after ? or(lt(notification.createdAt, after.createdAt), and(eq(notification.createdAt, after.createdAt), lt(notification.id, after.id))) : undefined,
  );
  const rows = await tx
    .select({
      id: notification.id,
      typeCode: notification.typeCode,
      title: notification.title,
      body: notification.body,
      deepLink: notification.deepLink,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(where)
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { rows: page, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** The newest unread notifications of one type — the teacher dashboard's «نظرهای تازه» (`work_item.comment`). */
export async function listUnreadOfType(tx: Tx, personId: string, typeCode: string, limit = 5): Promise<NotificationRow[]> {
  return tx
    .select({
      id: notification.id,
      typeCode: notification.typeCode,
      title: notification.title,
      body: notification.body,
      deepLink: notification.deepLink,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(and(eq(notification.recipientPersonId, personId), eq(notification.typeCode, typeCode), isNull(notification.readAt), or(isNull(notification.expiresAt), sql`${notification.expiresAt} > now()`)))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(Math.min(Math.max(limit, 1), 20));
}

export async function unreadCount(tx: Tx, personId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.recipientPersonId, personId), isNull(notification.readAt)));
  return row?.n ?? 0;
}

/** Marks ONE of my notifications read; returns its deep link (null when it is not mine / already gone). */
export async function markRead(tx: Tx, personId: string, id: string): Promise<{ deepLink: string | null } | null> {
  const [row] = await tx
    .update(notification)
    .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
    .where(and(eq(notification.id, id), eq(notification.recipientPersonId, personId)))
    .returning({ deepLink: notification.deepLink });
  return row ?? null;
}

export async function markAllRead(tx: Tx, personId: string): Promise<number> {
  const rows = await tx
    .update(notification)
    .set({ readAt: sql`now()` })
    .where(and(eq(notification.recipientPersonId, personId), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length;
}
