import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common";
import { person, userAccount } from "./iam";
import { orgFk } from "./tenancy";

export const notif = pgSchema("notif");

/** GLOBAL catalog (no organization_id, no RLS): `module.event` codes. Seed-managed; app_rw SELECT only. */
export const notificationType = notif.table(
  "notification_type",
  {
    code: text("code").primaryKey(),
    module: text("module").notNull(),
    name: text("name").notNull(),
    /** Comma-separated channel list; only `inapp` is delivered in phase 1. */
    defaultChannels: text("default_channels").notNull().default("inapp"),
    userCanDisable: boolean("user_can_disable").notNull().default(true),
    urgency: text("urgency").notNull().default("normal"),
  },
  (t) => [check("notification_type_urgency_chk", sql`${t.urgency} IN ('low', 'normal', 'high')`)],
);

/** In-app notification. `source_id` deliberately has NO FK: the source row may live in any table or be gone. */
export const notification = notif.table(
  "notification",
  {
    id: id(),
    organizationId: orgFk(),
    recipientPersonId: uuid("recipient_person_id").notNull(),
    typeCode: text("type_code")
      .notNull()
      .references(() => notificationType.code, { onDelete: "restrict" }),
    title: text("title").notNull(),
    body: text("body"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    sourceKind: text("source_kind"),
    sourceId: uuid("source_id"),
    deepLink: text("deep_link"),
    /** Same (recipient, dedupe_key) is inserted once; producers use ON CONFLICT DO NOTHING. */
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("notification_org_recipient_idx").on(t.organizationId, t.recipientPersonId, t.readAt, t.createdAt.desc()),
    uniqueIndex("notification_recipient_dedupe_uq")
      .on(t.recipientPersonId, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    foreignKey({
      name: "notification_recipient_fk",
      columns: [t.organizationId, t.recipientPersonId],
      foreignColumns: [person.organizationId, person.id],
    }).onDelete("restrict"),
  ],
);

/** Table only — Web Push is out of phase 1. `user_account_id` is the global login, not the tenant person. */
export const pushSubscription = notif.table(
  "push_subscription",
  {
    id: id(),
    organizationId: orgFk(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "restrict" }),
    endpoint: text("endpoint").notNull().unique("push_subscription_endpoint_uq"),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("push_subscription_org_account_idx").on(t.organizationId, t.userAccountId)],
);
